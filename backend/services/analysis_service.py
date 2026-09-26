"""
SolvX — Oceanographic Analysis Engine Service
============================================
Provides deterministic statistical evaluation for Model vs Argo comparison
(Bilinear spatial interpolation + 1D vertical interpolation, RMSE, Mean Bias, MAE),
observation spatial & depth coverage analysis, and configurable grid gap detection.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
import datetime
import numpy as np

logger = logging.getLogger('solvx.analysis_service')

from .observation_service import get_argo_observations, get_argo_float, ARGO_OBSERVATIONS
from .ocean_data_service import find_logical, safe_open_dataset, select_time, sanitize
from ..models.analysis import (
    ComparisonPoint,
    ProfileComparisonResponse,
    RegionalDiscrepancyRank,
    RegionalModelVsArgoResponse,
    GridCellDensity,
    DepthStrataCoverage,
    CoverageAnalysisResponse,
    GapRegion,
    DataGapsResponse,
    AnalysisSummaryResponse,
    AnomalyRecord,
    AnomalyDetectionResponse,
    FocusCommand,
    AbnormalRegion,
    AbnormalRegionResponse,
)


def extract_model_vertical_column(
    latitude: float,
    longitude: float,
    variable: str = 'temperature',
    time_iso: Optional[str] = None
) -> Tuple[np.ndarray, np.ndarray, bool, str]:
    """
    Extracts a 1D vertical column (depths, values) from 3D/4D numerical model NetCDF datasets
    using spatial bilinear interpolation to the exact coordinates (latitude, longitude).
    Falls back to physically consistent oceanographic profiles if NetCDF is unavailable.

    Returns:
        Tuple of (depths, values, is_climatology_fallback, model_source_description)
    """
    matches = find_logical(variable)
    if matches:
        try:
            f, n, a, d, _ = matches[0]
            with safe_open_dataset(f) as ds:
                if n in ds:
                    da = ds[n]
                    # Temporal selection
                    if 'time' in da.dims:
                        if time_iso:
                            da = select_time(da, time_iso)
                        else:
                            da = da.isel(time=0)

                    # Identify coordinates
                    yd = next((dim for dim in ('latitude', 'lat') if dim in da.dims), None)
                    xd = next((dim for dim in ('longitude', 'lon') if dim in da.dims), None)
                    zd = next((dim for dim in ('depth', 'deptht', 'depthu', 'depthv', 'lev', 'level', 'z') if dim in da.dims), None)

                    if yd and xd and not zd:
                        # Surface-only variables (for example chlorophyll) still
                        # have a valid horizontal model field. Sample it bilinearly
                        # at the float location and represent it at the surface layer.
                        grid_lats = np.asarray(da.coords[yd].values, dtype=float)
                        grid_lons = np.asarray(da.coords[xd].values, dtype=float)
                        vals_2d = np.asarray(da.values, dtype=np.float32)
                        if vals_2d.ndim > 2:
                            vals_2d = np.squeeze(vals_2d)
                        if vals_2d.ndim == 2 and len(grid_lats) >= 2 and len(grid_lons) >= 2:
                            lat_clamped = float(np.clip(latitude, grid_lats.min(), grid_lats.max()))
                            lon_clamped = float(np.clip(longitude, grid_lons.min(), grid_lons.max()))
                            i = int(np.clip(np.searchsorted(grid_lats, lat_clamped, side='right') - 1, 0, len(grid_lats) - 2))
                            j = int(np.clip(np.searchsorted(grid_lons, lon_clamped, side='right') - 1, 0, len(grid_lons) - 2))
                            dlat = grid_lats[i + 1] - grid_lats[i]
                            dlon = grid_lons[j + 1] - grid_lons[j]
                            fy = float((lat_clamped - grid_lats[i]) / dlat) if dlat > 0 else 0.0
                            fx = float((lon_clamped - grid_lons[j]) / dlon) if dlon > 0 else 0.0
                            w00 = (1.0 - fy) * (1.0 - fx)
                            w01 = (1.0 - fy) * fx
                            w10 = fy * (1.0 - fx)
                            w11 = fy * fx
                            sample = (
                                w00 * vals_2d[i, j] +
                                w01 * vals_2d[i, j + 1] +
                                w10 * vals_2d[i + 1, j] +
                                w11 * vals_2d[i + 1, j + 1]
                            )
                            if not np.isfinite(sample):
                                sample = vals_2d[int(round(i + fy)), int(round(j + fx))]
                            if np.isfinite(sample):
                                model_src = f"Copernicus Global Ocean Analysis - {f.name}"
                                return np.array([0.49], dtype=float), np.array([float(sample)], dtype=float), False, model_src
                    if yd and xd and zd:
                        grid_lats = np.asarray(da.coords[yd].values, dtype=float)
                        grid_lons = np.asarray(da.coords[xd].values, dtype=float)
                        grid_depths = np.asarray(da.coords[zd].values, dtype=float)

                        # Check if within bounding box of dataset
                        lat_min, lat_max = float(grid_lats.min()), float(grid_lats.max())
                        lon_min, lon_max = float(grid_lons.min()), float(grid_lons.max())

                        lat_clamped = float(np.clip(latitude, lat_min, lat_max))
                        lon_clamped = float(np.clip(longitude, lon_min, lon_max))

                        H = len(grid_lats)
                        W = len(grid_lons)
                        i = int(np.clip(np.searchsorted(grid_lats, lat_clamped, side='right') - 1, 0, H - 2))
                        j = int(np.clip(np.searchsorted(grid_lons, lon_clamped, side='right') - 1, 0, W - 2))

                        dlat = grid_lats[i + 1] - grid_lats[i]
                        dlon = grid_lons[j + 1] - grid_lons[j]
                        fy = float((lat_clamped - grid_lats[i]) / dlat) if dlat > 0 else 0.0
                        fx = float((lon_clamped - grid_lons[j]) / dlon) if dlon > 0 else 0.0

                        vals_3d = da.values.astype(np.float32)
                        # Handle 3D (depth, lat, lon)
                        if vals_3d.ndim == 3:
                            v00 = vals_3d[:, i, j]
                            v01 = vals_3d[:, i, j + 1]
                            v10 = vals_3d[:, i + 1, j]
                            v11 = vals_3d[:, i + 1, j + 1]

                            w00 = (1.0 - fy) * (1.0 - fx)
                            w01 = (1.0 - fy) * fx
                            w10 = fy * (1.0 - fx)
                            w11 = fy * fx

                            col = w00 * v00 + w01 * v01 + w10 * v10 + w11 * v11
                            # Handle NaNs near coastlines
                            nan_mask = np.isnan(col)
                            if np.any(nan_mask):
                                near_i = int(round(i + fy))
                                near_j = int(round(j + fx))
                                col_near = vals_3d[:, near_i, near_j]
                                col = np.where(nan_mask, col_near, col)

                            if not np.all(np.isnan(col)):
                                valid_mask = ~np.isnan(col)
                                model_src = f"Copernicus Global Ocean Analysis (NEMO 1/12°) - {f.name}"
                                return grid_depths[valid_mask], col[valid_mask], False, model_src
        except Exception as e:
            logger.warning("Failed extracting column from NetCDF for %s at (%.2f, %.2f): %s; falling back to climatology", variable, latitude, longitude, e)

    # Standard physical climatology profile for the Bay of Bengal / Northern Indian Ocean
    # calibrated to Copernicus NEMO reanalysis reference
    # Surface-only chlorophyll is still comparable because Bio-Argo profiles carry
    # discrete chlorophyll soundings. At depths below its model layer, retain the
    # surface value only when the requested observation is itself surface-near.
    if variable == 'chlorophyll':
        # The local chlorophyll product is surface-only. Return a neutral model
        # surface reference rather than borrowing a temperature climatology.
        return np.array([0.49], dtype=float), np.array([0.0], dtype=float), True, "Surface chlorophyll reference layer"

    ref_depths = np.array([0.5, 5.0, 10.0, 25.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0], dtype=float)
    if variable == 'salinity':
        # Typical Northern Indian Ocean salinity profile (fresh lens at surface due to monsoon runoff, increasing with depth)
        ref_vals = np.array([31.5, 31.6, 31.9, 32.8, 33.9, 34.4, 34.7, 34.85, 34.92, 34.98, 35.01, 35.03, 35.05, 35.06, 35.07], dtype=float)
    else:
        # Typical tropical ocean thermocline decay (°C)
        ref_vals = np.array([29.2, 29.1, 28.9, 28.3, 25.8, 23.1, 20.4, 16.8, 14.1, 11.5, 8.7, 7.1, 5.9, 4.2, 3.1], dtype=float)

    return ref_depths, ref_vals, True, "Physical Climatology Reference (Northern Indian Ocean / Bay of Bengal)"


def compare_float_profile(
    float_id: str,
    variable: str = 'temperature',
    time_iso: Optional[str] = None
) -> ProfileComparisonResponse:
    """
    Compares an individual Argo float's vertical sounding profile against collocated
    interpolated numerical model values. Computes RMSE, Mean Model Bias, and MAE.
    The returned point difference is Model - Observation so the dashboard can use a
    single signed convention for error / bias visualizations.
    """
    float_data = get_argo_float(float_id)
    if not float_data:
        raise ValueError(f"Argo profiling float '{float_id}' not found")

    lat = float_data['latitude']
    lon = float_data['longitude']
    profile_points = float_data.get('profile', [])

    # Extract model vertical column
    model_depths, model_vals, is_fallback, model_source = extract_model_vertical_column(
        lat, lon, variable=variable, time_iso=time_iso
    )

    # Sort model depths monotonically for interpolation
    sort_idx = np.argsort(model_depths)
    m_depths = model_depths[sort_idx]
    m_vals = model_vals[sort_idx]

    unit = "°C" if variable == 'temperature' else ("PSU" if variable == 'salinity' else ("mg/m³" if variable == 'chlorophyll' else ("m" if variable == 'sea_level' else ("m/s" if variable == 'currents' else ""))))
    comparison_points: List[ComparisonPoint] = []
    diffs = []
    abs_diffs = []

    val_key = 'temperature' if variable == 'temperature' else ('salinity' if variable == 'salinity' else variable)

    for pt in profile_points:
        z = float(pt.get('depth', 0.0))
        # Support both 'temperature'/'temp' and 'salinity'/'sal' keys
        obs_val = pt.get(val_key)
        if obs_val is None:
            if variable == 'temperature':
                obs_val = pt.get('temp')
            elif variable == 'salinity':
                obs_val = pt.get('sal')
            elif variable == 'chlorophyll':
                obs_val = pt.get('chl')
            elif variable in ('sea_level', 'sea_surface_height'):
                obs_val = pt.get('sea_level') if pt.get('sea_level') is not None else pt.get('ssh')

        if obs_val is None:
            continue

        obs_val = float(obs_val)

        # 1D linear vertical interpolation at exact observation depth z
        mod_val = float(np.interp(z, m_depths, m_vals))
        diff = mod_val - obs_val
        abs_diff = abs(diff)

        diffs.append(diff)
        abs_diffs.append(abs_diff)

        comparison_points.append(ComparisonPoint(
            depth=round(z, 2),
            observed=round(obs_val, 3),
            model=round(mod_val, 3),
            diff=round(diff, 3),
            abs_diff=round(abs_diff, 3),
            qc=int(pt.get('qc', 1)),
            unit=unit
        ))

    rmse = float(np.sqrt(np.mean(np.square(diffs)))) if diffs else None
    bias = float(np.mean(diffs)) if diffs else None
    mae = float(np.mean(abs_diffs)) if abs_diffs else None
    max_d = float(np.max(abs_diffs)) if abs_diffs else None
    min_d = float(np.min(abs_diffs)) if abs_diffs else None

    return ProfileComparisonResponse(
        float_id=str(float_data['float_id']),
        wmo=int(float_data['wmo']),
        variable=variable,
        unit=unit,
        latitude=lat,
        longitude=lon,
        timestamp=float_data['timestamp'],
        model_source=model_source,
        is_climatology_fallback=is_fallback,
        points_count=len(comparison_points),
        rmse=round(rmse, 4) if rmse is not None else None,
        bias=round(bias, 4) if bias is not None else None,
        mae=round(mae, 4) if mae is not None else None,
        max_diff=round(max_d, 4) if max_d is not None else None,
        min_diff=round(min_d, 4) if min_d is not None else None,
        comparison=comparison_points,
        metadata={
            "unit": unit,
            "is_climatology_fallback": is_fallback,
            "model_source": model_source,
            "points_count": len(comparison_points)
        }
    )


def compare_regional_floats(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    variable: str = 'temperature',
    time_iso: Optional[str] = None,
    depth: Optional[float] = None
) -> RegionalModelVsArgoResponse:
    """
    Evaluates numerical model accuracy against all active Argo floats in the given bounding box.
    Calculates basin-wide aggregate RMSE, Bias, MAE, and discrepancy rankings.
    """
    floats = get_argo_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)

    comparisons: List[ProfileComparisonResponse] = []
    all_diffs = []
    all_abs_diffs = []
    ranking: List[RegionalDiscrepancyRank] = []

    unit = {
        'temperature': '°C',
        'salinity': 'PSU',
        'chlorophyll': 'mg/m³',
    }.get(variable, '')
    for f in floats:
        try:
            comp = compare_float_profile(str(f['float_id']), variable=variable, time_iso=time_iso)
            if comp.points_count > 0:
                comparisons.append(comp)
                for pt in comp.comparison:
                    all_diffs.append(pt.diff)
                    all_abs_diffs.append(pt.abs_diff)

                if comp.rmse is not None:
                    ranking.append(RegionalDiscrepancyRank(
                        float_id=comp.float_id,
                        wmo=comp.wmo,
                        latitude=comp.latitude,
                        longitude=comp.longitude,
                        rmse=comp.rmse,
                        bias=comp.bias or 0.0,
                        max_diff=comp.max_diff or 0.0,
                        unit=unit
                    ))
        except Exception as e:
            logger.warning("Failed evaluating Argo float %s against model: %s", f.get('float_id'), e)
            continue

    # Sort ranking by RMSE descending (largest discrepancies first)
    ranking.sort(key=lambda r: r.rmse, reverse=True)

    # Compute depth-dependent statistics across all vertical soundings
    depth_errors = {}
    max_diff_val = 0.0
    max_diff_depth = None
    max_diff_lat = None
    max_diff_lon = None
    for comp in comparisons:
        for pt in comp.comparison:
            d = round(float(pt.depth), 1)
            if d not in depth_errors:
                depth_errors[d] = []
            depth_errors[d].append(pt.diff)
            if pt.abs_diff > max_diff_val:
                max_diff_val = pt.abs_diff
                max_diff_depth = d
                max_diff_lat = comp.latitude
                max_diff_lon = comp.longitude

    depth_of_max_rmse = None
    max_depth_rmse = -1.0
    for d, diffs in depth_errors.items():
        d_rmse = float(np.sqrt(np.mean(np.square(diffs))))
        if d_rmse > max_depth_rmse:
            max_depth_rmse = d_rmse
            depth_of_max_rmse = d

    overall_rmse = float(np.sqrt(np.mean(np.square(all_diffs)))) if all_diffs else None
    overall_bias = float(np.mean(all_diffs)) if all_diffs else None
    overall_mae = float(np.mean(all_abs_diffs)) if all_abs_diffs else None

    return RegionalModelVsArgoResponse(
        variable=variable,
        unit=unit,
        floats_compared=len(comparisons),
        total_sounding_points=len(all_diffs),
        overall_rmse=round(overall_rmse, 4) if overall_rmse is not None else None,
        overall_bias=round(overall_bias, 4) if overall_bias is not None else None,
        overall_mae=round(overall_mae, 4) if overall_mae is not None else None,
        float_comparisons=comparisons,
        discrepancy_ranking=ranking,
        metadata={
            "unit": unit,
            "floats_compared": len(comparisons),
            "total_sounding_points": len(all_diffs),
            "depth_of_max_rmse": depth_of_max_rmse,
            "max_depth_rmse": round(max_depth_rmse, 4) if depth_of_max_rmse is not None else None,
            "depth_of_max_discrepancy": max_diff_depth,
            "max_discrepancy": round(max_diff_val, 4) if max_diff_depth is not None else None,
            "max_discrepancy_loc": {"lat": max_diff_lat, "lon": max_diff_lon} if max_diff_depth is not None else None
        }
    )


def analyze_observation_coverage(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    grid_res_deg: float = 1.0,
    thresh_high: int = 15,
    thresh_med: int = 5,
    thresh_low: int = 1
) -> CoverageAnalysisResponse:
    """
    Computes spatial grid density, vertical depth strata distribution, and temporal coverage.
    Thresholds are fully configurable per Section 12 of plan.md.
    """
    floats = get_argo_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)

    # Determine spatial bounding box
    b_min_lon = min_lon if min_lon is not None else 80.0
    b_max_lon = max_lon if max_lon is not None else 95.0
    b_min_lat = min_lat if min_lat is not None else 10.0
    b_max_lat = max_lat if max_lat is not None else 24.0

    res = max(0.25, min(float(grid_res_deg), 5.0))
    lat_bins = np.arange(b_min_lat, b_max_lat + 0.001, res)
    lon_bins = np.arange(b_min_lon, b_max_lon + 0.001, res)

    grid_cells: List[GridCellDensity] = []
    density_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0, 'NONE': 0}

    for i in range(len(lat_bins) - 1):
        c_lat_min = round(float(lat_bins[i]), 4)
        c_lat_max = round(float(lat_bins[i + 1]), 4)
        for j in range(len(lon_bins) - 1):
            c_lon_min = round(float(lon_bins[j]), 4)
            c_lon_max = round(float(lon_bins[j + 1]), 4)

            matched_floats = [
                str(f['float_id']) for f in floats
                if c_lat_min <= f['latitude'] < c_lat_max and c_lon_min <= f['longitude'] < c_lon_max
            ]
            count = len(matched_floats)

            # Classify using configurable thresholds
            if count >= thresh_high:
                d_class = 'HIGH'
            elif count >= thresh_med:
                d_class = 'MEDIUM'
            elif count >= thresh_low:
                d_class = 'LOW'
            else:
                d_class = 'NONE'

            density_counts[d_class] += 1

            grid_cells.append(GridCellDensity(
                cell_id=f"cell_{i}_{j}",
                lat_min=c_lat_min,
                lat_max=c_lat_max,
                lon_min=c_lon_min,
                lon_max=c_lon_max,
                center_lat=round((c_lat_min + c_lat_max) / 2.0, 4),
                center_lon=round((c_lon_min + c_lon_max) / 2.0, 4),
                count=count,
                density_class=d_class,
                float_ids=matched_floats
            ))

    total_cells = len(grid_cells)
    monitored_cells = total_cells - density_counts['NONE']
    spatial_coverage_pct = round((monitored_cells / total_cells * 100.0), 2) if total_cells > 0 else 0.0

    # Depth strata distribution
    strata_defs = [
        ("Epipelagic (Surface / Mixed Layer)", [0.0, 100.0]),
        ("Mesopelagic (Thermocline)", [100.0, 300.0]),
        ("Sub-surface (Intermediate)", [300.0, 1000.0]),
        ("Bathypelagic (Deep Ocean)", [1000.0, 3000.0]),
    ]
    depth_strata: List[DepthStrataCoverage] = []
    for name, (z_min, z_max) in strata_defs:
        s_count = 0
        f_with_strata = set()
        for f in floats:
            p_pts = f.get('profile', [])
            pts_in_layer = [p for p in p_pts if z_min <= p.get('depth', 0.0) < z_max]
            if pts_in_layer:
                s_count += len(pts_in_layer)
                f_with_strata.add(f['float_id'])

        f_count = len(f_with_strata)
        status = "SUFFICIENT" if f_count >= 4 else ("MODERATE" if f_count >= 1 else "SPARSE")
        depth_strata.append(DepthStrataCoverage(
            layer_name=name,
            depth_range_m=[z_min, z_max],
            sounding_count=s_count,
            float_count=f_count,
            status=status
        ))

    # Temporal distribution
    timestamps = [f.get('timestamp') or f.get('date') for f in floats if f.get('timestamp') or f.get('date')]
    temporal = {
        'total_profiles': len(floats),
        'earliest': min(timestamps) if timestamps else None,
        'latest': max(timestamps) if timestamps else None,
        'recent_30d_count': len(floats)
    }

    return CoverageAnalysisResponse(
        bbox={'min_lon': b_min_lon, 'max_lon': b_max_lon, 'min_lat': b_min_lat, 'max_lat': b_max_lat},
        total_observations=len(floats),
        active_floats_count=len(floats),
        spatial_coverage_pct=spatial_coverage_pct,
        density_summary=density_counts,
        depth_strata_coverage=depth_strata,
        temporal_distribution=temporal,
        grid_cells=grid_cells
    )


def detect_observation_gaps(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    grid_res_deg: float = 1.0,
    thresh_high: int = 15,
    thresh_med: int = 5,
    thresh_low: int = 1
) -> DataGapsResponse:
    """
    Identifies unobserved ocean sectors (gaps) and depth stratifications needing sensor coverage.
    Thresholds are fully configurable.
    """
    cov = analyze_observation_coverage(
        min_lon=min_lon,
        max_lon=max_lon,
        min_lat=min_lat,
        max_lat=max_lat,
        grid_res_deg=grid_res_deg,
        thresh_high=thresh_high,
        thresh_med=thresh_med,
        thresh_low=thresh_low
    )

    empty_cells = [c for c in cov.grid_cells if c.density_class == 'NONE']
    total_cells = len(cov.grid_cells)
    empty_count = len(empty_cells)
    gap_pct = round((empty_count / total_cells * 100.0), 2) if total_cells > 0 else 0.0

    # Cluster gap cells into contiguous regional gaps dynamically based on bounding box
    gap_regions: List[GapRegion] = []
    if empty_cells:
        mid_lat = (cov.bbox['min_lat'] + cov.bbox['max_lat']) / 2.0
        mid_lon = (cov.bbox['min_lon'] + cov.bbox['max_lon']) / 2.0

        sectors = {
            'ne': ('North-Eastern Observation Gap', [c for c in empty_cells if c.center_lat >= mid_lat and c.center_lon >= mid_lon], "Deploy autonomous profiling gliders or Bio-Argo floats to monitor north-eastern sector."),
            'nw': ('North-Western Observation Gap', [c for c in empty_cells if c.center_lat >= mid_lat and c.center_lon < mid_lon], "Deploy autonomous profiling floats along north-western shelf and boundary."),
            'se': ('South-Eastern Observation Gap', [c for c in empty_cells if c.center_lat < mid_lat and c.center_lon >= mid_lon], "Deploy deep-profiling floats (0-2000m) in south-eastern basin sector."),
            'sw': ('South-Western Observation Gap', [c for c in empty_cells if c.center_lat < mid_lat and c.center_lon < mid_lon], "Deploy moorings and profiling floats across south-western maritime approaches.")
        }

        for sec_key, (sec_name, sec_cells, sec_rec) in sectors.items():
            if not sec_cells:
                continue
            sec_pct = len(sec_cells) / total_cells if total_cells > 0 else 0
            severity = "CRITICAL" if sec_pct >= 0.25 else ("MODERATE" if sec_pct >= 0.1 else "LOW")
            gap_regions.append(GapRegion(
                id=f"gap_{sec_key}_basin",
                name=sec_name,
                bbox={
                    'min_lat': min(c.lat_min for c in sec_cells),
                    'max_lat': max(c.lat_max for c in sec_cells),
                    'min_lon': min(c.lon_min for c in sec_cells),
                    'max_lon': max(c.lon_max for c in sec_cells),
                },
                density="NONE",
                severity=severity,
                recommendation=sec_rec
            ))

        if not gap_regions and empty_cells:
            gap_regions.append(GapRegion(
                id="gap_regional_unmonitored",
                name="Unmonitored Regional Ocean Sector",
                bbox={
                    'min_lat': min(c.lat_min for c in empty_cells),
                    'max_lat': max(c.lat_max for c in empty_cells),
                    'min_lon': min(c.lon_min for c in empty_cells),
                    'max_lon': max(c.lon_max for c in empty_cells),
                },
                density="NONE",
                severity="CRITICAL" if len(empty_cells) > total_cells * 0.4 else "MODERATE",
                recommendation="Deploy autonomous profiling floats to close observation void in this sector."
            ))

    # Vertical depth gaps
    vertical_gaps = []
    for strata in cov.depth_strata_coverage:
        if strata.status in ('SPARSE', 'MODERATE'):
            vertical_gaps.append({
                'layer': strata.layer_name,
                'depth_range_m': strata.depth_range_m,
                'float_count': strata.float_count,
                'sounding_count': strata.sounding_count,
                'status': strata.status,
                'risk': f"Insufficient vertical sounding resolution in {strata.layer_name} (>1000m deep zone requires Deep-Argo 4000m / 6000m floats)."
            })

    return DataGapsResponse(
        bbox=cov.bbox,
        grid_resolution_deg=grid_res_deg,
        thresholds={'high': thresh_high, 'medium': thresh_med, 'low': thresh_low},
        total_cells=total_cells,
        monitored_cells=total_cells - empty_count,
        empty_cells_count=empty_count,
        gap_percentage=gap_pct,
        gap_regions=gap_regions,
        vertical_depth_gaps=vertical_gaps
    )


def generate_analysis_summary(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    variable: str = 'temperature',
    time: Optional[str] = None,
    depth: Optional[float] = None
) -> AnalysisSummaryResponse:
    """
    Generates a consolidated analysis summary bringing together model accuracy,
    observation density, and critical gap areas for the analytical dashboard.
    """
    model_res = compare_regional_floats(
        min_lon=min_lon,
        max_lon=max_lon,
        min_lat=min_lat,
        max_lat=max_lat,
        variable=variable,
        time_iso=time,
        depth=depth
    )
    cov_res = analyze_observation_coverage(
        min_lon=min_lon,
        max_lon=max_lon,
        min_lat=min_lat,
        max_lat=max_lat
    )
    gaps_res = detect_observation_gaps(
        min_lon=min_lon,
        max_lon=max_lon,
        min_lat=min_lat,
        max_lat=max_lat
    )

    return AnalysisSummaryResponse(
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        bbox=cov_res.bbox,
        variable=variable,
        model_accuracy={
            'overall_rmse': model_res.overall_rmse,
            'overall_bias': model_res.overall_bias,
            'overall_mae': model_res.overall_mae,
            'floats_compared': model_res.floats_compared,
            'total_sounding_points': model_res.total_sounding_points,
            'top_discrepancy': model_res.discrepancy_ranking[0].model_dump() if model_res.discrepancy_ranking else None,
            'depth_of_max_rmse': model_res.metadata.get('depth_of_max_rmse'),
            'max_depth_rmse': model_res.metadata.get('max_depth_rmse'),
            'depth_of_max_discrepancy': model_res.metadata.get('depth_of_max_discrepancy'),
            'max_discrepancy': model_res.metadata.get('max_discrepancy'),
            'max_discrepancy_loc': model_res.metadata.get('max_discrepancy_loc')
        },
        observation_coverage={
            'total_observations': cov_res.total_observations,
            'spatial_coverage_pct': cov_res.spatial_coverage_pct,
            'density_summary': cov_res.density_summary,
            'depth_strata_coverage': [s.model_dump() for s in cov_res.depth_strata_coverage]
        },
        data_gaps={
            'empty_cells_count': gaps_res.empty_cells_count,
            'gap_percentage': gaps_res.gap_percentage,
            'gap_regions_count': len(gaps_res.gap_regions),
            'critical_gaps': [g.model_dump() for g in gaps_res.gap_regions if g.severity == 'CRITICAL'],
            'vertical_gaps_count': len(gaps_res.vertical_depth_gaps)
        },
        status="READY"
    )


# ==============================================================================
# Stage 5: Anomaly Detection & Abnormal Region Extraction
# ==============================================================================

def _severity_from_zscore(z: float) -> str:
    """Converts an absolute z-score to a severity label."""
    az = abs(z)
    if az >= 3.0:
        return "HIGH"
    elif az >= 2.0:
        return "MODERATE"
    return "LOW"


def _severity_from_abs(diff: float, threshold_abs: float) -> str:
    """Converts an absolute difference to a severity label relative to threshold_abs."""
    if diff >= threshold_abs * 2.0:
        return "HIGH"
    elif diff >= threshold_abs:
        return "MODERATE"
    return "LOW"


def detect_anomalies(
    variable: str = 'temperature',
    method: str = 'zscore',
    threshold_sigma: float = 2.0,
    threshold_abs: float = 2.0,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    time_iso: Optional[str] = None,
) -> AnomalyDetectionResponse:
    """
    Scans all Argo float vertical profiles for anomalous depth levels using
    deterministic methods:
      - zscore           : |z| > threshold_sigma  (z = (value - basin_mean) / basin_std)
      - threshold        : abs(value - climatology_model) > threshold_abs
      - model_observation: abs(observed - model_interp) > threshold_abs
      - local_deviation  : abs(value - local_mean_at_depth) > threshold_abs

    Each flagged depth level produces one AnomalyRecord containing: variable,
    location, depth, time, observed value, baseline, difference, z_score,
    detection_method, and severity.  Thresholds are software defaults and
    must not be hard-coded in production callers.
    """
    obs_list = get_argo_observations(
        min_lon=min_lon, max_lon=max_lon,
        min_lat=min_lat, max_lat=max_lat
    )
    if not obs_list:
        obs_list = ARGO_OBSERVATIONS

    value_keys = {
        'temperature': ('temperature', 'temp'),
        'salinity': ('salinity', 'sal'),
        'chlorophyll': ('chlorophyll', 'chl'),
    }
    val_key, alt_key = value_keys.get(variable, (variable, variable))

    # ── Pass 1: collect all (depth, value) pairs for basin-wide statistics ──
    all_depths: List[float] = []
    all_values: List[float] = []
    for obs in obs_list:
        for pt in obs.get('profile', []):
            v = pt.get(val_key) or pt.get(alt_key)
            if v is not None:
                all_depths.append(float(pt.get('depth', 0.0)))
                all_values.append(float(v))

    arr_depths = np.array(all_depths, dtype=float)
    arr_values = np.array(all_values, dtype=float)
    basin_mean = float(np.mean(arr_values)) if len(arr_values) > 0 else 0.0
    basin_std  = float(np.std(arr_values))  if len(arr_values) > 1 else 1.0
    if basin_std == 0.0:
        basin_std = 1.0

    unit = "°C" if variable == 'temperature' else ("PSU" if variable == 'salinity' else "")
    # ── Pass 2: flag anomalies per float ──
    anomalies: List[AnomalyRecord] = []
    total_depth_levels = 0

    for obs in obs_list:
        float_id  = str(obs.get('float_id', obs.get('id', 'unknown')))
        wmo       = int(obs.get('wmo', 0))
        lat       = float(obs.get('latitude', 0.0))
        lon       = float(obs.get('longitude', 0.0))
        timestamp = str(obs.get('timestamp', ''))

        # Pre-fetch model column for this float's position
        m_depths, m_vals, is_fallback, m_source = extract_model_vertical_column(lat, lon, variable=variable, time_iso=time_iso)
        sort_idx = np.argsort(m_depths)
        m_depths_s = m_depths[sort_idx]
        m_vals_s   = m_vals[sort_idx]

        # Depth-band local statistics (±50 m window)
        profile_points = obs.get('profile', [])
        total_depth_levels += len(profile_points)

        for pt in profile_points:
            v = pt.get(val_key) or pt.get(alt_key)
            if v is None:
                continue
            value = float(v)
            depth = float(pt.get('depth', 0.0))

            # Local mean within ±50 m band across all floats
            mask = np.abs(arr_depths - depth) <= 50.0
            local_vals = arr_values[mask]
            local_mean = float(np.mean(local_vals)) if len(local_vals) > 0 else basin_mean
            local_std  = float(np.std(local_vals))  if len(local_vals) > 1 else basin_std
            if local_std == 0.0:
                local_std = basin_std

            # Model interpolated value at this depth
            model_val = float(np.interp(depth, m_depths_s, m_vals_s))

            flagged    = False
            baseline   = basin_mean
            difference = value - baseline
            z_score_v: Optional[float] = None

            if method == 'zscore':
                z = (value - basin_mean) / basin_std
                z_score_v = round(float(z), 4)
                if abs(z) > threshold_sigma:
                    flagged   = True
                    baseline  = basin_mean
                    difference = value - baseline

            elif method == 'threshold':
                diff = value - model_val
                if abs(diff) > threshold_abs:
                    flagged    = True
                    baseline   = model_val
                    difference = diff

            elif method == 'model_observation':
                diff = value - model_val
                if abs(diff) > threshold_abs:
                    flagged    = True
                    baseline   = model_val
                    difference = diff

            elif method == 'local_deviation':
                z = (value - local_mean) / local_std
                z_score_v = round(float(z), 4)
                diff = value - local_mean
                if abs(diff) > threshold_abs:
                    flagged    = True
                    baseline   = local_mean
                    difference = diff

            if flagged:
                abs_diff = abs(difference)
                sev = (_severity_from_zscore(z_score_v) if z_score_v is not None
                       else _severity_from_abs(abs_diff, threshold_abs))
                anomalies.append(AnomalyRecord(
                    variable=variable,
                    unit=unit,
                    float_id=float_id,
                    wmo=wmo,
                    latitude=round(lat, 4),
                    longitude=round(lon, 4),
                    depth=round(depth, 2),
                    time=timestamp,
                    value=round(value, 4),
                    baseline=round(float(baseline), 4),
                    difference=round(float(difference), 4),
                    abs_difference=round(float(abs_diff), 4),
                    z_score=z_score_v,
                    detection_method=method,
                    severity=sev,
                ))

    return AnomalyDetectionResponse(
        variable=variable,
        unit=unit,
        method=method,
        threshold_sigma=threshold_sigma,
        threshold_abs=threshold_abs,
        floats_scanned=len(obs_list),
        total_depth_levels=total_depth_levels,
        anomaly_count=len(anomalies),
        anomalies=anomalies,
        metadata={
            "unit": unit,
            "method": method,
            "basin_mean": round(basin_mean, 4),
            "basin_std": round(basin_std, 4),
        }
    )


def extract_abnormal_regions(
    variable: str = 'temperature',
    method: str = 'zscore',
    threshold_sigma: float = 2.0,
    threshold_abs: float = 2.0,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    time_iso: Optional[str] = None,
    grid_res_deg: float = 1.0,
) -> AbnormalRegionResponse:
    """
    Extracts spatially clustered bounding volumes of anomalous observations.
    Each cluster becomes an AbnormalRegion with:
      - bounding box (lat/lon)
      - depth range [min_depth, max_depth]
      - aggregate anomaly magnitude (mean / max)
      - severity (CRITICAL / MODERATE / LOW)
      - a FocusCommand for the 3D viewer bridge

    The clustering is grid-based (same 1°×1° approach as coverage analysis),
    grouping AnomalyRecords that fall in the same spatial cell.
    """
    det = detect_anomalies(
        variable=variable,
        method=method,
        threshold_sigma=threshold_sigma,
        threshold_abs=threshold_abs,
        min_lon=min_lon,
        max_lon=max_lon,
        min_lat=min_lat,
        max_lat=max_lat,
        time_iso=time_iso,
    )

    unit = {
        'temperature': '°C',
        'salinity': 'PSU',
        'chlorophyll': 'mg/m³',
    }.get(variable, '')
    if not det.anomalies:
        return AbnormalRegionResponse(
            variable=variable,
            unit=unit,
            method=method,
            region_count=0,
            regions=[],
            metadata={"unit": unit, "method": method, "grid_res_deg": grid_res_deg}
        )

    # Cluster anomaly records into 1° spatial grid cells
    cells: Dict[str, List[AnomalyRecord]] = {}
    for rec in det.anomalies:
        cell_lat = float(np.floor(rec.latitude / grid_res_deg) * grid_res_deg)
        cell_lon = float(np.floor(rec.longitude / grid_res_deg) * grid_res_deg)
        key = f"{cell_lat:.1f}_{cell_lon:.1f}"
        cells.setdefault(key, []).append(rec)

    regions: List[AbnormalRegion] = []
    for idx, (key, recs) in enumerate(sorted(cells.items()), start=1):
        lats = [r.latitude for r in recs]
        lons = [r.longitude for r in recs]
        depths = [r.depth for r in recs]
        mags = [r.abs_difference for r in recs]

        center_lat = float(np.mean(lats))
        center_lon = float(np.mean(lons))
        center_depth = float(np.mean(depths))
        mag_mean = float(np.mean(mags))
        mag_max  = float(np.max(mags))

        # Severity: if any HIGH in cluster → CRITICAL; any MODERATE → MODERATE; else LOW
        sev_set = {r.severity for r in recs}
        if "HIGH" in sev_set:
            region_severity = "CRITICAL"
        elif "MODERATE" in sev_set:
            region_severity = "MODERATE"
        else:
            region_severity = "LOW"

        region_id = f"abnormal_region_{idx}"
        region_name = f"Anomalous {variable.capitalize()} Zone {idx}"

        regions.append(AbnormalRegion(
            id=region_id,
            name=region_name,
            bbox={
                'min_lat': round(min(lats), 4),
                'max_lat': round(max(lats), 4),
                'min_lon': round(min(lons), 4),
                'max_lon': round(max(lons), 4),
            },
            depth_range_m=[round(min(depths), 1), round(max(depths), 1)],
            anomaly_count=len(recs),
            anomaly_magnitude_mean=round(mag_mean, 4),
            anomaly_magnitude_max=round(mag_max, 4),
            variable=variable,
            unit=unit,
            severity=region_severity,
            focus_command=FocusCommand(
                action="FOCUS_REGION",
                lat=round(center_lat, 4),
                lon=round(center_lon, 4),
                depth=round(center_depth, 1),
                variable=variable,
                layer="anomaly",
            ),
        ))

    # Sort regions by severity: CRITICAL first
    severity_order = {"CRITICAL": 0, "MODERATE": 1, "LOW": 2}
    regions.sort(key=lambda r: severity_order.get(r.severity, 3))

    return AbnormalRegionResponse(
        variable=variable,
        unit=unit,
        method=method,
        region_count=len(regions),
        regions=regions,
        metadata={
            "unit": unit,
            "method": method,
            "grid_res_deg": grid_res_deg,
            "region_count": len(regions)
        }
    )
