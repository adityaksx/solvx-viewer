from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from ..services.observation_service import (
    get_observations,
    get_observation_comparison,
    get_argo_observations,
    get_argo_float
)

router = APIRouter(prefix='/api/observations', tags=['Observations'])

@router.get('/argo')
def list_argo_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
):
    """
    Retrieves normalized in-situ Argo float observation profiles filtered by bounding box.
    Returns: source, float_id, wmo, coordinates, depth_range, profile points, and metadata.
    """
    obs = get_argo_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    return {
        'source': 'ARGO',
        'count': len(obs),
        'observations': obs
    }

@router.get('/argo/{float_id}')
def get_argo_profile(float_id: str):
    """
    Retrieves a single Argo float profile and its complete sounding measurements.
    """
    float_data = get_argo_float(float_id)
    if not float_data:
        raise HTTPException(status_code=404, detail=f"Argo float '{float_id}' not found")
    return float_data

@router.get('')
@router.get('/')
def list_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
):
    """Retrieves in-situ observation records within the bounding box."""
    obs = get_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    return {'count': len(obs), 'observations': obs}

@router.get('/compare/{obs_id}')
def compare_observation(obs_id: str):
    """Performs vertical profile comparison between in-situ observation and collocated ocean model readings."""
    res = get_observation_comparison(obs_id)
    if 'error' in res:
        raise HTTPException(status_code=404, detail=res['error'])
    return res
