"""
Bathymetry and Seabed Depth Service.
Follows Sections 16, 17, 18, 19, 20 of the implementation plan.
"""

import json
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
from scipy.interpolate import RegularGridInterpolator


class BathymetryService:
    def __init__(self, geometry_path: Optional[Path] = None):
        if geometry_path is None:
            self.geometry_path = Path(__file__).resolve().parent.parent / "data" / "geometry" / "geometry.json"
        else:
            self.geometry_path = Path(geometry_path)
        self._interpolator = None
        self._bounds = None
        self._load()

    def _load(self):
        if not self.geometry_path.exists():
            return
        try:
            with open(self.geometry_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            terrain = data.get("terrain")
            if not terrain or "rawDepthKm" not in terrain:
                return
            self._bounds = data.get("bounds", [84.10, 93.00, 16.07, 23.52])
            lon_min, lon_max, lat_min, lat_max = self._bounds

            raw_km = np.array(terrain["rawDepthKm"], dtype=np.float32)
            ny, nx = raw_km.shape
            lats = np.linspace(lat_min, lat_max, ny)
            lons = np.linspace(lon_min, lon_max, nx)

            # Convert to meters, treat NaN and elevation <= 0.02 km as land (depth 0.0)
            depth_m = raw_km * 1000.0
            depth_m = np.where(np.isnan(depth_m) | (depth_m <= 20.0), 0.0, depth_m)

            self._interpolator = RegularGridInterpolator(
                (lats, lons), depth_m, bounds_error=False, fill_value=0.0
            )
        except Exception as e:
            print(f"Warning: Failed to load bathymetry from {self.geometry_path}: {e}")

    def get_depth(self, lat: float, lon: float) -> float:
        """Returns physical seabed depth in meters at (lat, lon). Returns 0.0 if land."""
        if self._interpolator is None:
            return 1000.0
        val = float(self._interpolator((lat, lon)))
        return max(0.0, val)

    def get_depth_grid(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        """Returns 2D grid of bathymetry depths (ny, nx) in meters."""
        if self._interpolator is None:
            return np.full((len(lats), len(lons)), 1000.0, dtype=np.float32)
        mesh_lat, mesh_lon = np.meshgrid(lats, lons, indexing="ij")
        pts = np.stack([mesh_lat.ravel(), mesh_lon.ravel()], axis=-1)
        grid = self._interpolator(pts).reshape((len(lats), len(lons))).astype(np.float32)
        return np.maximum(0.0, grid)
