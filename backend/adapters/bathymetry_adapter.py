"""
GEBCO Bathymetry Adapter for SolvX
==================================
Authoritative source: General Bathymetric Chart of the Oceans (GEBCO 2026 Grid)
Nippon Foundation-GEBCO Seabed 2030 Project.

Provides numerical seabed elevation grids subsetted strictly by user BBOX.
Preserves standard GEBCO elevation conventions:
- Positive values: land elevation above sea level (meters)
- Negative values: ocean depth below sea level (meters)

Supports configurable downsampling:
- low: ~40x40 grid
- medium: ~80x80 grid (default)
- high: ~150x150 grid
- native: full resolution (capped at MAX_GRID_POINTS)
"""

import os
import json
import zipfile
import logging
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
import numpy as np

from ..config import (
    DATA_DIR,
    BATHYMETRY_BASE_URL,
    REQUEST_TIMEOUT,
    MAX_GRID_POINTS
)
from ..processing.coordinate_utils import project_xy
from ..processing.normalization import sanitize
from ..services.cache_service import GLOBAL_CACHE, make_cache_key, safe_open_dataset

logger = logging.getLogger('solvx.bathymetry')

GEBCO_NC_PATH = DATA_DIR / 'gebco_2026_n23.5244_s16.0707_w84.105_e92.993.nc'
GEBCO_ZIP_PATH = DATA_DIR / 'GEBCO_10_Sep_2026_c6ae0e7b7408.zip'

RESOLUTION_TARGETS = {
    'low': (40, 40),
    'medium': (80, 80),
    'high': (150, 150),
    'native': None
}


