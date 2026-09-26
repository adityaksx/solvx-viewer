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

