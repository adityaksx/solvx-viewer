"""
SolvX — Oceanographic Analysis API Router
=========================================
Exposes REST endpoints for:
- Model vs Argo collocated profile comparison (bilinear spatial + 1D vertical interpolation, RMSE, Bias, MAE)
- Regional model evaluation & discrepancy ranking
- Observation coverage analysis (spatial density grid, vertical depth strata, temporal distribution)
- Observation gap detection with configurable thresholds
- Comprehensive executive analysis summary
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..services.analysis_service import (
    compare_float_profile,
    compare_regional_floats,
    analyze_observation_coverage,
    detect_observation_gaps,
    generate_analysis_summary,
    detect_anomalies,
    extract_abnormal_regions,
)
from ..models.analysis import (
    ProfileComparisonResponse,
    RegionalModelVsArgoResponse,
    CoverageAnalysisResponse,
    DataGapsResponse,
    AnalysisSummaryResponse,
    AnomalyDetectionResponse,
    AbnormalRegionResponse,
    METRIC_DEFINITIONS,
)

router = APIRouter(prefix='/api/analysis', tags=['Oceanographic Analysis Engine'])


@router.get('/definitions')
def get_metric_definitions():
    """
    Returns official oceanographic metric definitions, explanations, and measurement units
    for UI explainability per Section 19 of plan.md.
    """
    return {
        "definitions": METRIC_DEFINITIONS,
        "metrics": METRIC_DEFINITIONS,
        "standard_units": {
            "temperature": "°C",
            "salinity": "PSU",
            "depth": "m",
            "current_speed": "m/s",
            "sea_surface_height": "m",
            "density": "observations/cell",
            "anomaly": "σ (standard deviations)",
            "anomaly_sigma": "σ",
            "coverage": "%"
        }
    }


@router.get('/model-vs-argo', response_model=RegionalModelVsArgoResponse)
def get_regional_model_vs_argo(
    min_lon: Optional[float] = Query(None, description="Minimum longitude bounding extent"),
    max_lon: Optional[float] = Query(None, description="Maximum longitude bounding extent"),
    min_lat: Optional[float] = Query(None, description="Minimum latitude bounding extent"),
    max_lat: Optional[float] = Query(None, description="Maximum latitude bounding extent"),
    variable: str = Query('temperature', description="Ocean variable: temperature, salinity"),
    time: Optional[str] = Query(None, description="ISO timestamp for model collocation"),
    depth: Optional[float] = Query(None, description="Depth level in meters")
):
    """
    Evaluates numerical model accuracy against in-situ Argo profiling floats across the specified region.
    Calculates basin-wide aggregate RMSE, Mean Model Bias, MAE, and discrepancy rankings.
    """
    try:
        return compare_regional_floats(
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            variable=variable,
            time_iso=time,
            depth=depth
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Regional model vs Argo evaluation failed: {str(e)}")


@router.get('/model-vs-argo/{float_id}', response_model=ProfileComparisonResponse)
def get_float_model_vs_argo(
    float_id: str,
    variable: str = Query('temperature', description="Ocean variable: temperature, salinity"),
    time: Optional[str] = Query(None, description="ISO timestamp for model collocation")
):
    """
    Performs collocated vertical profile analysis for a single Argo float.
    Applies 2D bilinear horizontal interpolation to exact float coordinates and 1D vertical interpolation.
    """
    try:
        return compare_float_profile(float_id=float_id, variable=variable, time_iso=time)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Float comparison failed: {str(e)}")


@router.get('/coverage', response_model=CoverageAnalysisResponse)
def get_observation_coverage(
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    grid_res_deg: float = Query(1.0, ge=0.25, le=5.0, description="Spatial grid resolution in degrees"),
    thresh_high: int = Query(15, ge=1, description="Threshold for HIGH density classification"),
    thresh_med: int = Query(5, ge=1, description="Threshold for MEDIUM density classification"),
    thresh_low: int = Query(1, ge=1, description="Threshold for LOW density classification")
):
    """
    Computes spatial grid density, vertical depth strata distribution, and temporal coverage.
    Thresholds are fully configurable per Section 12 of plan.md.
    """
    try:
        return analyze_observation_coverage(
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            grid_res_deg=grid_res_deg,
            thresh_high=thresh_high,
            thresh_med=thresh_med,
            thresh_low=thresh_low
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Coverage analysis failed: {str(e)}")


@router.get('/gaps', response_model=DataGapsResponse)
def get_data_gaps(
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    grid_res_deg: float = Query(1.0, ge=0.25, le=5.0, description="Spatial grid resolution in degrees"),
    thresh_high: int = Query(15, ge=1),
    thresh_med: int = Query(5, ge=1),
    thresh_low: int = Query(1, ge=1)
):
    """
    Detects spatial gaps (unmonitored cells) and depth gaps across the ocean basin.
    Clusters gap cells into actionable deployment sectors.
    """
    try:
        return detect_observation_gaps(
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            grid_res_deg=grid_res_deg,
            thresh_high=thresh_high,
            thresh_med=thresh_med,
            thresh_low=thresh_low
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gap detection failed: {str(e)}")


@router.get('/summary', response_model=AnalysisSummaryResponse)
def get_analysis_summary(
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    variable: str = Query('temperature'),
    time: Optional[str] = Query(None),
    depth: Optional[float] = Query(None)
):
    """
    Returns an executive analytical summary combining Model Accuracy (RMSE, Bias),
    Observation Density & Coverage, and Spatial/Depth Data Gaps.
    """
    try:
        return generate_analysis_summary(
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            variable=variable,
            time=time,
            depth=depth
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis summary generation failed: {str(e)}")



@router.get('/comparison-field')
def get_comparison_field(
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    variable: str = Query('temperature'),
    time: Optional[str] = Query(None),
    depth: Optional[float] = Query(0.0),
    grid_res_deg: float = Query(1.0, ge=0.25, le=5.0),
    metric: str = Query('error', description='obs_vs_model | error | bias | rmse | anomaly | observation_gap')
):
    """
    Returns an analysis field on a coarse geographic grid.

    Model and observation values are collocated at the requested depth/time.
    Residual convention is Model - Observation. Where no matching observation
    exists, the field is NaN rather than inventing an observation.
    """
    allowed = {'obs_vs_model', 'error', 'bias', 'rmse', 'anomaly', 'observation_gap'}
    if metric not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown metric '{metric}'")

    from ..config import DEFAULT_BBOX
    from ..services.ocean_data_service import get_ocean_slice
    from ..services.observation_service import get_argo_observations

    bmin_lon = min_lon if min_lon is not None else DEFAULT_BBOX['min_lon']
    bmax_lon = max_lon if max_lon is not None else DEFAULT_BBOX['max_lon']
    bmin_lat = min_lat if min_lat is not None else DEFAULT_BBOX['min_lat']
    bmax_lat = max_lat if max_lat is not None else DEFAULT_BBOX['max_lat']

    try:
        res = get_ocean_slice(
            variable=variable,
            depth=float(depth or 0.0),
            time=time,
            min_lat=bmin_lat,
            max_lat=bmax_lat,
            min_lon=bmin_lon,
            max_lon=bmax_lon,
            stride=max(1, int(round(grid_res_deg / 0.25)))
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model analysis field failed: {e}")

    lats = [float(v) for v in (res.get('latitude') or [])]
    lons = [float(v) for v in (res.get('longitude') or [])]
    model = res.get('values') or []

    obs_list = get_argo_observations(
        min_lon=bmin_lon, max_lon=bmax_lon,
        min_lat=bmin_lat, max_lat=bmax_lat
    )

    obs_key = {
        'temperature': ('temperature', 'temp'),
        'salinity': ('salinity', 'sal'),
        'chlorophyll': ('chlorophyll', 'chl'),
        'sea_level': ('sea_level', 'ssh'),
    }.get(variable, (variable, variable))

    samples = []
    for obs in obs_list:
        profile = obs.get('profile') or []
        best = None
        best_d = float('inf')
        for p in profile:
            v = p.get(obs_key[0])
            if v is None:
                v = p.get(obs_key[1])
            if v is None:
                continue
            pd = abs(float(p.get('depth', 0.0)) - float(depth or 0.0))
            if pd < best_d:
                best_d = pd
                best = float(v)
        if best is not None and best_d <= max(25.0, float(grid_res_deg) * 50.0):
            samples.append({
                'lat': float(obs.get('latitude', 0.0)),
                'lon': float(obs.get('longitude', 0.0)),
                'value': best
            })

    # Nearest-neighbour observation collocation for a display field. Only
    # populate cells with observations close enough to make the comparison explicit.
    max_dist = max(0.75, float(grid_res_deg) * 1.5)
    field = []
    used = []
    for j, lat in enumerate(lats):
        row = []
        for i, lon in enumerate(lons):
            try:
                mv = float(model[j][i])
            except (IndexError, TypeError, ValueError):
                row.append(None)
                continue
            if not np.isfinite(mv):
                row.append(None)
                continue

            nearby = sorted(
                samples,
                key=lambda s: (s['lat'] - lat) ** 2 + ((s['lon'] - lon) * np.cos(np.radians(lat))) ** 2
            )
            ob = nearby[0] if nearby else None
            if ob is None:
                row.append(None)
                continue
            ob_dist = np.sqrt((ob['lat'] - lat) ** 2 + ((ob['lon'] - lon) * np.cos(np.radians(lat))) ** 2)
            if ob_dist > max_dist:
                row.append(None)
                continue

            diff = mv - ob['value']
            used.append({'lat': lat, 'lon': lon, 'model': mv, 'observed': ob['value'], 'error': diff})

            if metric in ('obs_vs_model', 'error'):
                out = diff
            elif metric == 'bias':
                out = diff
            elif metric == 'rmse':
                out = abs(diff)
            elif metric == 'anomaly':
                # Standardize the collocated residuals below; provisional value here.
                out = diff
            else:
                out = None
            row.append(out)
        field.append(row)

    if metric == 'anomaly' and used:
        vals = np.asarray([p['error'] for p in used], dtype=float)
        mu = float(vals.mean())
        sd = float(vals.std()) if vals.size > 1 else 1.0
        sd = sd or 1.0
        k = 0
        for j in range(len(field)):
            for i in range(len(field[j])):
                if field[j][i] is not None:
                    field[j][i] = float((field[j][i] - mu) / sd)
                    k += 1
    elif metric == 'observation_gap':
        obs_cells = set()
        for s in samples:
            jj = min(range(len(lats)), key=lambda j: abs(lats[j] - s['lat'])) if lats else None
            ii = min(range(len(lons)), key=lambda i: abs(lons[i] - s['lon'])) if lons else None
            if jj is not None and ii is not None:
                obs_cells.add((jj, ii))
        field = [[0.0 if (j, i) in obs_cells else 1.0 for i in range(len(lons))] for j in range(len(lats))]

    valid = [float(v) for row in field for v in row if v is not None and np.isfinite(v)]
    return {
        'variable': variable,
        'metric': metric,
        'time': time,
        'depth': float(depth or 0.0),
        'latitude': lats,
        'longitude': lons,
        'values': field,
        'units': 'σ' if metric == 'anomaly' else ('index' if metric == 'observation_gap' else (res.get('units') or '')),
        'model_observation_pairs': len(used),
        'model_minus_observation': True,
        'min_val': min(valid) if valid else None,
        'max_val': max(valid) if valid else None,
        'metadata': {
            'grid_res_deg': grid_res_deg,
            'observation_collocation': 'nearest profile level at selected depth',
            'missing_observation_cells': True,
            'metric_definition': 'Model - Observation' if metric in ('obs_vs_model', 'error', 'bias') else metric
        }
    }

# ==============================================================================
# Stage 5: Anomaly Detection & Abnormal Region Extraction
# ==============================================================================

ALLOWED_METHODS = {'zscore', 'threshold', 'model_observation', 'local_deviation'}


@router.get('/anomalies', response_model=AnomalyDetectionResponse)
def get_anomalies(
    variable: str = Query('temperature', description="Ocean variable: 'temperature' or 'salinity'"),
    method: str = Query('zscore', description="Detection method: zscore | threshold | model_observation | local_deviation"),
    threshold_sigma: float = Query(2.0, description="Z-score standard deviation threshold (default 2.0)"),
    threshold_abs: float = Query(2.0, description="Absolute difference threshold in native units (°C or PSU)"),
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    time: Optional[str] = Query(None, description="ISO-8601 datetime for model colocation"),
):
    """
    Scans all Argo float vertical profiles and returns flagged anomalous depth levels.

    Supported detection methods:
    - **zscore**: flags depth levels where |z| > threshold_sigma (z normalised to basin mean/std).
    - **threshold**: flags depth levels where |observed - model| > threshold_abs.
    - **model_observation**: alias for threshold using exact model interpolation.
    - **local_deviation**: flags depth levels where |observed - local_band_mean| > threshold_abs.

    Every AnomalyRecord includes: variable, float_id, location, depth, value, baseline,
    difference, z_score, detection_method, and severity (HIGH / MODERATE / LOW).
    """
    if method not in ALLOWED_METHODS:
        raise HTTPException(status_code=400, detail=f"Unknown method '{method}'. Must be one of: {sorted(ALLOWED_METHODS)}")
    try:
        return detect_anomalies(
            variable=variable,
            method=method,
            threshold_sigma=threshold_sigma,
            threshold_abs=threshold_abs,
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            time_iso=time,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Anomaly detection failed: {str(e)}")


@router.get('/abnormal-regions', response_model=AbnormalRegionResponse)
def get_abnormal_regions(
    variable: str = Query('temperature'),
    method: str = Query('zscore'),
    threshold_sigma: float = Query(2.0),
    threshold_abs: float = Query(2.0),
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    time: Optional[str] = Query(None),
    grid_res_deg: float = Query(1.0, description="Spatial clustering resolution in degrees (default 1.0°)"),
):
    """
    Extracts spatially clustered bounding volumes of anomalous ocean regions.

    Groups AnomalyRecords from /anomalies into 1°×1° (configurable) spatial cells
    and computes per-cluster:
    - Bounding box (lat/lon)
    - Depth range [min_depth, max_depth]
    - Aggregate anomaly magnitude (mean / max)
    - Severity (CRITICAL / MODERATE / LOW)
    - A FOCUS_REGION FocusCommand for 3D viewer navigation (window.solvxViewer.executeCommand)

    Results are sorted by severity: CRITICAL regions first.
    """
    if method not in ALLOWED_METHODS:
        raise HTTPException(status_code=400, detail=f"Unknown method '{method}'. Must be one of: {sorted(ALLOWED_METHODS)}")
    try:
        return extract_abnormal_regions(
            variable=variable,
            method=method,
            threshold_sigma=threshold_sigma,
            threshold_abs=threshold_abs,
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            time_iso=time,
            grid_res_deg=grid_res_deg,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Abnormal region extraction failed: {str(e)}")

