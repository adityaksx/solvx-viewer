from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, field_validator, model_validator
from backend.config import MAX_REQUEST_AREA_DEG2

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

SUPPORTED_OCEAN_PROVIDERS = {'auto', 'incois', 'copernicus', 'noaa', 'hycom'}
SUPPORTED_OCEAN_VARIABLES = {
    'temperature', 'salinity', 'currents', 'sea_surface_height',
    'sea_level_anomaly', 'mixed_layer_depth', 'tropical_cyclone_heat_potential', 'chlorophyll'
}

class OceanVariableRequest(BaseModel):
    provider: str = 'auto'
    variable: str = 'temperature'
    bbox: BBox
    time: Optional[str] = None
    depth: Optional[float] = None
    resolution: Optional[str] = 'native'
    stride: int = 1

    @model_validator(mode='after')
    def validate_request(self):
        prov_lower = self.provider.strip().lower()
        if prov_lower not in SUPPORTED_OCEAN_PROVIDERS:
            raise ValueError(f"Unsupported provider '{self.provider}'. Supported: {sorted(list(SUPPORTED_OCEAN_PROVIDERS))}")
        self.provider = prov_lower

        var_lower = self.variable.strip().lower()
        if var_lower not in SUPPORTED_OCEAN_VARIABLES:
            raise ValueError(f"Unsupported variable '{self.variable}'. Supported: {sorted(list(SUPPORTED_OCEAN_VARIABLES))}")
        self.variable = var_lower

        if self.depth is not None and not (0.0 <= self.depth <= 6000.0):
            raise ValueError("depth must be between 0 and 6000 meters")

        if self.bbox.area_deg2 > MAX_REQUEST_AREA_DEG2:
            raise ValueError(f"Requested region area ({self.bbox.area_deg2:.1f} deg²) exceeds maximum allowed limit ({MAX_REQUEST_AREA_DEG2:.1f} deg²)")

        return self

SUPPORTED_BATHYMETRY_RESOLUTIONS = {'low', 'medium', 'high', 'native'}

class BathymetryRequest(BaseModel):
    bbox: BBox
    resolution: Optional[str] = 'medium'

    @model_validator(mode='after')
    def validate_request(self):
        if self.resolution is not None and self.resolution.lower() not in SUPPORTED_BATHYMETRY_RESOLUTIONS:
            raise ValueError(f"Unsupported bathymetry resolution '{self.resolution}'. Supported: {sorted(list(SUPPORTED_BATHYMETRY_RESOLUTIONS))}")
        if self.bbox.area_deg2 > MAX_REQUEST_AREA_DEG2:
            raise ValueError(f"Requested region area ({self.bbox.area_deg2:.1f} deg²) exceeds maximum allowed limit ({MAX_REQUEST_AREA_DEG2:.1f} deg²)")
        return self

class CombinedRegionRequest(BaseModel):
    provider: str = 'auto'
    variable: str = 'temperature'
    bbox: BBox
    time: Optional[str] = None
    depth: Optional[float] = None
    resolution: Optional[str] = 'medium'
    include_bathymetry: bool = True

    @model_validator(mode='after')
    def validate_request(self):
        prov_lower = self.provider.strip().lower()
        if prov_lower not in SUPPORTED_OCEAN_PROVIDERS:
            raise ValueError(f"Unsupported provider '{self.provider}'. Supported: {sorted(list(SUPPORTED_OCEAN_PROVIDERS))}")
        self.provider = prov_lower

        var_lower = self.variable.strip().lower()
        if var_lower not in SUPPORTED_OCEAN_VARIABLES:
            raise ValueError(f"Unsupported variable '{self.variable}'. Supported: {sorted(list(SUPPORTED_OCEAN_VARIABLES))}")
        self.variable = var_lower

        if self.resolution is not None and self.resolution.lower() not in SUPPORTED_BATHYMETRY_RESOLUTIONS:
            raise ValueError(f"Unsupported bathymetry resolution '{self.resolution}'. Supported: {sorted(list(SUPPORTED_BATHYMETRY_RESOLUTIONS))}")

        if self.bbox.area_deg2 > MAX_REQUEST_AREA_DEG2:
            raise ValueError(f"Requested region area ({self.bbox.area_deg2:.1f} deg²) exceeds maximum allowed limit ({MAX_REQUEST_AREA_DEG2:.1f} deg²)")
        return self

# ==============================================================================
# Standard SolvX Response Models
# ==============================================================================

class OceanVariableResponse(BaseModel):
    type: str = 'ocean_variable'
    requested_provider: str
    provider: str
    fallback: bool = False
    dataset: str
    variable: str
    units: str
    time: Optional[str] = None
    depth: Optional[float] = None
    bbox: Dict[str, float]
    latitude: List[float]
    longitude: List[float]
    values: Any
    metadata: Dict[str, Any] = {}

class OceanCurrentsResponse(BaseModel):
    type: str = 'ocean_variable'
    requested_provider: str
    provider: str
    fallback: bool = False
    dataset: str
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

class BathymetryResponse(BaseModel):
    type: str = 'bathymetry'
    provider: str = 'GEBCO'
    dataset: str = 'GEBCO 2026 Grid'
    units: str = 'meters'
    bbox: Dict[str, float]
    latitude: List[float]
    longitude: List[float]
    elevation: List[List[Optional[float]]]
    x: Optional[List[float]] = None
    y: Optional[List[float]] = None
    rawDepthKm: Optional[List[List[Optional[float]]]] = None
    maxDepthKm: Optional[float] = None
    metadata: Dict[str, Any] = {}

class CombinedRegionResponse(BaseModel):
    region: Dict[str, Any]
    ocean: Optional[Union[OceanVariableResponse, OceanCurrentsResponse, Dict[str, Any]]] = None
    bathymetry: Optional[Union[BathymetryResponse, Dict[str, Any]]] = None
    metadata: Dict[str, Any] = {}

# Legacy aliases for backward compatibility
SolvXOceanResponse = OceanVariableResponse
SolvXCurrentsResponse = OceanCurrentsResponse
SolvXBathymetryResponse = BathymetryResponse

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

