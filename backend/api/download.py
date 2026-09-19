"""
SolvX Download API Router
=========================
REST Endpoints for managing and executing downloads of Land, Coastline,
Maritime EEZ, Seabed (GEBCO), and Ocean Variables, and querying disk inventory.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from ..services.download_service import (
    get_download_inventory,
    check_download_status,
    execute_download
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


class ExecuteDownloadRequest(BaseModel):
    bbox: BBoxModel
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    layers: Optional[List[str]] = ['land', 'coastline', 'eez', 'seabed', 'ocean']
    variables: Optional[List[str]] = ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']
    resolution: Optional[str] = 'medium'


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
    """Performs download and local storage of selected layers and variables."""
    try:
        return execute_download(
            bbox=req.bbox.model_dump(),
            start_time=req.start_time,
            end_time=req.end_time,
            layers=req.layers,
            variables=req.variables,
            resolution=req.resolution or 'medium'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
