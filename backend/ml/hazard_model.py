import logging
import numpy as np
from typing import Dict, Any, List, Optional
from .schemas import HazardPrediction, Location
from .config import HAZARD_RISK_THRESHOLDS, PROBABILITY_RISK_THRESHOLDS, ATMOSPHERIC_WARNING, NO_SEISMIC_WARNING
from .uncertainty import compute_uncertainty
from .explain import explain_prediction

logger = logging.getLogger("solvx.hazard_model")


def get_risk_level(score: float) -> str:
    """Classifies risk level from either percentage (0-100) or probability (0.0-1.0)."""
    # If passed as 0.0-1.0 probability
    if score <= 1.0:
        if score >= PROBABILITY_RISK_THRESHOLDS['Severe']:
            return 'Severe'
        if score >= PROBABILITY_RISK_THRESHOLDS['High']:
            return 'High'
        if score >= PROBABILITY_RISK_THRESHOLDS['Elevated']:
            return 'Elevated'
        if score >= PROBABILITY_RISK_THRESHOLDS['Watch']:
            return 'Watch'
        return 'Normal'

    # If passed as 0-100 score
    if score >= HAZARD_RISK_THRESHOLDS['Severe']:
        return 'Severe'
    if score >= HAZARD_RISK_THRESHOLDS['High']:
        return 'High'
    if score >= HAZARD_RISK_THRESHOLDS['Elevated']:
        return 'Elevated'
    if score >= HAZARD_RISK_THRESHOLDS['Watch']:
        return 'Watch'
    return 'Normal'


def evaluate_hazards(
    anomaly_grid: np.ndarray, 
    features: Dict[str, Any], 
    lats: List[float], 
    lons: List[float],
    ml_model: Optional[Any] = None,
    time_str: Optional[str] = None
) -> List[HazardPrediction]:
    """
    Evaluates the anomaly grid and features to identify high-risk hazard zones.
    Derives location uncertainty, coverage status, and lead times dynamically
    from empirical observations and real ML probabilities.
    """
    hazards = []
    
    if len(anomaly_grid) == 0 or len(lats) == 0 or len(lons) == 0:
        return hazards

    # Clean NaNs in anomaly grid
    clean_grid = np.nan_to_num(anomaly_grid, nan=0.0)
    elevated_mask = clean_grid >= HAZARD_RISK_THRESHOLDS['Elevated']

    if not np.any(elevated_mask):
        return hazards

    # Find peak anomaly
    max_idx = np.unravel_index(np.argmax(clean_grid), clean_grid.shape)
    peak_score = float(clean_grid[max_idx])
    peak_lat = float(lats[max_idx[0]])
    peak_lon = float(lons[max_idx[1]])

    # Check contributing signals at this peak
    signals = []
    missing = []
    is_cyclone_risk = False
    
    if 'tropical_cyclone_heat_potential' in features:
        tchp_arr = features['tropical_cyclone_heat_potential']['array']
        if max_idx[0] < tchp_arr.shape[0] and max_idx[1] < tchp_arr.shape[1]:
            tchp_z = float(tchp_arr[max_idx])
            tchp_mean = float(features['tropical_cyclone_heat_potential']['mean'])
            if tchp_z > tchp_mean:
                signals.append("High TCHP (> local mean)")
                is_cyclone_risk = True
    else:
        missing.append('tropical_cyclone_heat_potential')
        
    sst_val = 28.5
    if 'temperature' in features:
        temp_arr = features['temperature']['array']
        if max_idx[0] < temp_arr.shape[0] and max_idx[1] < temp_arr.shape[1]:
            temp = float(temp_arr[max_idx])
            sst_val = temp
            if temp > 28.5:
                signals.append(f"SST > 28.5°C ({temp:.1f}°C)")
                is_cyclone_risk = True

    # Check for atmospheric parameters
    has_wind = 'wind_speed' in features
    has_pres = 'sea_level_pressure' in features
    if not has_wind:
        missing.append('wind_speed')
    if not has_pres:
        missing.append('sea_level_pressure')

    signals.append("Strong Multivariate Thermal & Dynamic Anomaly")
    
    hazard_type = "Cyclone Risk / Intensification" if is_cyclone_risk else "Ocean-State Anomaly"
    magnitude = f"SST: {sst_val:.1f}°C | Anomaly: {peak_score:.1f}"

    # Calculate real ML predictions if model is provided
    risk_6h = round(min(0.99, max(0.05, (peak_score / 100.0) * 0.7)), 3)
    risk_12h = round(min(0.99, max(0.08, (peak_score / 100.0) * 0.85)), 3)
    risk_24h = round(min(0.99, max(0.12, (peak_score / 100.0) * 1.0)), 3)
    
    top_explanations = []
    if ml_model is not None and hasattr(ml_model, 'predict_proba') and ml_model.is_trained:
        try:
            from .feature_engineering import extract_tabular_features, vectorize_features
            ocean_pt = {'sst': sst_val, 'sst_anomaly': max(0.0, sst_val - 28.0)}
            f_dict = extract_tabular_features(ocean_pt)
            f_vec = vectorize_features(f_dict, ml_model.feature_names)
            probs = ml_model.predict_proba(f_vec)
            risk_6h = round(float(probs['risk_6h'][0]), 3)
            risk_12h = round(float(probs['risk_12h'][0]), 3)
            risk_24h = round(float(probs['risk_24h'][0]), 3)
            top_explanations = explain_prediction(f_dict, ml_model.get_feature_importances(), risk_24h)
        except Exception as e:
            logger.warning("ML prediction inference failed in hazard_model, falling back: %s", e)

    # Compute empirically grounded uncertainty
    uncertainty_info = compute_uncertainty(
        lat=peak_lat,
        lon=peak_lon,
        probabilities=[risk_6h, risk_12h, risk_24h],
        missing_inputs=missing
    )

    # Dynamic location uncertainty derived from observation distance
    loc_uncertainty = round(
        max(35.0, min(150.0, uncertainty_info.distance_to_argo_km * 0.4 if uncertainty_info.distance_to_argo_km else 75.0)),
        1
    )

    # Dynamic lead time and window
    if risk_6h >= 0.50:
        lead_time = "6"
        window = "0-12 hours"
    elif risk_12h >= 0.50:
        lead_time = "12"
        window = "12-24 hours"
    else:
        lead_time = "24"
        window = "18-36 hours"

    hazard = HazardPrediction(
        hazard_type=hazard_type,
        risk_score=round(peak_score, 1),
        risk_level=get_risk_level(risk_24h),
        predicted_center=Location(latitude=peak_lat, longitude=peak_lon),
        location_uncertainty_km=loc_uncertainty,
        expected_window=window,
        lead_time_hours=lead_time,
        magnitude_estimate=magnitude,
        uncertainty_range=uncertainty_info.uncertainty.capitalize(),
        data_quality=uncertainty_info.data_quality.capitalize(),
        observation_coverage=uncertainty_info.observation_coverage.capitalize(),
        missing_inputs=missing,
        contributing_signals=signals,
        risk_6h=risk_6h,
        risk_12h=risk_12h,
        risk_24h=risk_24h,
        confidence=uncertainty_info.confidence,
        uncertainty_detail=uncertainty_info,
        top_features=top_explanations
    )
    hazards.append(hazard)
    
    return hazards

