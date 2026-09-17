import os
import json
import logging
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional, Dict, Any, List
import numpy as np

from ..config import (
    BATHYMETRY_BASE_URL,
    REQUEST_TIMEOUT,
    LOCAL_DATA_MODE
)
from ..models.requests import SolvXBathymetryResponse
from ..processing.coordinate_utils import project_xy
from ..processing.normalization import sanitize

logger = logging.getLogger('solvx.bathymetry')


class BathymetryAdapter:
    """Bathymetry Adapter for GEBCO / NOAA Global DEM elevation grids."""

    def __init__(self, base_url: str = BATHYMETRY_BASE_URL, timeout: int = REQUEST_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout

    def fetch_bathymetry(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str = '0.083deg'
    ) -> Dict[str, Any]:
        """Fetches and normalizes seabed bathymetry for the bounding box."""
        if LOCAL_DATA_MODE:
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon, resolution)

        return self._fetch_from_api(min_lat, max_lat, min_lon, max_lon, resolution)

    def _fetch_from_local_source(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Dict[str, Any]:
        """Delegates to existing bathymetry service with GEBCO/baymetry.nc/basin model."""
        from ..services.bathymetry_service import get_bathymetry_data

        raw = get_bathymetry_data(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
        terrain = raw.get('terrain', {})
        xx = terrain.get('x', [])
        yy = terrain.get('y', [])
        raw_depth_km = terrain.get('rawDepthKm', [])
        max_depth_km = terrain.get('maxDepthKm', 3.8)

        # Convert rawDepthKm (positive in km) back to meters
        depth_m = []
        for row in raw_depth_km:
            depth_m.append([round(v * 1000.0, 1) if v is not None else None for v in row])

        nx = len(xx)
        ny = len(yy)
        lons = [round(min_lon + i * (max_lon - min_lon) / max(1, nx - 1), 4) for i in range(nx)]
        lats = [round(min_lat + j * (max_lat - min_lat) / max(1, ny - 1), 4) for j in range(ny)]

        return {
            'source': 'GEBCO 2023 Grid (Local Archive)',
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'resolution': resolution,
            'latitude': lats,
            'longitude': lons,
            'depth': depth_m,
            'x': xx,
            'y': yy,
            'rawDepthKm': raw_depth_km,
            'maxDepthKm': max_depth_km,
            'units': 'meters',
            'metadata': {
                'source': 'GEBCO / General Bathymetric Chart of the Oceans',
                'description': 'Global ocean seabed elevation dataset'
            }
        }

    def _fetch_from_api(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Dict[str, Any]:
        """Queries external NOAA DEM or GEBCO WCS API."""
        try:
            params = {
                'bbox': f"{min_lon},{min_lat},{max_lon},{max_lat}",
                'bboxSR': '4326',
                'size': '80,60',
                'imageSR': '4326',
                'format': 'json',
                'f': 'json'
            }
            url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0'})

            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                # If API response returned valid elevation
                if 'values' in data or 'elevation' in data:
                    return self._parse_api_bathymetry(data, min_lat, max_lat, min_lon, max_lon, resolution)

            # Fallback to local source if response is unparseable
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon, resolution)
        except Exception as e:
            logger.warning("Bathymetry API fetch failed: %s. Falling back to local dataset.", e)
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon, resolution)

    def _parse_api_bathymetry(
        self,
        data: Dict[str, Any],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        resolution: str
    ) -> Dict[str, Any]:
        """Normalizes external bathymetry API JSON into SolvX Bathymetry."""
        elevation = data.get('values', data.get('elevation', []))
        nx = len(elevation[0]) if elevation else 50
        ny = len(elevation) if elevation else 45

        lons = np.linspace(min_lon, max_lon, nx)
        lats = np.linspace(min_lat, max_lat, ny)
        xx, yy = project_xy(lons, lats, min_lon, max_lon, min_lat, max_lat)

        raw_depth_km = []
        for row in elevation:
            raw_depth_km.append([round(-v / 1000.0, 4) if v is not None and v < 0 else None for v in row])

        max_d = max([max([v for v in r if v is not None] or [3.5]) for r in raw_depth_km] or [3.5])

        return {
            'source': 'NOAA NCEI Global Mosaic DEM',
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'resolution': resolution,
            'latitude': [round(float(v), 4) for v in lats],
            'longitude': [round(float(v), 4) for v in lons],
            'depth': elevation,
            'x': [round(float(v), 3) for v in xx],
            'y': [round(float(v), 3) for v in yy],
            'rawDepthKm': raw_depth_km,
            'maxDepthKm': round(float(max_d), 3),
            'units': 'meters',
            'metadata': {
                'source': 'NOAA / GEBCO',
                'description': '3D Ocean Seabed Elevation'
            }
        }
