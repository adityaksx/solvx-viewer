from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from ..models.requests import BBox
from ..services.data_collector import COLLECTOR

router = APIRouter(prefix='/api/data', tags=['Central Data Collection'])

@router.get('/variables')
def get_variables_catalog():
    """Returns catalogue of all physical ocean variables supported by the collector."""
    try:
        return COLLECTOR.get_variables_catalog()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/geometry')
def get_geometry(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0)
):
    """Retrieves 3D land polygons and coastline boundaries for the requested region."""
    try:
        return COLLECTOR.get_geometry(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/coastline')
def get_coastline(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0)
):
    """Retrieves shoreline contours and maritime EEZ boundaries."""
    try:
        return COLLECTOR.get_coastline(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/bathymetry')
def get_bathymetry(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    resolution: str = Query('0.083deg')
):
    """Retrieves 3D bathymetric seabed elevation grid for the requested region."""
    try:
        return COLLECTOR.get_bathymetry(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            resolution=resolution
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/ocean')
def get_ocean_variables(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0),
    time: Optional[str] = Query(None)
):
    """Retrieves all standard oceanographic variables (temperature, salinity, currents)."""
    try:
        return COLLECTOR.get_ocean_variables(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time_str=time
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/ocean/{variable}')
def get_ocean_variable(
    variable: str,
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0),
    time: Optional[str] = Query(None),
    stride: int = Query(1, ge=1, le=20)
):
    """Retrieves and normalizes a specific physical ocean variable (from INCOIS / Ocean Bank)."""
    try:
        return COLLECTOR.get_ocean_variable(
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time_str=time,
            stride=stride
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/timeline')
def get_variable_timeline(
    variable: str = Query('temperature'),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0)
):
    """Retrieves temporal coverage, time resolution, and forecast availability for a variable."""
    try:
        return COLLECTOR.get_timeline(
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/eez')
def get_eez(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0)
):
    """Retrieves official Marine Regions / VLIZ EEZ boundaries (GeoJSON & 3D lines)."""
    try:
        return COLLECTOR.get_eez(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/observations')
def get_observations(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0)
):
    """Retrieves in-situ observation records (e.g. Argo float sounding profiles)."""
    try:
        return COLLECTOR.get_observations(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/observations/compare/{obs_id}')
def compare_observation(
    obs_id: str,
    variable: str = Query('temperature')
):
    """Compares float vertical sounding profile against collocated ocean model output."""
    try:
        res = COLLECTOR.get_observation_comparison(obs_id=obs_id, variable=variable)
        if 'error' in res:
            raise HTTPException(status_code=404, detail=res['error'])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
