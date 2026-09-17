from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ..config import PRESET_REGIONS, DEFAULT_BBOX
from ..models.requests import BBox
from ..processing.coordinate_utils import get_region_projection

router = APIRouter(prefix='/api/region', tags=['Region'])

@router.get('/presets')
def get_presets():
    """Returns preset major ocean basins available for instant exploration."""
    return {'presets': PRESET_REGIONS}

@router.get('')
@router.get('/')
def get_region_info(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
):
    """Validates bounding box and returns geographic dimensions."""
    if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
    if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']
    if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
    if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
    try:
        bbox = BBox(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    mid_lon, mid_lat, klon, klat = get_region_projection(bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat)
    width_km = (bbox.max_lon - bbox.min_lon) * klon
    height_km = (bbox.max_lat - bbox.min_lat) * klat

    return {
        'bbox': bbox.model_dump(),
        'center': {'latitude': mid_lat, 'longitude': mid_lon},
        'dimensions_km': {'width': round(width_km, 2), 'height': round(height_km, 2)},
        'valid': True
    }

@router.post('/validate')
def validate_region(bbox: BBox):
    mid_lon, mid_lat, klon, klat = get_region_projection(bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat)
    width_km = (bbox.max_lon - bbox.min_lon) * klon
    height_km = (bbox.max_lat - bbox.min_lat) * klat
    return {
        'bbox': bbox.model_dump(),
        'center': {'latitude': mid_lat, 'longitude': mid_lon},
        'dimensions_km': {'width': round(width_km, 2), 'height': round(height_km, 2)},
        'valid': True
    }
