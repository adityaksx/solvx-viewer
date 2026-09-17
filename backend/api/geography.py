from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ..config import DEFAULT_BBOX
from ..models.requests import BBox
from ..services.geography_service import get_geography_data

router = APIRouter(prefix='/api/geography', tags=['Geography'])

@router.get('')
@router.get('/')
def get_geography(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
):
    """Retrieves 3D land polygons, coastline vectors, and maritime EEZ boundaries for the requested region."""
    if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
    if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']
    if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
    if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
    try:
        bbox = BBox(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return get_geography_data(bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate geography: {e}")
