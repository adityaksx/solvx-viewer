"""
Tests for Volume Preprocessing: normalization, NaN transparency, subsetting, downsampling, and probing.
Follows Sections 15, 16, 36, 40, 56.
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


def test_normalization_and_physical_preservation(loader):
    """Section 16: Normalized between 0.0 and 1.0; physical values preserved in metadata."""
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(ds, "temperature", dims)

    # Valid values should be in (0.0, 1.0]
    assert np.all(vol >= 0.0)
    assert np.all(vol <= 1.0)
    assert vol.max() <= 1.0
    assert vol.max() >= 0.99

    phys_range = meta["physical_range"]
    assert phys_range["min"] < phys_range["max"]
    assert 6.0 <= phys_range["min"] <= 10.0
    assert 30.0 <= phys_range["max"] <= 40.0


def test_nan_handling_and_transparency(loader):
    """Section 15: NaN / masked cells must be 0.0 (marked for alpha transparency cutoff)."""
    ds, dims = loader.open_dataset("temperature.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(ds, "thetao", dims)

    assert meta["missing_values"]["count"] > 0
    # In real CMEMS dataset, land/outside cells are NaN
    # Check that in the normalized volume, these cells are 0.0
    raw_arr = ds["thetao"].isel({dims["time"]: 0}).values
    nan_mask = np.isnan(raw_arr)

    # Note raw_arr is [depth, lat, lon] or similar
    assert np.all(vol[nan_mask] == 0.0)


def test_geographic_subsetting(loader):
    """Section 13: Subsetting latitude and longitude."""
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(
        ds,
        "temperature",
        dims,
        lat_min=18.0,
        lat_max=21.0,
        lon_min=86.0,
        lon_max=90.0,
    )
    b = meta["bounds"]
    assert b["lat_min"] >= 17.9
    assert b["lat_max"] <= 21.1
    assert b["lon_min"] >= 85.9
    assert b["lon_max"] <= 90.1
    assert vol.shape[1] < 90  # subset is smaller than full 90 lats
    assert vol.shape[2] < 106 # subset is smaller than full 106 lons


def test_depth_subsetting(loader):
    """Section 29: Subsetting depth range (e.g. 0 to 200m)."""
    ds, dims = loader.open_dataset("temperature.nc")
    vol, meta = VolumeProcessor.extract_3d_volume(
        ds,
        "thetao",
        dims,
        depth_min=0.0,
        depth_max=200.0,
    )
    assert meta["bounds"]["depth_max"] <= 250.0
    assert vol.shape[0] < 32


def test_downsampling_stride(loader):
    """Section 36: Downsampling with stride 2 and 4."""
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    vol_full, _ = VolumeProcessor.extract_3d_volume(ds, "temperature", dims, stride=1)
    vol_s2, meta_s2 = VolumeProcessor.extract_3d_volume(ds, "temperature", dims, stride=2)
    vol_s4, meta_s4 = VolumeProcessor.extract_3d_volume(ds, "temperature", dims, stride=4)

    assert vol_s2.shape[1] == (vol_full.shape[1] + 1) // 2
    assert vol_s2.shape[2] == (vol_full.shape[2] + 1) // 2
    assert vol_s4.shape[1] == (vol_full.shape[1] + 3) // 4


def test_point_probe_ground_truth(loader):
    """Section 40: /point probe returns true scientific value from dataset."""
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    probe = VolumeProcessor.sample_point(
        ds,
        variable_name="temperature",
        detected_dims=dims,
        lat=20.0,
        lon=88.0,
        depth=50.0,
    )
    assert probe["is_valid"] is True
    assert probe["value"] is not None
    # Check value is close to theoretical: 30 - 0.02*50 + trig ~ 29 +/- 4
    assert 25.0 <= probe["value"] <= 35.0
