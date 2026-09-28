"""
SolvX — AI Deterministic Scientific Tool Registry
==================================================
Section 7 of the specification:
Exposes deterministic Python/xarray tools that retrieve and compute
ocean metrics without sending unnecessary raw arrays to the LLM.
"""

from datetime import datetime, timezone
import logging
from typing import Dict, Any, Optional, List, Tuple
import numpy as np

from ..config import DEFAULT_BBOX, PRESET_REGIONS
from .prompts import VARIABLE_CATALOG, UNAVAILABLE_VARIABLES
from .schemas import DataProvenance, ChartSpecification
from ..services.ocean_data_service import (
    get_ocean_catalog,
    get_ocean_time,
    get_ocean_point,
    get_point_profile,
    get_point_timeseries,
    get_ocean_depths,
    find_logical
)
from ..services.observation_service import (
    get_argo_observations,
    get_argo_float
)
from ..services.analysis_service import (
    compare_regional_floats,
    detect_anomalies as service_detect_anomalies,
    extract_abnormal_regions as service_extract_abnormal_regions,
    detect_observation_gaps as service_detect_observation_gaps,
    generate_analysis_summary
)

logger = logging.getLogger("solvx.ai.tool_registry")


def get_dataset_metadata() -> Dict[str, Any]:
    """Retrieves available datasets, variables, and temporal range."""
    catalog = get_ocean_catalog()
    times = get_ocean_time()
    depths = get_ocean_depths()
    return {
        "status": "success",
        "variables": [v['id'] for v in catalog if v.get('available')],
        "variable_catalog": catalog,
        "temporal_range": times,
        "depth_levels": depths.get('depths', [])
    }


def resolve_region(
    name: Optional[str] = None,
    bbox: Optional[Dict[str, float]] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None
) -> Dict[str, Any]:
    """
    Validates and normalizes geographic coordinates or named regions.
    Deterministic coordinate validation (Section 3.1 & 3.2).
    """
    if lat is not None and lon is not None:
        if not (-90.0 <= lat <= 90.0):
            return {
                "status": "error",
                "message": f"Invalid latitude {lat}°. Latitude must be between -90 and 90."
            }
        if not (-180.0 <= lon <= 180.0):
            return {
                "status": "error",
                "message": f"Invalid longitude {lon}°. Longitude must be between -180 and 180."
            }
        return {
            "status": "success",
            "type": "point",
            "lat": lat,
            "lon": lon
        }

    if name:
        name_clean = name.strip().lower().replace('_', ' ')
        for preset in PRESET_REGIONS:
            if (preset['name'].lower() in name_clean or
                name_clean in preset['name'].lower() or
                preset['id'].replace('_', ' ') in name_clean):
                return {
                    "status": "success",
                    "type": "bbox",
                    "name": preset['name'],
                    "bbox": preset['bbox']
                }

    if bbox:
        min_lat = bbox.get('min_lat')
        max_lat = bbox.get('max_lat')
        min_lon = bbox.get('min_lon')
        max_lon = bbox.get('max_lon')

        if min_lat is None or max_lat is None or min_lon is None or max_lon is None:
            return {"status": "error", "message": "Incomplete bounding box coordinates."}

        if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
            return {"status": "error", "message": "Latitude must be between -90 and 90."}
        if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
            return {"status": "error", "message": "Longitude must be between -180 and 180."}
        if min_lat > max_lat:
            min_lat, max_lat = max_lat, min_lat
        if min_lon > max_lon:
            min_lon, max_lon = max_lon, min_lon

        return {
            "status": "success",
            "type": "bbox",
            "bbox": {
                "min_lat": min_lat,
                "max_lat": max_lat,
                "min_lon": min_lon,
                "max_lon": max_lon
            }
        }

    # Default to Bay of Bengal
    return {
        "status": "success",
        "type": "bbox",
        "name": "Bay of Bengal",
        "bbox": DEFAULT_BBOX
    }


def resolve_variable(var_name: str) -> Dict[str, Any]:
    """
    Maps user natural language or abbreviation to controlled variable catalog (Section 5).
    """
    if not var_name:
        return {"status": "error", "message": "No variable name provided."}

    v_clean = var_name.strip().lower()

    # Check unavailable variables first
    for unavail_key, explanation in UNAVAILABLE_VARIABLES.items():
        if unavail_key in v_clean:
            return {
                "status": "unavailable",
                "variable": unavail_key,
                "message": explanation,
                "suggested_variables": ["temperature", "salinity", "currents", "sea_level", "chlorophyll"]
            }

    # Check catalog
    for var_id, meta in VARIABLE_CATALOG.items():
        if v_clean == var_id or v_clean in meta['aliases']:
            return {
                "status": "success",
                "variable_id": var_id,
                "metadata": meta
            }

    # Fuzzy match aliases
    for var_id, meta in VARIABLE_CATALOG.items():
        for alias in meta['aliases']:
            if alias in v_clean or v_clean in alias:
                return {
                    "status": "success",
                    "variable_id": var_id,
                    "metadata": meta
                }

    return {
        "status": "unavailable",
        "variable": var_name,
        "message": f"Variable '{var_name}' is not in the active oceanographic catalog.",
        "suggested_variables": ["temperature", "salinity", "currents", "sea_level", "chlorophyll"]
    }


