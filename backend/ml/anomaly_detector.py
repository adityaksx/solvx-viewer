import numpy as np
from typing import Dict, Any, List, Tuple
from .feature_engineering import extract_spatial_features, calculate_anomaly_grid
from .config import ML_ANOMALY_THRESHOLDS

def detect_anomalies(grid_data: Dict[str, Any]) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Runs unsupervised multivariate anomaly detection on the provided grid data.
    """
    features = extract_spatial_features(grid_data)
    anomaly_grid = calculate_anomaly_grid(features)
    
    return anomaly_grid, features

def get_anomaly_severity(score: float) -> str:
    if score >= ML_ANOMALY_THRESHOLDS['extreme']:
        return 'extreme'
    if score >= ML_ANOMALY_THRESHOLDS['high']:
        return 'high'
    if score >= ML_ANOMALY_THRESHOLDS['moderate']:
        return 'moderate'
    if score >= ML_ANOMALY_THRESHOLDS['low']:
        return 'low'
    return 'normal'

def analyze_point_anomaly(lat_idx: int, lon_idx: int, features: Dict[str, Any], composite_score: float) -> Dict[str, Any]:
    """
    Provides explainability for a specific grid cell's anomaly score.
    """
    contributing_vars = []
    feature_contributions = {}
    
    for var, data in features.items():
        arr = data['array']
        if np.isnan(arr[lat_idx, lon_idx]):
            continue
            
        val = arr[lat_idx, lon_idx]
        mean = data['mean']
        std = data['std']
        
        if std > 0:
            z_score = abs(val - mean) / std
            if z_score > 1.0:
                contributing_vars.append(var)
                feature_contributions[f"{var}_zscore"] = float(z_score)
                feature_contributions[f"{var}_diff"] = float(val - mean)
                
    # Sort contributing vars by zscore
    contributing_vars.sort(key=lambda x: feature_contributions.get(f"{x}_zscore", 0), reverse=True)
    
    return {
        'score': float(composite_score),
        'severity': get_anomaly_severity(composite_score),
        'affected_variables': contributing_vars,
        'features': feature_contributions
    }
