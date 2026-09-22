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
    generate_analysis_summary
)
from ..models.analysis import (
    ProfileComparisonResponse,
    RegionalModelVsArgoResponse,
    CoverageAnalysisResponse,
    DataGapsResponse,
    AnalysisSummaryResponse
)

router = APIRouter(prefix='/api/analysis', tags=['Oceanographic Analysis Engine'])


@router.get('/model-vs-argo', response_model=RegionalModelVsArgoResponse)
def get_regional_model_vs_argo(
    min_lon: Optional[float] = Query(None, description="Minimum longitude bounding extent"),
    max_lon: Optional[float] = Query(None, description="Maximum longitude bounding extent"),
    min_lat: Optional[float] = Query(None, description="Minimum latitude bounding extent"),
    max_lat: Optional[float] = Query(None, description="Maximum latitude bounding extent"),
    variable: str = Query('temperature', description="Ocean variable: temperature, salinity"),
    time: Optional[str] = Query(None, description="ISO timestamp for model collocation")
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
            time_iso=time
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
    variable: str = Query('temperature')
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
            variable=variable
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis summary generation failed: {str(e)}")
