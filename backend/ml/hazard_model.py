import numpy as np
from typing import Dict, Any, List
from .schemas import HazardPrediction, Location
from .config import HAZARD_RISK_THRESHOLDS, ATMOSPHERIC_WARNING, NO_SEISMIC_WARNING

def get_risk_level(score: float) -> str:
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
    lons: List[float]
) -> List[HazardPrediction]:
    """
    Evaluates the anomaly grid and features to identify high-risk hazard zones.
    Groups adjacent high-anomaly cells to form discrete hazard warnings.
    """
    hazards = []
    
    if len(anomaly_grid) == 0:
        return hazards
        
    # Find the peak anomaly in the grid
    max_idx = np.unravel_index(np.nanargmax(anomaly_grid), anomaly_grid.shape)
    peak_score = float(anomaly_grid[max_idx])
    
    # If the peak score is above 'Elevated', we flag a hazard.
    # In a real system, we would run connected-components to find multiple hazards.
    # For this prototype, we'll flag the primary cluster.
    
    if peak_score >= HAZARD_RISK_THRESHOLDS['Elevated']:
        peak_lat = lats[max_idx[0]]
        peak_lon = lons[max_idx[1]]
        
        # Check contributing signals at this peak
        signals = []
        missing = []
        is_cyclone_risk = False
        
        if 'tropical_cyclone_heat_potential' in features:
            tchp_z = features['tropical_cyclone_heat_potential']['array'][max_idx]
            tchp_mean = features['tropical_cyclone_heat_potential']['mean']
            if tchp_z > tchp_mean:
                signals.append(f"High TCHP")
                is_cyclone_risk = True
        else:
            missing.append('tropical_cyclone_heat_potential')
            
        if 'temperature' in features:
            temp = features['temperature']['array'][max_idx]
            if temp > 28.5: # standard threshold for cyclone formation
                signals.append(f"SST > 28.5°C ({temp:.1f}°C)")
                is_cyclone_risk = True
                
        # Atmospheric data is missing in SolvX by default
        missing.extend(['wind_speed', 'atmospheric_pressure', 'humidity'])
        signals.append("Strong Multivariate Anomaly")
        
        hazard_type = "Cyclone Risk / Intensification" if is_cyclone_risk else "Ocean-State Anomaly"
        magnitude = "Unknown (No Wind Data)" if is_cyclone_risk else f"Anomaly Score: {peak_score:.1f}"
        
        hazard = HazardPrediction(
            hazard_type=hazard_type,
            risk_score=peak_score,
            risk_level=get_risk_level(peak_score),
            predicted_center=Location(latitude=peak_lat, longitude=peak_lon),
            location_uncertainty_km=85.0, # Prototype default
            expected_window="18-36 hours",
            lead_time_hours="24",
            magnitude_estimate=magnitude,
            uncertainty_range="High",
            data_quality="Moderate (Ocean Only)",
            observation_coverage="Sparse",
            missing_inputs=missing,
            contributing_signals=signals
        )
        hazards.append(hazard)
        
    return hazards
