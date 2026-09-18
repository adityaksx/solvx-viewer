from fastapi import APIRouter, Query
from typing import Optional, Dict, Any, List
from ..ml.schemas import RegionAnomalyResponse, MLPointResponse
from ..ml.predictor import get_ml_grid, get_ml_point

router = APIRouter(prefix="/api/ml", tags=["Machine Learning"])

@router.get("/anomalies", response_model=RegionAnomalyResponse)
@router.get("/region", response_model=RegionAnomalyResponse)
def get_anomalies(
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    time: Optional[str] = None,
    depth: Optional[float] = None
):
    """
    Returns the 2D anomaly grid for the requested bounding box.
    """
    actual_min_lat = min_lat if min_lat is not None else (lat_min if lat_min is not None else 16.0)
    actual_max_lat = max_lat if max_lat is not None else (lat_max if lat_max is not None else 23.5)
    actual_min_lon = min_lon if min_lon is not None else (lon_min if lon_min is not None else 84.0)
    actual_max_lon = max_lon if max_lon is not None else (lon_max if lon_max is not None else 93.0)

    bbox = {
        'min_lat': actual_min_lat,
        'max_lat': actual_max_lat,
        'min_lon': actual_min_lon,
        'max_lon': actual_max_lon
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
