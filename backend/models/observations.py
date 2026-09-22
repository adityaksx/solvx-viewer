from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class ArgoMeasurementPoint(BaseModel):
    """Discrete vertical soundings at a specific depth."""
    depth: float
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    chlorophyll: Optional[float] = None

class ArgoFloatProfile(BaseModel):
    """Normalized in-situ observation record for an Argo profiling float."""
    source: str = 'ARGO'
    float_id: str
    wmo: int
    latitude: float
    longitude: float
    timestamp: str
    platform: str
    cycle: int
    profile: List[ArgoMeasurementPoint]
    depth_range: List[float] = Field(default_factory=list)
    available_variables: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ArgoListResponse(BaseModel):
    """Response envelope for multiple Argo float records."""
    source: str = 'ARGO'
    count: int
    observations: List[ArgoFloatProfile]
