"""
SolvX — Unified Vector & Statistical Compute Engine
===================================================
Provides high-throughput numerical operations (velocity vectors, RMSE, bias,
spatial anomalies, depth strata reductions). Automatically routes large workloads
to CUDA GPU via gpu_service when advantageous, or to multi-core CPU NumPy/SciPy.
"""

import math
import logging
from typing import Dict, Any, Tuple, Optional, Union
import numpy as np

from .gpu_service import should_use_gpu, to_gpu, to_cpu, safe_gpu_exec
from .profiling_service import stage_timer, get_current_profile

logger = logging.getLogger("solvx.compute_service")


def compute_vector_magnitudes(
    u: np.ndarray,
    v: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, str]:
    """
    Computes velocity magnitude and meteorological/oceanographic flow direction.
    magnitude = sqrt(u^2 + v^2)
    direction_deg = (atan2(v, u) * 180 / pi) % 360

    Returns:
        Tuple of (magnitude_array, direction_deg_array, backend_name)
    """
    with stage_timer("compute_ms"):
        total_elements = u.size
        use_gpu = should_use_gpu(total_elements)

        if use_gpu:
            def _gpu_calc(u_arr, v_arr):
                import cupy as cp
                cu_u = to_gpu(u_arr)
                cu_v = to_gpu(v_arr)
                mag = cp.sqrt(cu_u ** 2 + cu_v ** 2)
                rad = cp.arctan2(cu_v, cu_u)
                deg = cp.mod(cp.degrees(rad), 360.0)
                return to_cpu(mag), to_cpu(deg)

            def _cpu_calc(u_arr, v_arr):
                mag = np.sqrt(u_arr ** 2 + v_arr ** 2)
                rad = np.arctan2(v_arr, u_arr)
                deg = np.mod(np.degrees(rad), 360.0)
                return mag, deg

            (mag, deg), backend = safe_gpu_exec(_gpu_calc, _cpu_calc, u, v)
        else:
            mag = np.sqrt(u ** 2 + v ** 2)
            rad = np.arctan2(v, u)
            deg = np.mod(np.degrees(rad), 360.0)
            backend = "cpu"

        prof = get_current_profile()
        if prof and backend == "cuda":
            prof.set_backend("cuda")

        return mag, deg, backend


def compute_rmse_bias_mae(
    model_vals: Union[np.ndarray, list],
    obs_vals: Union[np.ndarray, list]
) -> Dict[str, Optional[float]]:
    """
    Calculates statistical discrepancy metrics (RMSE, Bias, MAE, Max Diff)
    between model output and observational soundings/measurements.
    """
    with stage_timer("compute_ms"):
        m = np.asarray(model_vals, dtype=np.float64)
        o = np.asarray(obs_vals, dtype=np.float64)

        # Mask NaNs and Infs
        valid = np.isfinite(m) & np.isfinite(o)
        if not np.any(valid):
            return {
                "rmse": None,
                "bias": None,
                "mae": None,
                "max_diff": None,
                "count": 0,
                "backend": "cpu"
            }

        m_v = m[valid]
        o_v = o[valid]
        n_elements = m_v.size

        if should_use_gpu(n_elements):
            def _gpu_stat(m_arr, o_arr):
                import cupy as cp
                cu_m = to_gpu(m_arr)
                cu_o = to_gpu(o_arr)
                diff = cu_m - cu_o
                abs_diff = cp.abs(diff)
                sq_diff = diff ** 2

                rmse = float(cp.sqrt(cp.mean(sq_diff)))
                bias = float(cp.mean(diff))
                mae = float(cp.mean(abs_diff))
                max_diff = float(cp.max(abs_diff))
                return {
                    "rmse": round(rmse, 4),
                    "bias": round(bias, 4),
                    "mae": round(mae, 4),
                    "max_diff": round(max_diff, 4),
                    "count": int(n_elements)
                }

            def _cpu_stat(m_arr, o_arr):
                diff = m_arr - o_arr
                abs_diff = np.abs(diff)
                return {
                    "rmse": round(float(np.sqrt(np.mean(diff ** 2))), 4),
                    "bias": round(float(np.mean(diff)), 4),
                    "mae": round(float(np.mean(abs_diff)), 4),
                    "max_diff": round(float(np.max(abs_diff)), 4),
                    "count": int(n_elements)
                }

            res, backend = safe_gpu_exec(_gpu_stat, _cpu_stat, m_v, o_v)
            res["backend"] = backend
        else:
            diff = m_v - o_v
            abs_diff = np.abs(diff)
            res = {
                "rmse": round(float(np.sqrt(np.mean(diff ** 2))), 4),
                "bias": round(float(np.mean(diff)), 4),
                "mae": round(float(np.mean(abs_diff)), 4),
                "max_diff": round(float(np.max(abs_diff)), 4),
                "count": int(n_elements),
                "backend": "cpu"
            }

        prof = get_current_profile()
        if prof and res.get("backend") == "cuda":
            prof.set_backend("cuda")

        return res


