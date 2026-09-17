"""
SolvX Bathymetry API Router
===========================
Endpoints for retrieving authoritative GEBCO 3D bathymetric elevation grids.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ..config import DEFAULT_BBOX
from ..models.requests import BBox, BathymetryRequest
from ..services.bathymetry_service import get_bathymetry_data

router = APIRouter(prefix='/api/bathymetry', tags=['Bathymetry'])


@router.get('')
@router.get('/')
def get_bathymetry(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    resolution: Optional[str] = Query('medium', description='Downsampling: low, medium, high, native')
):
    """Retrieves 3D bathymetric seabed elevation grid for the requested region."""
    if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
    if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']
    if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
    if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
    try:
        bbox = BBox(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return get_bathymetry_data(
            bbox.min_lon,
            bbox.max_lon,
            bbox.min_lat,
            bbox.max_lat,
            resolution=resolution
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate bathymetry: {e}")


@router.post('')
@router.post('/')
def post_bathymetry(request: BathymetryRequest):
    """Retrieves GEBCO bathymetry elevation grid via POST body."""
    try:
        return get_bathymetry_data(
            request.bbox.min_lon,
            request.bbox.max_lon,
            request.bbox.min_lat,
            request.bbox.max_lat,
            resolution=request.resolution or 'medium'
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate bathymetry: {e}")