class GEBCOAdapter:
    """Authoritative GEBCO bathymetry adapter."""

    def __init__(self, base_url: str = BATHYMETRY_BASE_URL, timeout: int = REQUEST_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
        self._ensure_local_nc()

    def _ensure_local_nc(self):
        """Extracts local GEBCO NetCDF from zip if not already present on disk."""
        if not GEBCO_NC_PATH.exists() and GEBCO_ZIP_PATH.exists():
            try:
                logger.info('Extracting GEBCO NetCDF from archive %s...', GEBCO_ZIP_PATH)
                with zipfile.ZipFile(GEBCO_ZIP_PATH, 'r') as z:
                    for name in z.namelist():
                        if name.endswith('.nc'):
                            z.extract(name, DATA_DIR)
                            extracted = DATA_DIR / name
                            if extracted != GEBCO_NC_PATH and extracted.exists():
                                extracted.rename(GEBCO_NC_PATH)
                            break
            except Exception as e:
                logger.warning('Failed to extract GEBCO archive: %s', e)

    def get_metadata(self) -> Dict[str, Any]:
        """Returns authoritative metadata for the GEBCO bathymetry dataset."""
        return {
            'provider': 'GEBCO',
            'dataset': 'GEBCO 2026 Grid',
            'source': 'The Nippon Foundation-GEBCO Seabed 2030 Project',
            'units': 'meters',
            'convention': 'elevation (positive above sea level, negative below sea level)',
            'resolution': '15 arc-second continuous global terrain model',
            'doi': '10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa',
            'terms_of_use': 'Public domain with attribution'
        }

    def get_data(self, bbox: Dict[str, float], resolution: Optional[str] = 'medium') -> Dict[str, Any]:
        """Public adapter entry point taking BBox dictionary and resolution."""
        return self.fetch_bathymetry(
            min_lat=bbox['min_lat'],
            max_lat=bbox['max_lat'],
            min_lon=bbox['min_lon'],
            max_lon=bbox['max_lon'],
            resolution=resolution
        )

    def fetch_bathymetry(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: Optional[str] = 'medium'
    ) -> Dict[str, Any]:
        """Fetches and normalizes seabed elevation strictly subsetted by bounding box."""
        res_key = (resolution or 'medium').lower()
        if res_key not in RESOLUTION_TARGETS:
            res_key = 'medium'

        cache_key = f"GEBCO:bbox:{min_lat:.3f}:{max_lat:.3f}:{min_lon:.3f}:{max_lon:.3f}:{res_key}"
        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        # 1. Check if bounding box intersects or is contained in local GEBCO dataset
        result = None
        if self._is_within_local_coverage(min_lat, max_lat, min_lon, max_lon):
            result = self._fetch_from_local_gebco(min_lat, max_lat, min_lon, max_lon, res_key)

        # 2. If not in local coverage or local failed, attempt live GEBCO/NOAA WCS service
        if result is None:
            result = self._fetch_from_remote_api(min_lat, max_lat, min_lon, max_lon, res_key)

        # 3. If remote service is unreachable / offline, generate baseline ocean floor
        if result is None:
            logger.warning(
                'Authoritative bathymetry remote query failed for BBOX [%s, %s, %s, %s]. '
                'Generating baseline ocean floor grid.',
                min_lat, max_lat, min_lon, max_lon
            )
            result = self._generate_baseline_bathymetry(min_lat, max_lat, min_lon, max_lon, res_key)

        GLOBAL_CACHE.set(cache_key, result)
        return result

    def _is_within_local_coverage(self, min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> bool:
        if not GEBCO_NC_PATH.exists():
            return False
        # Local GEBCO dataset spans lat: 16.07 to 23.52, lon: 84.10 to 92.99
        # Check if there is meaningful overlap
        return not (max_lat < 16.0 or min_lat > 23.6 or max_lon < 84.0 or min_lon > 93.1)

    def _fetch_from_local_gebco(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Optional[Dict[str, Any]]:
        """Subsets local GEBCO NetCDF file strictly by user BBOX with controlled downsampling."""
        if not GEBCO_NC_PATH.exists():
            return None

        try:
            with safe_open_dataset(GEBCO_NC_PATH) as ds:
                if 'elevation' not in ds.data_vars:
                    return None

                da = ds['elevation']
                yd = 'lat' if 'lat' in da.coords else 'latitude'
                xd = 'lon' if 'lon' in da.coords else 'longitude'

                # Slice strictly within requested bounding box
                lat_vals = da[yd].values
                lon_vals = da[xd].values

                lat_min_bound = max(float(lat_vals.min()), min_lat)
                lat_max_bound = min(float(lat_vals.max()), max_lat)
                lon_min_bound = max(float(lon_vals.min()), min_lon)
                lon_max_bound = min(float(lon_vals.max()), max_lon)

                if lat_min_bound >= lat_max_bound or lon_min_bound >= lon_max_bound:
                    return None

                lat_slice = slice(lat_min_bound, lat_max_bound)
                lon_slice = slice(lon_min_bound, lon_max_bound)

                sub = da.sel({yd: lat_slice, xd: lon_slice})
                if sub.size == 0:
                    return None

                # Downsample according to requested resolution
                target = RESOLUTION_TARGETS.get(resolution)
                if target is not None:
                    target_ny, target_nx = target
                    step_y = max(1, int(len(sub[yd]) / target_ny))
                    step_x = max(1, int(len(sub[xd]) / target_nx))
                    sub = sub.isel({yd: slice(None, None, step_y), xd: slice(None, None, step_x)})
                elif sub.size > MAX_GRID_POINTS:
                    f = int(np.ceil(np.sqrt(sub.size / MAX_GRID_POINTS)))
                    sub = sub.isel({yd: slice(None, None, f), xd: slice(None, None, f)})

                lats = [round(float(v), 4) for v in sub[yd].values]
                lons = [round(float(v), 4) for v in sub[xd].values]
                elev_vals = sub.values.astype(np.float32)

                # Format elevation 2D list (meters: negative = depth, positive = land)
                elevation = []
                raw_depth_km = []
                for row in elev_vals:
                    elev_row = []
                    depth_row = []
                    for v in row:
                        if not np.isfinite(v):
                            elev_row.append(None)
                            depth_row.append(None)
                        else:
                            val = round(float(v), 1)
                            elev_row.append(val)
                            # For 3D terrain rendering: underwater depth in km
                            depth_row.append(round(-val / 1000.0, 4) if val < 0 else 0.0)
                    elevation.append(elev_row)
                    raw_depth_km.append(depth_row)

                # 3D coordinates projected for viewer
                xx, yy = project_xy(lons, lats, min_lon, max_lon, min_lat, max_lat)

                # Compute maximum ocean depth (km)
                ocean_depths = [-v for r in elevation for v in r if v is not None and v < 0]
                max_depth_km = round(max(ocean_depths) / 1000.0, 3) if ocean_depths else 0.5

                return {
                    'type': 'bathymetry',
                    'provider': 'GEBCO',
                    'dataset': 'GEBCO 2026 Grid',
                    'units': 'meters',
                    'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
                    'latitude': lats,
                    'longitude': lons,
                    'elevation': elevation,
                    'depth': elevation,
                    'x': [round(float(v), 3) for v in xx],
                    'y': [round(float(v), 3) for v in yy],
                    'rawDepthKm': raw_depth_km,
                    'maxDepthKm': max_depth_km,
                    'metadata': self.get_metadata()
                }

        except Exception as e:
            logger.error('Error subsetting local GEBCO dataset: %s', e)
            return None

    def _fetch_from_remote_api(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Optional[Dict[str, Any]]:
        """Queries external NOAA DEM or GEBCO WCS service strictly for the requested BBOX."""
        target = RESOLUTION_TARGETS.get(resolution) or (80, 80)
        nx, ny = target[1], target[0]

        try:
            params = {
                'bbox': f"{min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f}",
                'bboxSR': '4326',
                'size': f"{nx},{ny}",
                'imageSR': '4326',
                'format': 'json',
                'f': 'json'
            }
            url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0 (GEBCO Client)'})

            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                elevation = data.get('values', data.get('elevation'))
                if elevation and isinstance(elevation, list) and len(elevation) > 0:
                    return self._parse_remote_bathymetry(elevation, min_lat, max_lat, min_lon, max_lon, resolution)

            return None
        except Exception as e:
            logger.warning('Remote GEBCO/NOAA bathymetry query failed: %s', e)
            return None

    def _parse_remote_bathymetry(
        self,
        elevation: List[List[Any]],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Dict[str, Any]:
        """Parses and projects remote elevation grid."""
        ny = len(elevation)
        nx = len(elevation[0]) if ny > 0 else 0

        lons = [round(float(v), 4) for v in np.linspace(min_lon, max_lon, nx)]
        lats = [round(float(v), 4) for v in np.linspace(min_lat, max_lat, ny)]
        xx, yy = project_xy(lons, lats, min_lon, max_lon, min_lat, max_lat)

        elev_grid = []
        raw_depth_km = []
        for row in elevation:
            e_row = []
            d_row = []
            for v in row:
                if v is None:
                    e_row.append(None)
                    d_row.append(None)
                else:
                    val = round(float(v), 1)
                    e_row.append(val)
                    d_row.append(round(-val / 1000.0, 4) if val < 0 else 0.0)
            elev_grid.append(e_row)
            raw_depth_km.append(d_row)

        ocean_depths = [-v for r in elev_grid for v in r if v is not None and v < 0]
        max_depth_km = round(max(ocean_depths) / 1000.0, 3) if ocean_depths else 0.5

        return {
            'type': 'bathymetry',
            'provider': 'GEBCO',
            'dataset': 'GEBCO / NOAA Global DEM',
            'units': 'meters',
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': lats,
            'longitude': lons,
            'elevation': elev_grid,
            'depth': elev_grid,
            'x': [round(float(v), 3) for v in xx],
            'y': [round(float(v), 3) for v in yy],
            'rawDepthKm': raw_depth_km,
            'maxDepthKm': max_depth_km,
            'metadata': self.get_metadata()
        }

    def _generate_baseline_bathymetry(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Dict[str, Any]:
        """Generates a clean baseline seabed floor grid when remote servers are unreachable."""
        target = RESOLUTION_TARGETS.get(resolution) or (80, 80)
        ny, nx = target[0], target[1]
        lons = [round(float(v), 4) for v in np.linspace(min_lon, max_lon, nx)]
        lats = [round(float(v), 4) for v in np.linspace(min_lat, max_lat, ny)]
        xx, yy = project_xy(lons, lats, min_lon, max_lon, min_lat, max_lat)

        # Realistic baseline ocean floor (~3000m depth = -3000.0m elevation)
        elevation = [[-3000.0 for _ in range(nx)] for _ in range(ny)]
        raw_depth_km = [[3.0 for _ in range(nx)] for _ in range(ny)]

        return {
            'type': 'bathymetry',
            'provider': 'GEBCO_BASELINE',
            'dataset': 'GEBCO Baseline Bathymetry (Offline Fallback)',
            'units': 'meters',
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': lats,
            'longitude': lons,
            'elevation': elevation,
            'depth': elevation,
            'x': [round(float(v), 3) for v in xx],
            'y': [round(float(v), 3) for v in yy],
            'rawDepthKm': raw_depth_km,
            'maxDepthKm': 3.5,
            'metadata': {
                'authoritative_source': 'GEBCO',
                'provider': 'GEBCO_BASELINE',
                'dataset': 'GEBCO Baseline Grid (Offline Fallback)',
                'is_fallback': True,
                'note': 'Baseline abyssal floor generated because remote bathymetry service is unreachable.'
            }
        }


# Aliases for backward compatibility
BathymetryAdapter = GEBCOAdapter