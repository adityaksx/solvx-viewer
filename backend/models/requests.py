from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, field_validator, model_validator

class BBox(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

    @model_validator(mode='after')
    def validate_bounds(self):
        if not (-90.0 <= self.min_lat <= 90.0 and -90.0 <= self.max_lat <= 90.0):
            raise ValueError('Latitude must be between -90 and 90 degrees')
        if not (-180.0 <= self.min_lon <= 180.0 and -180.0 <= self.max_lon <= 180.0):
            raise ValueError('Longitude must be between -180 and 180 degrees')
        if self.min_lat >= self.max_lat:
            raise ValueError('min_lat must be strictly less than max_lat')
        if self.min_lon >= self.max_lon:
            raise ValueError('min_lon must be strictly less than max_lon')
        return self

    @property
    def area_deg2(self) -> float:
        return (self.max_lon - self.min_lon) * (self.max_lat - self.min_lat)

class TimeRange(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None

class DepthRange(BaseModel):
    min: Optional[float] = 0.0
    max: Optional[float] = 5000.0

    @model_validator(mode='after')
    def validate_depth(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError('min depth cannot exceed max depth')
        return self

class RegionRequest(BaseModel):
    bbox: BBox
    time: Optional[TimeRange] = None
    depth: Optional[DepthRange] = None
    variables: Optional[List[str]] = ['temperature', 'salinity', 'currents', 'sea_level']
    resolution: Optional[str] = 'medium'

class PointQuery(BaseModel):
    latitude: float
    longitude: float
    time: Optional[str] = None
    depth: Optional[float] = None

    @model_validator(mode='after')
    def validate_coords(self):
        if not (-90.0 <= self.latitude <= 90.0):
            raise ValueError('Latitude must be between -90 and 90')
        if not (-180.0 <= self.longitude <= 180.0):
            raise ValueError('Longitude must be between -180 and 180')
        return self

# ==============================================================================
# Standard SolvX Response Models
# ==============================================================================

class SolvXOceanResponse(BaseModel):
    source: Union[str, Dict[str, Any]]
    variable: str
    units: str
    time: Optional[str] = None
    depth: Optional[float] = None
    bbox: Dict[str, float]
    latitude: List[float]
    longitude: List[float]
    values: Any
    metadata: Dict[str, Any] = {}

class SolvXCurrentsResponse(BaseModel):
    source: Union[str, Dict[str, Any]]
    variable: str = 'currents'
    units: str = 'm/s'
    time: Optional[str] = None
    depth: Optional[float] = None
    bbox: Dict[str, float]
    latitude: List[float]
    longitude: List[float]
    u: List[List[Optional[float]]]
    v: List[List[Optional[float]]]
    speed: List[List[Optional[float]]]
    direction: List[List[Optional[float]]]
    metadata: Dict[str, Any] = {}

class SolvXBathymetryResponse(BaseModel):
    source: Union[str, Dict[str, Any]]
    bbox: Dict[str, float]
    resolution: str = '0.083deg'
    latitude: List[float]
    longitude: List[float]
    depth: List[List[Optional[float]]]
    x: List[float]
    y: List[float]
    rawDepthKm: List[List[Optional[float]]]
    maxDepthKm: float
    units: str = 'meters'
    metadata: Dict[str, Any] = {}

class SolvXGeographyResponse(BaseModel):
    source: Union[str, Dict[str, Any]]
    bounds: List[float]
    land: List[List[Dict[str, float]]]
    coast: List[List[Dict[str, float]]]
    islands: List[Any] = []
    landBoundary: List[Any] = []
    islandCoast: List[Any] = []
    eezBeads: List[Any] = []
    metadata: Dict[str, Any] = {}

class SolvXVariableItem(BaseModel):
    id: str
    name: str
    standard_name: str
    units: str
    has_depth: bool
    surface_only: bool
    description: str
    source: str
    min_val: Optional[float] = None
    max_val: Optional[float] = None

class SolvXVariableCatalogResponse(BaseModel):
    source: str
    count: int
    variables: List[SolvXVariableItem]

class SolvXObservationItem(BaseModel):
    id: str
    wmo: int
    latitude: float
    longitude: float
    date: str
    platform: str
    cycles: int
    profile: List[Dict[str, Any]]

class SolvXObservationsResponse(BaseModel):
    source: str
    count: int
    observations: List[SolvXObservationItem]
    metadata: Dict[str, Any] = {}

