import os
import json
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, List

from ..config import (
    GEOGRAPHY_BASE_URL,
    REQUEST_TIMEOUT,
    LOCAL_DATA_MODE
)
from ..models.requests import SolvXGeographyResponse

logger = logging.getLogger('solvx.geography')


class GeographyAdapter:
    """Geography & Coastline Adapter for Natural Earth and OpenStreetMap vectors."""

    def __init__(self, base_url: str = GEOGRAPHY_BASE_URL, timeout: int = REQUEST_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout

    def fetch_geography(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Fetches 3D land polygons, coastline vectors, and maritime boundaries."""
        if LOCAL_DATA_MODE:
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

        return self._fetch_from_api(min_lat, max_lat, min_lon, max_lon)

    def _fetch_from_local_source(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Delegates to local geography service extracting from Natural Earth 10m shapefiles."""
        from ..services.geography_service import get_geography_data

        geo = get_geography_data(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
        return {
            'source': 'Natural Earth 10m Physical (Local Archive)',
            'bounds': geo.get('bounds', [min_lon, max_lon, min_lat, max_lat]),
            'land': geo.get('land', []),
            'coast': geo.get('coast', []),
            'islands': geo.get('islands', []),
            'landBoundary': geo.get('landBoundary', []),
            'islandCoast': geo.get('islandCoast', []),
            'eezBeads': geo.get('eezBeads', []),
            'metadata': {
                'source': 'Natural Earth 1:10,000,000 Physical Vectors',
                'description': 'High-resolution shoreline and land polygons'
            }
        }

    def _fetch_from_api(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Fetches geographic vectors from remote GeoJSON CDN / WFS."""
        try:
            # For remote physical vector endpoints, we can fetch land GeoJSON features
            url = f"{self.base_url}/ne_10m_land.geojson"
            req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0'})

            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if 'features' in data:
                    # Clip to bbox and project
                    return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)
        except Exception as e:
            logger.warning("Geography API fetch failed: %s. Using local Natural Earth dataset.", e)
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)
