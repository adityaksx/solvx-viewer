"""
SolvX Download API Router
=========================
REST Endpoints for managing and executing downloads of Land, Coastline,
Maritime EEZ, Seabed (GEBCO), and Ocean Variables, and querying disk inventory.
"""

from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..services.download_service import (
    get_download_inventory,
    check_download_status,
    execute_download,
    discover_download_variables,
    create_regional_download_package,
    get_download_package_path
)

router = APIRouter(prefix='/api/download', tags=['Data Downloader'])


class BBoxModel(BaseModel):
    min_lat: float = Field(..., ge=-90.0, le=90.0)
    max_lat: float = Field(..., ge=-90.0, le=90.0)
    min_lon: float = Field(..., ge=-180.0, le=180.0)
    max_lon: float = Field(..., ge=-180.0, le=180.0)


class CheckDownloadRequest(BaseModel):
    bbox: BBoxModel
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    layers: Optional[List[str]] = ['land', 'coastline', 'eez', 'seabed', 'ocean']
    variables: Optional[List[str]] = ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']


class RegionalPackageRequest(BaseModel):
    bbox: BBoxModel
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    ocean_variables: Optional[Union[List[str], str, bool]] = 'all'
    atmospheric_variables: Optional[Union[List[str], str, bool]] = 'all'
    include_geography: Optional[bool] = False
    include_bathymetry: Optional[bool] = False
    resolution: Optional[str] = 'medium'


class ExecuteDownloadRequest(BaseModel):
    bbox: BBoxModel
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    layers: Optional[List[str]] = ['land', 'coastline', 'eez', 'seabed', 'ocean']
    variables: Optional[List[str]] = ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']
    ocean_variables: Optional[Union[List[str], str, bool]] = None
    atmospheric_variables: Optional[Union[List[str], str, bool]] = None
    format: Optional[str] = 'zip'
    resolution: Optional[str] = 'medium'


@router.get('/discover')
def get_discovered_variables(
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
):
    """Dynamically returns available ocean and atmospheric variables along with dynamic timeline defaults."""
    bbox = None
    if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
        bbox = {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon}
    return discover_download_variables(bbox=bbox)


@router.get('/inventory')
def get_inventory():
    """Returns an inventory of all currently downloaded datasets on local disk."""
    try:
        return get_download_inventory()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/check')
def check_status(req: CheckDownloadRequest):
    """Checks which layers and variables are already downloaded on disk vs which need downloading."""
    try:
        return check_download_status(
            bbox=req.bbox.model_dump(),
            start_time=req.start_time,
            end_time=req.end_time,
            layers=req.layers,
            variables=req.variables
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/execute')
def execute_batch_download(req: ExecuteDownloadRequest):
    """
    Performs download and packaging. If ocean_variables or atmospheric_variables
    are provided (or format=='zip'), generates structured ZIP package.
    """
    try:
        if req.ocean_variables is not None or req.atmospheric_variables is not None or req.format == 'zip':
            return create_regional_download_package(
                bbox=req.bbox.model_dump(),
                start_time=req.start_time,
                end_time=req.end_time,
                ocean_variables=req.ocean_variables if req.ocean_variables is not None else req.variables,
                atmospheric_variables=req.atmospheric_variables,
                include_geography='land' in (req.layers or []),
                include_bathymetry='seabed' in (req.layers or []),
                resolution=req.resolution or 'medium'
            )

        return execute_download(
            bbox=req.bbox.model_dump(),
            start_time=req.start_time,
            end_time=req.end_time,
            layers=req.layers,
            variables=req.variables,
            resolution=req.resolution or 'medium'
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/package')
def create_download_package(req: RegionalPackageRequest):
    """Dedicated endpoint for multi-variable ocean + atmospheric structured ZIP package creation."""
    try:
        return create_regional_download_package(
            bbox=req.bbox.model_dump(),
            start_time=req.start_time or req.start,
            end_time=req.end_time or req.end,
            ocean_variables=req.ocean_variables,
            atmospheric_variables=req.atmospheric_variables,
            include_geography=bool(req.include_geography),
            include_bathymetry=bool(req.include_bathymetry),
            resolution=req.resolution or 'medium'
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/package/{package_id}')
def download_package_file(package_id: str):
    """Directly streams the generated ZIP file for browser download."""
    zip_path = get_download_package_path(package_id)
    if not zip_path or not zip_path.exists():
        raise HTTPException(status_code=404, detail=f"Download package '{package_id}' not found or expired.")
    return FileResponse(
        path=str(zip_path),
        media_type='application/zip',
        filename=zip_path.name
    )


@router.post('')
def api_download_alias(req: RegionalPackageRequest):
    """Universal POST /api/download specification alias."""
    return create_download_package(req)
