from typing import Optional, List
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
