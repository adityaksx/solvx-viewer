"""
Tests for canonical axis ordering, coordinate projection, and dimension discovery.
Follows Sections 14, 22, 56.
"""

import pytest
import numpy as np
import xarray as xr
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR.parent))

from backend.netcdf_loader import NetCDFLoader
from backend.volume_processor import VolumeProcessor


@pytest.fixture
def loader():
    return NetCDFLoader(BASE_DIR / "data" / "netcdf")


def test_axis_ordering_canonical(loader):
    """Section 14: volume must always be transposed to [depth, latitude, longitude]."""
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(
        ds,
        variable_name="temperature",
        detected_dims=dims,
    )
    assert meta["axis_order"] == ["depth", "latitude", "longitude"]
    nz, ny, nx = vol.shape
    assert nz == meta["shape"][0]  # depth
    assert ny == meta["shape"][1]  # latitude
    assert nx == meta["shape"][2]  # longitude
    assert nz == 32
    assert ny == 90
    assert nx == 106


def test_real_dataset_axis_ordering(loader):
    """Verify real temperature.nc is correctly aligned."""
    ds, dims = loader.open_dataset("temperature.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(
        ds,
        variable_name="thetao",
        detected_dims=dims,
    )
    assert meta["axis_order"] == ["depth", "latitude", "longitude"]
    assert vol.ndim == 3
    assert vol.shape[0] == 32  # 32 depths
    assert vol.shape[1] == 90  # 90 lats
    assert vol.shape[2] == 106 # 106 lons
