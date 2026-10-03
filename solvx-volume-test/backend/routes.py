"""
FastAPI Routes for SolvX Volume Renderer Test Prototype.
Follows Sections 38, 39, 40, 41.
"""

import json
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from .netcdf_loader import NetCDFLoader, NetCDFDiscoveryError
from .volume_processor import VolumeProcessor
from .metadata import extract_dataset_metadata

router = APIRouter(prefix="/api")
loader = NetCDFLoader()
GEOMETRY_PATH = Path(__file__).resolve().parent.parent / "data" / "geometry" / "geometry.json"



@router.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

@router.get("/health")
def health_check():
    return {"status": "ok", "service": "solvx-volume-test"}


@router.get("/datasets")
def list_datasets():
    """Lists all available NetCDF files in data/netcdf/"""
    datasets = loader.list_datasets()
    return {"datasets": datasets, "count": len(datasets)}


@router.get("/dataset")
def get_dataset_info(dataset: str = Query(..., description="NetCDF filename")):
    """Returns dimensions, coordinates, variables, and bounding box for a dataset."""
    try:
        ds, dims = loader.open_dataset(dataset)
        meta = extract_dataset_metadata(
            ds,
            dataset_name=dataset,
            lat_dim=dims["latitude"],
            lon_dim=dims["longitude"],
            depth_dim=dims.get("depth"),
            time_dim=dims.get("time"),
        )
        meta["dataset"] = dataset
        return meta
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NetCDFDiscoveryError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inspecting dataset: {e}")


@router.get("/variables")
def get_variables(dataset: str = Query(...)):
    """Returns available variables for the selected dataset."""
    try:
        ds, dims = loader.open_dataset(dataset)
        meta = extract_dataset_metadata(
            ds,
            dataset_name=dataset,
            lat_dim=dims["latitude"],
            lon_dim=dims["longitude"],
            depth_dim=dims.get("depth"),
            time_dim=dims.get("time"),
        )
        return {"dataset": dataset, "variables": meta["variables"]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/volume/metadata")
def get_volume_metadata(
    dataset: str = Query(...),
    variable: str = Query(...),
    time: int = Query(0, description="Time index"),
    lat_min: Optional[float] = Query(None),
    lat_max: Optional[float] = Query(None),
    lon_min: Optional[float] = Query(None),
    lon_max: Optional[float] = Query(None),
    depth_min: Optional[float] = Query(None),
    depth_max: Optional[float] = Query(None),
    stride: int = Query(1, ge=1, le=16),
):
    """Returns metadata for the subsetted 3D volume."""
    try:
        ds, dims = loader.open_dataset(dataset)
        _, meta = VolumeProcessor.extract_3d_volume(
            ds,
            variable_name=variable,
            detected_dims=dims,
            time_index=time,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            depth_min=depth_min,
            depth_max=depth_max,
            stride=stride,
        )
        meta["dataset"] = dataset
        return meta
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to generate volume metadata: {e}")


@router.get("/volume/binary")
def get_volume_binary(
    dataset: str = Query(...),
    variable: str = Query(...),
    time: int = Query(0, description="Time index"),
    lat_min: Optional[float] = Query(None),
    lat_max: Optional[float] = Query(None),
    lon_min: Optional[float] = Query(None),
    lon_max: Optional[float] = Query(None),
    depth_min: Optional[float] = Query(None),
    depth_max: Optional[float] = Query(None),
    stride: int = Query(1, ge=1, le=16),
):
    """
    Returns normalized Float32 little-endian binary stream (Section 37 & 39).
    Shape: [Nz, Ny, Nx] -> [depth, latitude, longitude].
    """
    try:
        ds, dims = loader.open_dataset(dataset)
        vol, meta = VolumeProcessor.extract_3d_volume(
            ds,
            variable_name=variable,
            detected_dims=dims,
            time_index=time,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            depth_min=depth_min,
            depth_max=depth_max,
            stride=stride,
        )

        raw_bytes = vol.astype("<f4").tobytes()
        headers = {
            "Content-Type": "application/octet-stream",
            "X-Volume-Shape": ",".join(str(s) for s in meta["shape"]),
            "X-Volume-Min": str(meta["physical_range"]["min"]),
            "X-Volume-Max": str(meta["physical_range"]["max"]),
            "X-Volume-Units": meta["units"],
        }
        return Response(content=raw_bytes, media_type="application/octet-stream", headers=headers)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract binary volume: {e}")


@router.get("/point")
def probe_point(
    dataset: str = Query(...),
    variable: str = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
    depth: Optional[float] = Query(0.0),
    time: int = Query(0),
):
    """
    Ground truth CPU point probe (Section 40).
    Allows the frontend to verify visual color values against exact dataset values.
    """
    try:
        ds, dims = loader.open_dataset(dataset)
        result = VolumeProcessor.sample_point(
            ds,
            variable_name=variable,
            detected_dims=dims,
            lat=lat,
            lon=lon,
            depth=depth,
            time_index=time,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to probe point: {e}")


@router.get("/bathymetry")
def get_bathymetry():
    """Returns GEBCO bathymetric terrain data from geometry.json (Section 41)."""
    if not GEOMETRY_PATH.exists():
        raise HTTPException(status_code=404, detail="Geometry file not found.")
    try:
        with open(GEOMETRY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "bounds": data.get("bounds"),
            "terrain": data.get("terrain"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading bathymetry: {e}")


@router.get("/geometry")
def get_full_geometry():
    """Returns complete geography (land, coastline, bounds) for scene rendering."""
    if not GEOMETRY_PATH.exists():
        raise HTTPException(status_code=404, detail="Geometry file not found.")
    try:
        with open(GEOMETRY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "bounds": data.get("bounds"),
            "land": data.get("land", []),
            "coast": data.get("coast", []),
            "islands": data.get("islands", []),
            "landBoundary": data.get("landBoundary", []),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading geometry: {e}")
