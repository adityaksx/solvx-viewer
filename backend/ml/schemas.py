from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


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


class FeatureExplanation(BaseModel):
    feature: str = Field(..., description="Name of the ocean/atmospheric feature")
    importance: float = Field(..., description="Normalized feature importance score (0-1)")
    value: Optional[float] = Field(None, description="Current value of the feature at target point")
    direction: str = Field("elevates_risk", description="elevates_risk | reduces_risk | neutral")
    description: str = Field(..., description="Plain-language explanation of this factor's role")


class UncertaintyDetail(BaseModel):
    confidence: float = Field(..., description="Model certainty score from 0.0 to 1.0")
    uncertainty: str = Field(..., description="low | moderate | high")
    observation_coverage: str = Field(..., description="dense | adequate | sparse | none")
    data_quality: str = Field(..., description="high | moderate | degraded")
    distance_to_argo_km: Optional[float] = Field(None, description="Distance to nearest in-situ Argo profiling float")
    missing_inputs: List[str] = Field(default_factory=list, description="List of unobserved/missing inputs")


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
    # Real ML multi-horizon fields
    risk_6h: Optional[float] = Field(None, description="Predicted 6-hour hazard probability (0.0 to 1.0)")
    risk_12h: Optional[float] = Field(None, description="Predicted 12-hour hazard probability (0.0 to 1.0)")
    risk_24h: Optional[float] = Field(None, description="Predicted 24-hour hazard probability (0.0 to 1.0)")
    confidence: Optional[float] = Field(None, description="Model confidence score (0.0 to 1.0)")
    uncertainty_detail: Optional[UncertaintyDetail] = None
    top_features: List[FeatureExplanation] = Field(default_factory=list)


class MLPointResponse(BaseModel):
    location: Location
    time: str
    values: Dict[str, Any]
    depth_profiles: Dict[str, List[Dict[str, float]]]
    anomaly: Optional[AnomalyScore]
    hazard: Optional[HazardPrediction]
    observations_comparison: Dict[str, Any]
    data_quality: Dict[str, Any]
    risk_forecast: Optional[Dict[str, float]] = None
    model_version: Optional[str] = None


class RegionAnomalyResponse(BaseModel):
    time: str
    bbox: Dict[str, float]
    scores: List[List[float]]  # 2D grid of anomaly scores matching requested resolution
    lats: List[float]
    lons: List[float]
    hazards: List[HazardPrediction]
    risk_grid_24h: Optional[List[List[float]]] = None
    is_demo: bool = False


class MLPredictRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude coordinate")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude coordinate")
    time: Optional[str] = Field(None, description="ISO timestamp for prediction target")
    depth: Optional[float] = Field(None, description="Depth level in meters")


class MLPredictResponse(BaseModel):
    location: Location
    time: str
    risk_6h: float = Field(..., description="6-hour ocean hazard risk probability (0.0 - 1.0)")
    risk_12h: float = Field(..., description="12-hour ocean hazard risk probability (0.0 - 1.0)")
    risk_24h: float = Field(..., description="24-hour ocean hazard risk probability (0.0 - 1.0)")
    risk_class: str = Field(..., description="Normal | Watch | Elevated | High | Severe")
    confidence: float = Field(..., description="Confidence metric (0.0 - 1.0)")
    uncertainty: UncertaintyDetail
    top_features: List[FeatureExplanation]
    model_version: str
    focus: Dict[str, Any] = Field(default_factory=dict, description="3D viewer focus context")


class ModelInfoResponse(BaseModel):
    model_name: str = "Ocean Hazard Risk Model"
    version: str = "v0.1"
    algorithm: str = "Gradient Boosted Trees (HistGradientBoostingClassifier)"
    status: str = "Trained and Active"
    training_period: Optional[str] = None
    validation_period: Optional[str] = None
    test_period: Optional[str] = None
    sample_count: Optional[int] = None
    test_metrics: Dict[str, Any] = Field(default_factory=dict)
    feature_importances: Dict[str, float] = Field(default_factory=dict)
    last_trained: Optional[str] = None
    input_features: List[str] = Field(default_factory=list)

