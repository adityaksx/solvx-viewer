from fastapi import APIRouter, Query, Body
from typing import Optional, Dict, Any, List
from ..ml.schemas import (
    RegionAnomalyResponse,
    MLPointResponse,
    MLPredictRequest,
    MLPredictResponse,
    ModelInfoResponse,
    FeatureExplanation,
)
from ..ml.predictor import (
    get_ml_grid,
    get_ml_point,
    predict_point_risk,
    get_model_info,
    enable_demo_mode,
    disable_demo_mode,
    is_demo_mode_active,
)

router = APIRouter(prefix="/api/ml", tags=["Machine Learning"])


@router.get("/model-info", response_model=ModelInfoResponse)
def get_ml_model_info():
    """
    Returns production ML model verification metadata: algorithm, version,
    chronological training/validation/test periods, and empirical test metrics
    (F1, ROC-AUC, PR-AUC, Brier score) per Section 30 of plan.md.
    """
    return get_model_info()


@router.post("/predict", response_model=MLPredictResponse)
def predict_hazard_risk_post(request: MLPredictRequest):
    """
    Learned tabular Ocean Hazard Risk Prediction for a given coordinate.
    Returns multi-horizon probabilities (6h, 12h, 24h), empirical uncertainty,
    and contributing physical factors.
    """
    return predict_point_risk(
        lat=request.lat,
        lon=request.lon,
        time_str=request.time,
        depth=request.depth
    )


@router.get("/predict", response_model=MLPredictResponse)
def predict_hazard_risk_get(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    time: Optional[str] = Query(None),
    depth: Optional[float] = Query(None)
):
    """
    GET convenience endpoint for learned multi-horizon hazard risk prediction.
    """
    return predict_point_risk(lat=lat, lon=lon, time_str=time, depth=depth)


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
    Returns the 2D anomaly and hazard grid for the requested bounding box.
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
    enable_demo_mode()
    return {"status": "Demo scenario injected", "center": [19.5, 88.5], "is_demo": True}


@router.post("/demo/disable")
def disable_demo_scenario():
    """
    Restores pure physical observations and real predictions.
    """
    disable_demo_mode()
    return {"status": "Demo scenario disabled", "is_demo": False}


@router.get("/demo/status")
def get_demo_status():
    """
    Returns current demo mode status. When active, predictions include synthetic data.
    """
    return {"is_demo": is_demo_mode_active()}


@router.get("/explanation", response_model=Dict[str, Any])
def get_ml_explanation(
    latitude: float = Query(...),
    longitude: float = Query(...),
    time: Optional[str] = None
):
    """
    Returns standalone factor explanations for ML predictions at a specific point.
    """
    # Reuse predict_point_risk to get explanations since it runs the model
    prediction = predict_point_risk(lat=latitude, lon=longitude, time_str=time)
    
    return {
        "location": {"lat": latitude, "lon": longitude},
        "time": time,
        "risk_class": prediction.risk_class,
        "confidence": prediction.confidence,
        "uncertainty": prediction.uncertainty,
        "top_features": [f.model_dump() for f in prediction.top_features],
        "explanation_summary": f"The model predicts a {prediction.risk_class} risk. The primary driving factors are " + 
                               ", ".join([f.feature for f in prediction.top_features[:2]]) + "."
    }
