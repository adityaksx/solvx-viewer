"""
SolvX — ML Inference Predictor
==============================
Production inference engine for Ocean Hazard Risk Prediction:
- Loads the trained tabular Gradient Boosted Trees model
- Serves point-level multi-horizon risk predictions (6h, 12h, 24h)
- Serves 2D spatial hazard grids with empirical uncertainty
- Exposes model verification metadata for the dashboard
- Maintains backward compatibility for existing 3D viewer callers
(Plan.md Section 4, 15, 28, 29, 30)
"""

import json
import logging
from typing import Dict, Any, List, Optional
import numpy as np

from ..services.data_collector import COLLECTOR
from .config import MODEL_FILE, METADATA_FILE, MODEL_VERSION, MODEL_ALGORITHM, PROBABILITY_RISK_THRESHOLDS
from .model import OceanHazardModel
from .data_pipeline import DataPipeline
from .uncertainty import compute_uncertainty
from .explain import explain_prediction
from .anomaly_detector import detect_anomalies
from .hazard_model import evaluate_hazards, get_risk_level
from .schemas import (
    RegionAnomalyResponse,
    MLPointResponse,
    MLPredictResponse,
    ModelInfoResponse,
    Location,
    HazardPrediction,
)

logger = logging.getLogger('solvx.predictor')

# Singleton model instance
_MODEL_INSTANCE: Optional[OceanHazardModel] = None
_DATA_PIPELINE = DataPipeline()
DEMO_MODE = False


def get_model_instance() -> Optional[OceanHazardModel]:
    """Retrieves or lazily loads the trained OceanHazardModel."""
    global _MODEL_INSTANCE
    if _MODEL_INSTANCE is None:
        if MODEL_FILE.exists():
            try:
                _MODEL_INSTANCE = OceanHazardModel.load(MODEL_FILE)
                logger.info("Loaded trained OceanHazardModel from %s", MODEL_FILE)
            except Exception as e:
                logger.error("Failed loading model from %s: %s", MODEL_FILE, e)
                _MODEL_INSTANCE = None
        else:
            logger.warning("No trained model found at %s. Training required.", MODEL_FILE)
    return _MODEL_INSTANCE


