from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class Location(BaseModel):
    latitude: float
    longitude: float
    depth_min: Optional[float] = None
    depth_max: Optional[float] = None

class AnomalyScore(BaseModel):
    location: Location
    anomaly_score: float  # 0 to 100
    severity: str  # 'normal', 'low', 'moderate', 'high', 'extreme'
    affected_variables: List[str]
    features: Dict[str, float]

class HazardPrediction(BaseModel):
    hazard_type: str
    risk_score: float  # 0 to 100
    risk_level: str  # 'Normal', 'Watch', 'Elevated', 'High', 'Severe'
    predicted_center: Location
    location_uncertainty_km: float
    expected_window: str
    lead_time_hours: Optional[str]
    magnitude_estimate: str
    uncertainty_range: str
    data_quality: str
    observation_coverage: str
    missing_inputs: List[str]
    contributing_signals: List[str]

class MLPointResponse(BaseModel):
    location: Location
    time: str
    values: Dict[str, Any]
    depth_profiles: Dict[str, List[Dict[str, float]]]
    anomaly: Optional[AnomalyScore]
    hazard: Optional[HazardPrediction]
    observations_comparison: Dict[str, Any]
    data_quality: Dict[str, Any]

class RegionAnomalyResponse(BaseModel):
    time: str
    bbox: Dict[str, float]
    scores: List[List[float]]  # 2D grid of anomaly scores matching requested resolution
    lats: List[float]
    lons: List[float]
    hazards: List[HazardPrediction]