def query_point_value(
    lat: float,
    lon: float,
    variable: str = 'temperature',
    time: Optional[str] = None,
    depth: Optional[float] = None
) -> Dict[str, Any]:
    """Queries exact point soundings at a specific lat/lon (Section 7)."""
    pt_res = get_ocean_point(lat, lon, time=time, depth=depth)
    v_map = {item['id']: item for item in pt_res.get('values', [])}
    target = v_map.get(variable)

    if not target or not target.get('available') or target.get('value') is None:
        return {
            "status": "not_available",
            "lat": lat,
            "lon": lon,
            "message": pt_res.get('reason', 'No ocean coverage at this coordinate')
        }

    val = target.get('speed') if variable == 'currents' else target.get('value')
    raw_units = target.get('units', '')
    if raw_units == 'degrees_C':
        units = '°C'
    elif raw_units == '1e-3':
        units = 'PSU'
    elif raw_units in ('m s-1', 'm/s'):
        units = 'm/s'
    else:
        units = raw_units or VARIABLE_CATALOG.get(variable, {}).get('units', '')

    return {
        "status": "success",
        "lat": lat,
        "lon": lon,
        "depth": depth or 0.0,
        "time": time,
        "variable": variable,
        "value": float(val),
        "units": units
    }


def query_region_statistics(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None,
    time: Optional[str] = None,
    depth: Optional[float] = None
) -> Dict[str, Any]:
    """
    Computes spatial summary statistics (mean, min, max, std, percentiles)
    for a regional domain without returning huge raw grid payloads (Section 8).
    """
    b = bbox or DEFAULT_BBOX
    # Fast sampling using 5x5 distributed points in the bounding box
    lats = np.linspace(b['min_lat'], b['max_lat'], 5)
    lons = np.linspace(b['min_lon'], b['max_lon'], 5)

    samples = []
    for lt in lats:
        for ln in lons:
            try:
                pt = get_ocean_point(float(lt), float(ln), time=time, depth=depth)
                v_map = {item['id']: item for item in pt.get('values', [])}
                target = v_map.get(variable)
                if target and target.get('available'):
                    val = target.get('speed') if variable == 'currents' else target.get('value')
                    if val is not None and isinstance(val, (int, float)) and np.isfinite(val):
                        samples.append(float(val))
            except Exception:
                pass

    if not samples:
        return {
            "status": "empty",
            "variable": variable,
            "bbox": b,
            "message": "No valid ocean grid cells found within this bounding box (possibly landlocked)."
        }

    arr = np.array(samples)
    return {
        "status": "success",
        "variable": variable,
        "bbox": b,
        "depth": depth or 0.0,
        "count": len(samples),
        "mean": round(float(np.mean(arr)), 3),
        "min": round(float(np.min(arr)), 3),
        "max": round(float(np.max(arr)), 3),
        "std": round(float(np.std(arr)), 3),
        "p25": round(float(np.percentile(arr, 25)), 3),
        "p75": round(float(np.percentile(arr, 75)), 3),
        "units": VARIABLE_CATALOG.get(variable, {}).get('units', '°C')
    }