def compute_spatial_anomalies(
    data: np.ndarray,
    baseline_mean: Union[float, np.ndarray],
    baseline_std: Union[float, np.ndarray],
    z_threshold: float = 2.0
) -> Tuple[np.ndarray, np.ndarray, str]:
    """
    Computes absolute anomalies and z-scores against baseline climatology.
    Returns:
        Tuple of (anomalies, z_scores, backend)
    """
    with stage_timer("compute_ms"):
        if should_use_gpu(data.size):
            def _gpu_anom(d, m, s):
                import cupy as cp
                cu_d = to_gpu(d)
                cu_m = to_gpu(m)
                cu_s = to_gpu(s)
                anom = cu_d - cu_m
                # Avoid division by zero
                eps = 1e-6
                z = anom / cp.maximum(cu_s, eps)
                return to_cpu(anom), to_cpu(z)

            def _cpu_anom(d, m, s):
                anom = d - m
                eps = 1e-6
                z = anom / np.maximum(s, eps)
                return anom, z

            (anom, z), backend = safe_gpu_exec(_gpu_anom, _cpu_anom, data, baseline_mean, baseline_std)
        else:
            anom = data - baseline_mean
            eps = 1e-6
            z = anom / np.maximum(baseline_std, eps)
            backend = "cpu"

        prof = get_current_profile()
        if prof and backend == "cuda":
            prof.set_backend("cuda")

        return anom, z, backend


def compute_depth_strata_statistics(
    depths: np.ndarray,
    diffs: np.ndarray
) -> Dict[str, Dict[str, Any]]:
    """
    Computes RMSE, bias, and point density across standard oceanographic depth strata:
    - surface: 0 to 100m
    - mesopelagic_upper: 100 to 500m
    - mesopelagic_lower: 500 to 1000m
    - bathypelagic: 1000 to 2000m
    """
    with stage_timer("compute_ms"):
        strata = {
            "surface_0_100m": (0.0, 100.0),
            "upper_thermocline_100_500m": (100.0, 500.0),
            "lower_thermocline_500_1000m": (500.0, 1000.0),
            "deep_ocean_1000_2000m": (1000.0, 2000.0)
        }
        results = {}
        for name, (d_min, d_max) in strata.items():
            mask = (depths >= d_min) & (depths < d_max) & np.isfinite(diffs)
            c = int(np.sum(mask))
            if c > 0:
                sub_diffs = diffs[mask]
                rmse = float(np.sqrt(np.mean(sub_diffs ** 2)))
                bias = float(np.mean(sub_diffs))
                mae = float(np.mean(np.abs(sub_diffs)))
                results[name] = {
                    "count": c,
                    "rmse": round(rmse, 4),
                    "bias": round(bias, 4),
                    "mae": round(mae, 4)
                }
            else:
                results[name] = {
                    "count": 0,
                    "rmse": None,
                    "bias": None,
                    "mae": None
                }
        return results
