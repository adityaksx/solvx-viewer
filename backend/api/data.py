"""
SolvX Central Data API Router
=============================
Exposes unified endpoints for oceanographic variables across providers
(INCOIS, Copernicus Marine, NOAA, HYCOM) and GEBCO bathymetry.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Body

from ..models.requests import (
    BBox,
    OceanVariableRequest,
    BathymetryRequest,
    CombinedRegionRequest,
    OceanVariableResponse,
    OceanCurrentsResponse,
    BathymetryResponse,
    CombinedRegionResponse
)
from ..services.data_collector import COLLECTOR

router = APIRouter(prefix='/api/data', tags=['Central Data Collection'])


# =============================================================================
# Provider Registry and Status
# =============================================================================

@router.get('/providers')
def get_providers():
    """Lists all available oceanographic providers, their capabilities, and coverage."""
    try:
        return COLLECTOR.get_providers()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/providers/status')
def get_providers_status():
    """Live diagnostic check of all oceanographic and bathymetric data feeds."""
    try:
        return COLLECTOR.get_provider_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/providers/{provider}/variables')
def get_provider_variables(provider: str):
    """Returns the list of variables supported by a given provider."""
    try:
        return COLLECTOR.get_provider_variables(provider)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/providers/{provider}/datasets')
def get_provider_datasets(provider: str):
    """Returns dataset IDs and metadata for a provider."""
    try:
        return COLLECTOR.get_provider_datasets(provider)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/providers/{provider}/metadata')
def get_provider_metadata(provider: str):
    """Returns comprehensive metadata and source description for a provider."""
    try:
        return COLLECTOR.get_provider_metadata(provider)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Oceanographic Data Endpoints
# =============================================================================

@router.get('/ocean')
def get_ocean_data(
    provider: str = Query('auto', description='Provider: auto, incois, copernicus, noaa, hycom'),
    variable: str = Query('temperature', description='Ocean variable'),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0),
    time: Optional[str] = Query(None),
    stride: int = Query(1, ge=1, le=20),
    resolution: Optional[str] = Query('native')
):
    """Retrieves oceanographic variable from specified provider (or auto-select)."""
    try:
        return COLLECTOR.get_ocean_data(
            provider=provider,
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time=time,
            stride=stride,
            resolution=resolution
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/ocean')
def post_ocean_data(request: OceanVariableRequest):
    """Retrieves oceanographic variable using validated JSON request body."""
    try:
        return COLLECTOR.get_ocean_data(
            provider=request.provider,
            variable=request.variable,
            min_lat=request.bbox.min_lat,
            max_lat=request.bbox.max_lat,
            min_lon=request.bbox.min_lon,
            max_lon=request.bbox.max_lon,
            depth=request.depth,
            time=request.time,
            stride=request.stride,
            resolution=request.resolution
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/ocean/{variable}')
def get_ocean_variable_by_path(
    variable: str,
    provider: str = Query('auto'),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0),
    time: Optional[str] = Query(None),
    stride: int = Query(1, ge=1, le=20)
):
    """Legacy path parameter endpoint with provider selection support."""
    try:
        return COLLECTOR.get_ocean_data(
            provider=provider,
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time=time,
            stride=stride
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Combined Region Endpoints (Ocean + Bathymetry)
# =============================================================================

@router.get('/region')
def get_combined_region(
    provider: str = Query('auto'),
    variable: str = Query('temperature'),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0),
    time: Optional[str] = Query(None),
    resolution: Optional[str] = Query('medium'),
    include_bathymetry: bool = Query(True)
):
    """Bundles requested ocean variable with authoritative GEBCO bathymetry."""
    try:
        return COLLECTOR.get_combined_region(
            provider=provider,
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time=time,
            resolution=resolution,
            include_bathymetry=include_bathymetry
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/region')
def post_combined_region(request: CombinedRegionRequest):
    """Bundles requested ocean variable with GEBCO bathymetry via POST body."""
    try:
        return COLLECTOR.get_combined_region(
            provider=request.provider,
            variable=request.variable,
            min_lat=request.bbox.min_lat,
            max_lat=request.bbox.max_lat,
            min_lon=request.bbox.min_lon,
            max_lon=request.bbox.max_lon,
            depth=request.depth,
            time=request.time,
            resolution=request.resolution,
            include_bathymetry=request.include_bathymetry
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Bathymetry Endpoints
# =============================================================================

@router.get('/bathymetry')
def get_bathymetry(
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    resolution: str = Query('medium', description='Downsampling: low, medium, high, native')
):
    """Retrieves authoritative GEBCO 3D bathymetric seabed elevation grid."""
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
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/bathymetry')
def post_bathymetry(request: BathymetryRequest):
    """Retrieves GEBCO bathymetry via validated request body."""
    try:
        return COLLECTOR.get_bathymetry(
            min_lat=request.bbox.min_lat,
            max_lat=request.bbox.max_lat,
            min_lon=request.bbox.min_lon,
            max_lon=request.bbox.max_lon,
            resolution=request.resolution or 'medium'
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Temporal and Geographic Layers
# =============================================================================

@router.get('/variables')
def get_variables_catalog():
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
    try:
        return COLLECTOR.get_coastline(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/timeline')
def get_variable_timeline(
    variable: str = Query('temperature'),
    provider: str = Query('auto'),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0),
    depth: Optional[float] = Query(None, ge=0.0, le=6000.0)
):
    try:
        return COLLECTOR.get_timeline(
            variable=variable,
            provider=provider,
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
    try:
        return COLLECTOR.get_eez(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
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
    try:
        return COLLECTOR.get_observations(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/observations/compare/{obs_id}')
def compare_observation(obs_id: str, variable: str = Query('temperature')):
    try:
        res = COLLECTOR.get_observation_comparison(obs_id=obs_id, variable=variable)
        if 'error' in res:
            raise HTTPException(status_code=404, detail=res['error'])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))