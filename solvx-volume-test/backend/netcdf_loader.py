"""
NetCDF Dataset Discovery and Dimension Detection.
Follows Section 8, 9, 10, 58, 59 of the prototype plan.
"""

import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import xarray as xr

# Priority-ordered alias candidates
LAT_NAMES = ["lat", "latitude", "nav_lat", "y", "lat_rho", "lat_u", "lat_v"]
LON_NAMES = ["lon", "longitude", "nav_lon", "x", "lon_rho", "lon_u", "lon_v"]
DEPTH_NAMES = ["depth", "depths", "lev", "level", "z", "deptht", "deptho_lev", "nav_lev"]
TIME_NAMES = ["time", "TIME", "date", "time_counter", "record"]


class NetCDFDiscoveryError(Exception):
    """Raised when coordinates or dataset dimensions cannot be identified."""
    pass


class NetCDFLoader:
    def __init__(self, data_dir: Optional[Path] = None):
        if data_dir is None:
            self.data_dir = Path(__file__).resolve().parent.parent / "data" / "netcdf"
        else:
            self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, xr.Dataset] = {}

    def list_datasets(self) -> List[str]:
        """Returns names of all available .nc files in data_dir."""
        files = sorted(self.data_dir.glob("*.nc"))
        return [f.name for f in files]

    def get_dataset_path(self, filename: str) -> Path:
        """Resolves file path safely and ensures it stays within data_dir."""
        safe_name = Path(filename).name
        full_path = self.data_dir / safe_name
        if not full_path.exists():
            raise FileNotFoundError(f"Dataset '{safe_name}' not found in {self.data_dir}")
        return full_path

    def open_dataset(self, filename: str, overrides: Optional[Dict[str, str]] = None) -> Tuple[xr.Dataset, Dict[str, str]]:
        """
        Opens a NetCDF file with dimension detection or manual overrides.
        Returns: (xarray.Dataset, dict of detected/applied dimension names)
        """
        if filename in self._cache:
            ds = self._cache[filename]
        else:
            path = self.get_dataset_path(filename)
            ds = xr.open_dataset(path)
            self._cache[filename] = ds

        dims = self.detect_dimensions(ds, overrides)
        return ds, dims

    def detect_dimensions(self, ds: xr.Dataset, overrides: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        Automatically discovers latitude, longitude, depth, and time coordinates.
        Supports manual overrides (Section 59).
        """
        overrides = overrides or {}
        detected = {}

        # 1. Latitude
        if "latitude" in overrides and overrides["latitude"] in ds.coords:
            detected["latitude"] = overrides["latitude"]
        else:
            detected["latitude"] = self._find_matching_dim(ds, LAT_NAMES)
            if not detected["latitude"]:
                coords_list = list(ds.coords.keys())
                raise NetCDFDiscoveryError(
                    f"Could not detect latitude coordinate. Detected coordinates: {coords_list}. "
                    f"Please provide an explicit coordinate override in request or dataset config."
                )

        # 2. Longitude
        if "longitude" in overrides and overrides["longitude"] in ds.coords:
            detected["longitude"] = overrides["longitude"]
        else:
            detected["longitude"] = self._find_matching_dim(ds, LON_NAMES)
            if not detected["longitude"]:
                coords_list = list(ds.coords.keys())
                raise NetCDFDiscoveryError(
                    f"Could not detect longitude coordinate. Detected coordinates: {coords_list}. "
                    f"Please provide an explicit coordinate override in request or dataset config."
                )

        # 3. Depth (optional for 2D surface fields, but required for 3D/4D volumes)
        if "depth" in overrides and overrides["depth"] in ds.coords:
            detected["depth"] = overrides["depth"]
        else:
            detected["depth"] = self._find_matching_dim(ds, DEPTH_NAMES)

        # 4. Time (optional for static volumes)
        if "time" in overrides and overrides["time"] in ds.coords:
            detected["time"] = overrides["time"]
        else:
            detected["time"] = self._find_matching_dim(ds, TIME_NAMES)

        return detected

    def _find_matching_dim(self, ds: xr.Dataset, candidate_names: List[str]) -> Optional[str]:
        # Check coords first
        for name in candidate_names:
            if name in ds.coords:
                return name
        # Check dims as fallback
        for name in candidate_names:
            if name in ds.sizes:
                return name
        return None

    def close(self):
        for ds in self._cache.values():
            ds.close()
        self._cache.clear()