def get_model_info() -> ModelInfoResponse:
    """Returns model version, algorithm, training/validation periods, and test metrics."""
    if METADATA_FILE.exists():
        try:
            with open(METADATA_FILE, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            d_sum = meta.get('dataset_summary', {})
            t_met = meta.get('test_metrics', {})
            return ModelInfoResponse(
                model_name=meta.get('model_name', "Ocean Hazard Risk Model"),
                version=meta.get('version', MODEL_VERSION),
                algorithm=meta.get('algorithm', MODEL_ALGORITHM),
                status=meta.get('status', "Trained and Active"),
                training_period=d_sum.get('train_period'),
                validation_period=d_sum.get('val_period'),
                test_period=d_sum.get('test_period'),
                sample_count=d_sum.get('total_samples'),
                test_metrics=t_met,
                feature_importances=meta.get('feature_importances', {}),
                last_trained=meta.get('trained_at'),
                input_features=meta.get('input_features', [])
            )
        except Exception as e:
            logger.error("Failed reading model metadata from %s: %s", METADATA_FILE, e)

    return ModelInfoResponse(
        model_name="Ocean Hazard Risk Model",
        version=MODEL_VERSION,
        algorithm=MODEL_ALGORITHM,
        status="Training required" if not MODEL_FILE.exists() else "Active",
        test_metrics={},
        feature_importances={}
    )


def predict_point_risk(
    lat: float,
    lon: float,
    time_str: Optional[str] = None,
    depth: Optional[float] = None
) -> MLPredictResponse:
    """
    Computes a learned multi-horizon hazard risk prediction for a single coordinate point.
    Includes 6h, 12h, and 24h hazard risk probabilities, empirical uncertainty,
    and top contributing physical factors.
    """
    model = get_model_instance()
    feature_vec, feat_dict, missing_inputs = _DATA_PIPELINE.prepare_point_features(
        lat=lat, lon=lon, time_str=time_str, depth=depth
    )

    if model is not None and model.is_trained:
        probs = model.predict_proba(feature_vec)
        risk_6h = round(float(probs['risk_6h'][0]), 3)
        risk_12h = round(float(probs['risk_12h'][0]), 3)
        risk_24h = round(float(probs['risk_24h'][0]), 3)
        importances = model.get_feature_importances()
    else:
        # Fallback heuristic if model file is unavailable
        sst_anom = feat_dict.get('sst_anomaly', 0.0)
        risk_6h = round(min(0.99, max(0.05, sst_anom * 0.25)), 3)
        risk_12h = round(min(0.99, max(0.08, sst_anom * 0.35)), 3)
        risk_24h = round(min(0.99, max(0.10, sst_anom * 0.50)), 3)
        importances = {'sst_anomaly': 0.70, 'sst': 0.15, 'wind_speed': 0.15}

    uncertainty_detail = compute_uncertainty(
        lat=lat,
        lon=lon,
        probabilities=[risk_6h, risk_12h, risk_24h],
        missing_inputs=missing_inputs
    )

    top_features = explain_prediction(
        features_dict=feat_dict,
        feature_importances=importances,
        risk_score=risk_24h,
        max_features=4
    )

    risk_class = get_risk_level(risk_24h)

    return MLPredictResponse(
        location=Location(latitude=lat, longitude=lon, depth_min=depth, depth_max=depth),
        time=time_str or "latest",
        risk_6h=risk_6h,
        risk_12h=risk_12h,
        risk_24h=risk_24h,
        risk_class=risk_class,
        confidence=uncertainty_detail.confidence,
        uncertainty=uncertainty_detail,
        top_features=top_features,
        model_version=MODEL_VERSION,
        focus={
            "action": "FOCUS_REGION",
            "lat": lat,
            "lon": lon,
            "depth": depth or 0.0,
            "risk_class": risk_class
        }
    )


def get_ml_grid(
    bbox: Dict[str, float],
    time_str: Optional[str] = None,
    depth: Optional[float] = None
) -> RegionAnomalyResponse:
    """
    Fetches ocean variables for the bounding box, runs anomaly detection, 
    and predicts hazards using the trained ML model.
    """
    grid_data = {}
    lats = []
    lons = []
    
    try:
        bundle = COLLECTOR.get_ocean_bundle(
            min_lat=bbox['min_lat'],
            max_lat=bbox['max_lat'],
            min_lon=bbox['min_lon'],
            max_lon=bbox['max_lon'],
            depth=depth,
            time=time_str,
            stride=1
        )
        vars_res = bundle.get('variables', {})
        
        if 'ocean_temperature' in vars_res and 'values' in vars_res['ocean_temperature']:
            t_res = vars_res['ocean_temperature']
            lats = t_res.get('latitude', [])
            lons = t_res.get('longitude', [])
            grid_data['temperature'] = t_res.get('values', [])
            
        if 'salinity' in vars_res and 'values' in vars_res['salinity']:
            s_res = vars_res['salinity']
            if not lats:
                lats = s_res.get('latitude', [])
                lons = s_res.get('longitude', [])
            grid_data['salinity'] = s_res.get('values', [])
            
        if 'sea_surface_height' in vars_res and 'values' in vars_res['sea_surface_height']:
            ssh_res = vars_res['sea_surface_height']
            grid_data['sea_surface_height'] = ssh_res.get('values', [])
            
        if 'currents' in vars_res:
            c_res = vars_res['currents']
            if 'speed' in c_res:
                grid_data['currents_speed'] = c_res.get('speed', [])
    except Exception as e:
        logger.warning("Error collecting ocean bundle for grid: %s", e)
            
    # Run Anomaly Detection
    anomaly_grid, features = detect_anomalies(grid_data)
    
    # Inject demo if demo mode is enabled
    _inject_demo(anomaly_grid, lats, lons)

    # Run Hazard Prediction with real ML model
    model = get_model_instance()
    hazards = evaluate_hazards(anomaly_grid, features, lats, lons, ml_model=model, time_str=time_str)
    
    # Clean up NaNs for JSON serialization
    safe_grid = []
    if len(anomaly_grid) > 0:
        safe_grid = np.nan_to_num(anomaly_grid, nan=-1.0).tolist()
    
    return RegionAnomalyResponse(
        time=time_str or "latest",
        bbox=bbox,
        scores=safe_grid,
        lats=lats,
        lons=lons,
        hazards=hazards,
        is_demo=DEMO_MODE
    )


def get_ml_point(
    lat: float, 
    lon: float, 
    time_str: Optional[str] = None,
    depth: Optional[float] = None
) -> MLPointResponse:
    """
    Provides deep inspection for a single point, combining point observation,
    local anomaly score, and trained ML hazard prediction.
    """
    from ..adapters.copernicus_adapter import CopernicusAdapter
    from ..adapters.open_meteo_adapter import OpenMeteoAdapter
    ca = CopernicusAdapter()
    oma = OpenMeteoAdapter()
    try:
        ocean_data = ca.fetch_ocean_point(lat, lon, time_str, time_str)
    except Exception as e:
        logger.warning("Failed fetching point ocean data: %s", e)
        ocean_data = {}

    try:
        atmos_data = oma.fetch_atmospheric_point(lat, lon, time_str, time_str)
    except Exception as e:
        logger.warning("Failed fetching point atmospheric data: %s", e)
        atmos_data = {}
        
    point_res = {
        "location": {"latitude": lat, "longitude": lon},
        "time": time_str,
        "variables": {
            "ocean_temperature": ocean_data.get("ocean_temperature"),
            "salinity": ocean_data.get("salinity"),
            "current_u": ocean_data.get("current_u"),
            "current_v": ocean_data.get("current_v"),
            "sea_surface_height": ocean_data.get("sea_surface_height"),
            "air_temperature": atmos_data.get("air_temperature"),
            "relative_humidity": atmos_data.get("relative_humidity"),
            "wind_speed": atmos_data.get("wind_speed"),
            "wind_direction": atmos_data.get("wind_direction"),
            "sea_level_pressure": atmos_data.get("sea_level_pressure")
        }
    }
    
    # Run real ML point prediction
    pred_res = predict_point_risk(lat=lat, lon=lon, time_str=time_str, depth=depth)
    
    # Calculate anomaly context from small bbox
    score = round(pred_res.risk_24h * 100.0, 1)
    
    hazard_obj = None
    if pred_res.risk_24h >= 0.20:
        hazard_obj = HazardPrediction(
            hazard_type="Ocean Hazard Risk" if pred_res.risk_24h < 0.60 else "Cyclone Intensification Risk",
            risk_score=score,
            risk_level=pred_res.risk_class,
            predicted_center=Location(latitude=lat, longitude=lon),
            location_uncertainty_km=pred_res.uncertainty.distance_to_argo_km or 75.0,
            expected_window="18-36 hours",
            lead_time_hours="24",
            magnitude_estimate=f"Predicted 24h Risk: {pred_res.risk_24h * 100:.1f}%",
            uncertainty_range=pred_res.uncertainty.uncertainty.capitalize(),
            data_quality=pred_res.uncertainty.data_quality.capitalize(),
            observation_coverage=pred_res.uncertainty.observation_coverage.capitalize(),
            missing_inputs=pred_res.uncertainty.missing_inputs,
            contributing_signals=[f.description for f in pred_res.top_features],
            risk_6h=pred_res.risk_6h,
            risk_12h=pred_res.risk_12h,
            risk_24h=pred_res.risk_24h,
            confidence=pred_res.confidence,
            uncertainty_detail=pred_res.uncertainty,
            top_features=pred_res.top_features
        )

    return MLPointResponse(
        location=Location(latitude=lat, longitude=lon),
        time=time_str or "latest",
        values=point_res.get('variables', {}),
        depth_profiles=point_res.get('depth_profiles', {}),
        anomaly={
            'location': Location(latitude=lat, longitude=lon),
            'anomaly_score': score,
            'severity': 'normal' if score < 20 else ('moderate' if score < 60 else 'high'),
            'affected_variables': [f.feature for f in pred_res.top_features if f.direction == 'elevates_risk'],
            'features': {f.feature: f.value or 0.0 for f in pred_res.top_features}
        },
        hazard=hazard_obj,
        observations_comparison={
            'status': f"Nearest in-situ float: {pred_res.uncertainty.distance_to_argo_km or 'None'} km",
            'coverage': pred_res.uncertainty.observation_coverage
        },
        data_quality={
            'data_quality': pred_res.uncertainty.data_quality,
            'confidence': f"{pred_res.confidence * 100:.0f}%",
            'missing_inputs': pred_res.uncertainty.missing_inputs
        },
        risk_forecast={
            'risk_6h': pred_res.risk_6h,
            'risk_12h': pred_res.risk_12h,
            'risk_24h': pred_res.risk_24h,
            'confidence': pred_res.confidence
        },
        model_version=MODEL_VERSION
    )


# Demo Mode Configuration
def enable_demo_mode():
    global DEMO_MODE
    DEMO_MODE = True
    logger.info("Demo mode ENABLED: Synthetic anomaly scenario will be injected.")


def disable_demo_mode():
    global DEMO_MODE
    DEMO_MODE = False
    logger.info("Demo mode DISABLED: Using real data only.")


def is_demo_mode_active() -> bool:
    return DEMO_MODE


def _inject_demo(anomaly_grid: np.ndarray, lats: List[float], lons: List[float]):
    if not DEMO_MODE or len(lats) == 0 or len(lons) == 0:
        return
        
    lat_idx = len(lats) // 2
    lon_idx = len(lons) // 2
    
    for i in range(len(lats)):
        for j in range(len(lons)):
            dist = np.sqrt((i - lat_idx)**2 + (j - lon_idx)**2)
            if dist < 5:
                anomaly_grid[i, j] = max(anomaly_grid[i, j], 100.0 - (dist * 10))
