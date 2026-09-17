from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from ..services.observation_service import get_observations, get_observation_comparison

router = APIRouter(prefix='/api/observations', tags=['Observations'])

@router.get('')
@router.get('/')
def list_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
):
    """Retrieves in-situ observation records (e.g. Argo float profiles) within the bounding box."""
    obs = get_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    return {'count': len(obs), 'observations': obs}

@router.get('/compare/{obs_id}')
def compare_observation(obs_id: str):
    """Performs vertical profile comparison between in-situ observation and collocated ocean model readings."""
    res = get_observation_comparison(obs_id)
    if 'error' in res:
        raise HTTPException(status_code=404, detail=res['error'])
    return res