def query_depth_profile(
    lat: float,
    lon: float,
    variable: str = 'temperature',
    time: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieves vertical sounding profile (depth vs value)."""
    prof = get_point_profile(latitude=lat, longitude=lon, variable=variable, time=time)
    points = prof.get('profile', [])
    if not points:
        return {
            "status": "error",
            "message": "Sounding unavailable at this coordinate"
        }

    depths = [p['depth'] for p in points]
    values = [p['value'] for p in points]

    return {
        "status": "success",
        "lat": lat,
        "lon": lon,
        "variable": variable,
        "depths": depths,
        "values": values,
        "units": prof.get('units', '°C')
    }


def query_time_series(
    lat: float,
    lon: float,
    variable: str = 'temperature',
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    depth: float = 0.0
) -> Dict[str, Any]:
    """Retrieves temporal sequence for a coordinate (Section 10 & 11)."""
    ts = get_point_timeseries(latitude=lat, longitude=lon, depth=depth, start=start_time, end=end_time, variable=variable)
    timestamps = ts.get('timestamps', [])
    values = ts.get('values', [])
    if not timestamps:
        return {
            "status": "error",
            "message": "Time series unavailable at this coordinate"
        }

    return {
        "status": "success",
        "lat": lat,
        "lon": lon,
        "variable": variable,
        "depth": depth,
        "timestamps": timestamps,
        "values": values,
        "units": ts.get('units', '°C')
    }


def query_argo_profiles(
    bbox: Optional[Dict[str, float]] = None,
    time: Optional[str] = None,
    variable: str = 'temperature'
) -> Dict[str, Any]:
    """Queries in-situ WMO Argo float observations in domain."""
    b = bbox or DEFAULT_BBOX
    floats = get_argo_observations(
        min_lat=b['min_lat'],
        max_lat=b['max_lat'],
        min_lon=b['min_lon'],
        max_lon=b['max_lon']
    )

    return {
        "status": "success",
        "count": len(floats),
        "bbox": b,
        "floats": [
            {
                "float_id": f.get('float_id'),
                "latitude": f.get('latitude'),
                "longitude": f.get('longitude'),
                "timestamp": f.get('timestamp'),
                "profile_depths": len(f.get('profile', []))
            }
            for f in floats[:10]
        ]
    }


def compare_model_observations(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None,
    time: Optional[str] = None
) -> Dict[str, Any]:
    """Compares Copernicus model against collocated Argo soundings."""
    b = bbox or DEFAULT_BBOX
    comp = compare_regional_floats(
        min_lon=b['min_lon'],
        max_lon=b['max_lon'],
        min_lat=b['min_lat'],
        max_lat=b['max_lat'],
        variable=variable
    )

    top_disc = comp.discrepancy_ranking[0] if comp.discrepancy_ranking else None
    return {
        "status": "success",
        "variable": variable,
        "floats_compared": comp.floats_compared,
        "overall_rmse": round(comp.overall_rmse, 3) if comp.overall_rmse is not None else 0.0,
        "overall_bias": round(comp.overall_bias, 3) if comp.overall_bias is not None else 0.0,
        "overall_mae": round(comp.overall_mae, 3) if comp.overall_mae is not None else 0.0,
        "top_discrepancy": {
            "float_id": top_disc.float_id,
            "latitude": top_disc.latitude,
            "longitude": top_disc.longitude,
            "rmse": round(top_disc.rmse, 3),
            "bias": round(top_disc.bias, 3),
            "max_error": round(top_disc.max_diff, 3)
        } if top_disc else None
    }


def detect_anomalies(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None,
    method: str = 'zscore',
    threshold_sigma: float = 2.0,
    threshold_abs: float = 2.0
) -> Dict[str, Any]:
    """Detects oceanographic anomalies and groups them into candidate regions."""
    b = bbox or DEFAULT_BBOX
    anom_res = service_detect_anomalies(
        variable=variable,
        method=method,
        threshold_sigma=threshold_sigma,
        threshold_abs=threshold_abs,
        min_lon=b['min_lon'],
        max_lon=b['max_lon'],
        min_lat=b['min_lat'],
        max_lat=b['max_lat']
    )
    zones_res = service_extract_abnormal_regions(
        variable=variable,
        method=method,
        threshold_sigma=threshold_sigma,
        threshold_abs=threshold_abs,
        min_lon=b['min_lon'],
        max_lon=b['max_lon'],
        min_lat=b['min_lat'],
        max_lat=b['max_lat']
    )

    return {
        "status": "success",
        "variable": variable,
        "anomaly_count": anom_res.anomaly_count,
        "top_anomalies": [
            {
                "float_id": a.float_id,
                "lat": a.latitude,
                "lon": a.longitude,
                "depth": a.depth,
                "observed": round(a.value, 2),
                "baseline": round(a.baseline, 2),
                "diff": round(a.difference, 2),
                "severity": a.severity
            }
            for a in anom_res.anomalies[:5]
        ],
        "candidate_regions": [
            {
                "id": r.id,
                "name": r.name,
                "depth_range_m": r.depth_range_m,
                "severity": r.severity,
                "mean_diff": round(r.anomaly_magnitude_mean, 2),
                "center_lat": r.focus_command.lat,
                "center_lon": r.focus_command.lon,
                "center_depth": r.focus_command.depth
            }
            for r in zones_res.regions
        ]
    }


def find_observation_gaps(
    bbox: Optional[Dict[str, float]] = None,
    variable: str = 'temperature'
) -> Dict[str, Any]:
    """Identifies spatial observation gaps where in-situ floats are missing."""
    b = bbox or DEFAULT_BBOX
    gaps = service_detect_observation_gaps(
        min_lon=b['min_lon'],
        max_lon=b['max_lon'],
        min_lat=b['min_lat'],
        max_lat=b['max_lat']
    )

    return {
        "status": "success",
        "gap_percentage": round(gaps.gap_percentage, 1),
        "empty_cells_count": gaps.empty_cells_count,
        "critical_gaps": [
            {
                "name": cg.name,
                "bbox": cg.bbox,
                "severity": cg.severity
            }
            for cg in gaps.gap_regions
        ]
    }


def get_data_provenance(
    variable: str,
    bbox: Optional[Dict[str, float]] = None,
    time: Optional[str] = None,
    depth: Optional[float] = None,
    processing: Optional[List[str]] = None
) -> DataProvenance:
    """Constructs an auditable data provenance record (Section 17)."""
    return DataProvenance(
        dataset="Copernicus Global Ocean Physics Analysis & Forecast (NEMO v4)",
        source="Copernicus Marine Service (CMEMS) / WMO Argo Profiling Float Network",
        variables=[variable],
        region=bbox or DEFAULT_BBOX,
        time_range={"timestamp": time or datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")},
        depth_range={"depth_m": depth or 0.0},
        retrieved_at=datetime.now(timezone.utc).isoformat(),
        processing=processing or ["spatial_subset", "quality_control", "statistical_aggregation"]
    )
