"""
Tests for NetCDF discovery, dimension detection, and error handling.
Follows Section 8, 9, 10, 56, 58 of prototype plan.
"""

import pytest
import numpy as np
import xarray as xr
from pathlib import Path
import sys

# Add parent directory to path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR.parent))

from backend.netcdf_loader import NetCDFLoader, NetCDFDiscoveryError


@pytest.fixture
def loader():
    return NetCDFLoader(BASE_DIR / "data" / "netcdf")


def test_list_datasets(loader):
    datasets = loader.list_datasets()
    assert len(datasets) > 0
    assert "synthetic_ocean.nc" in datasets


def test_synthetic_dimension_detection(loader):
    ds, dims = loader.open_dataset("synthetic_ocean.nc")
    assert dims["latitude"] == "latitude"
    assert dims["longitude"] == "longitude"
    assert dims["depth"] == "depth"
    assert dims["time"] == "time"


def test_real_temperature_dimension_detection(loader):
    ds, dims = loader.open_dataset("temperature.nc")
    assert dims["latitude"] in ["latitude", "lat"]
    assert dims["longitude"] in ["longitude", "lon"]
    assert dims["depth"] in ["depth", "depths", "lev"]
    assert dims["time"] in ["time", "TIME"]


def test_custom_dimension_aliases(loader, tmp_path):
    """Test handling unusual coordinate names like nav_lat, nav_lon, deptht."""
    dummy_ds = xr.Dataset(
        data_vars={"sst": (["nav_lat", "nav_lon"], np.ones((10, 10)))},
        coords={
            "nav_lat": ("nav_lat", np.linspace(10, 20, 10)),
            "nav_lon": ("nav_lon", np.linspace(80, 90, 10)),
        }
    )
    detected = loader.detect_dimensions(dummy_ds)
    assert detected["latitude"] == "nav_lat"
    assert detected["longitude"] == "nav_lon"


def test_missing_dimension_raises_clear_error(loader):
    """Test Section 58 requirement: report meaningful error when dimension missing."""
    dummy_ds = xr.Dataset(
        data_vars={"val": (["x", "z"], np.ones((5, 5)))},
        coords={"x": ("x", [1, 2, 3, 4, 5]), "z": ("z", [1, 2, 3, 4, 5])}
    )
    with pytest.raises(NetCDFDiscoveryError) as exc_info:
        loader.detect_dimensions(dummy_ds)
    assert "Could not detect latitude coordinate" in str(exc_info.value)
