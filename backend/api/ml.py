from fastapi import APIRouter, Query
from typing import Optional, Dict, Any, List
from ..ml.schemas import RegionAnomalyResponse, MLPointResponse
from ..ml.predictor import get_ml_grid, get_ml_point

router = APIRouter(prefix="/api/ml", tags=["Machine Learning"])

@router.get("/anomalies", response_model=RegionAnomalyResponse)
def get_anomalies(
    lat_min: float = Query(...),
    lat_max: float = Query(...),
    lon_min: float = Query(...),
    lon_max: float = Query(...),
    time: Optional[str] = None,
    depth: Optional[float] = None
):
    """
    Returns the 2D anomaly grid for the requested bounding box.
    """
    bbox = {
        'min_lat': lat_min,
        'max_lat': lat_max,
        'min_lon': lon_min,
        'max_lon': lon_max
    }
    return get_ml_grid(bbox=bbox, time_str=time, depth=depth)

@router.get("/point", response_model=MLPointResponse)
def get_point_analysis(
    latitude: float = Query(...),
    longitude: float = Query(...),
    time: Optional[str] = None,
    depth: Optional[float] = None
):
    """
    Returns detailed inspection, variable profile, and hazard explanation for a single point.
    """
    return get_ml_point(lat=latitude, lon=longitude, time_str=time, depth=depth)
    
@router.post("/demo")
def trigger_demo_scenario():
    """
    Injects a synthetic cyclone scenario for the SIH demo.
    """
    from ..ml.predictor import enable_demo_mode
    enable_demo_mode()
    return {"status": "Demo scenario injected", "center": [19.5, 88.5]}
