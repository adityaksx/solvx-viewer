from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ..models.requests import RegionRequest, PointQuery
from ..services.ocean_data_service import (
    get_ocean_catalog,
    get_ocean_time,
    get_ocean_current_grid,
    get_ocean_point,
    get_region_array
)

router = APIRouter(prefix='/api/ocean', tags=['Ocean Data'])

@router.get('/catalog')
def ocean_catalog():
    """Returns available scientific variables and their physical attributes."""
    return get_ocean_catalog()

@router.get('/time')
def ocean_time():
    """Returns available temporal coordinate steps."""
    return get_ocean_time()

@router.get('/current-grid')
def ocean_current_grid(
    time: Optional[str] = None,
    depth: Optional[float] = None,
    stride: int = Query(3, ge=1, le=20)
):
    """Returns horizontal ocean current velocity vectors (u, v) across the grid."""
    return get_ocean_current_grid(time=time, depth=depth, stride=stride)

@router.get('/point')
def ocean_point(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    time: Optional[str] = None
):
    """Inspects all physical ocean variables at a specific geographic point."""
    return get_ocean_point(latitude=latitude, longitude=longitude, time=time)

@router.get('/region-array')
def ocean_region_array(
    file: str = Query(...),
    variable: str = Query(...),
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    stride: int = Query(1, ge=1, le=20)
):
    """Retrieves 3D array data for a specific NetCDF variable subset."""
    return get_region_array(
        file=file,
        variable=variable,
        lat_min=lat_min,
        lat_max=lat_max,
        lon_min=lon_min,
        lon_max=lon_max,
        depth_min=depth_min,
        depth_max=depth_max,
        time_start=time_start,
        time_end=time_end,
        stride=stride
    )

@router.post('/query')
def query_region_ocean(req: RegionRequest):
    """Retrieves multidimensional ocean data matching a RegionRequest."""
    catalog = get_ocean_catalog()
    avail = [v for v in catalog.get('variables', []) if v.get('available')]
    return {
        'bbox': req.bbox.model_dump(),
        'available_variables': avail,
        'requested_variables': req.variables,
        'status': 'ready'
    }
