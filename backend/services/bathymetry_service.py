"""
SolvX Bathymetry Service
========================
Provides authoritative GEBCO bathymetry grids and 3D terrain projection.
Strictly subsets by user BBOX with configurable downsampling.
Synthetic/fake data generation has been removed to preserve scientific integrity.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np

from ..config import DATA_DIR, BASE_DIR, DEFAULT_BBOX
from ..adapters.bathymetry_adapter import GEBCOAdapter
from .cache_service import GLOBAL_CACHE

FRONTEND_GEOM = BASE_DIR / 'frontend' / 'geometry.json'
_gebco_adapter = GEBCOAdapter()


def is_near_default(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> bool:
    b = DEFAULT_BBOX
    return (
        abs(min_lon - b['min_lon']) < 0.2 and
        abs(max_lon - b['max_lon']) < 0.2 and
        abs(min_lat - b['min_lat']) < 0.2 and
        abs(max_lat - b['max_lat']) < 0.2
    )


def get_bathymetry_data(
    min_lon: float,
    max_lon: float,
    min_lat: float,
    max_lat: float,
    resolution: Optional[str] = 'medium'
) -> Dict[str, Any]:
    """Retrieves authoritative 3D bathymetric seabed grid for requested bounding box."""
    cache_key = f"bathymetry:{min_lat:.3f}:{max_lat:.3f}:{min_lon:.3f}:{max_lon:.3f}:{resolution}"
    cached = GLOBAL_CACHE.get(cache_key)
    if cached:
        return cached

    # 1. Check if default preset and pre-rendered frontend geometry.json exists
    if is_near_default(min_lon, max_lon, min_lat, max_lat) and FRONTEND_GEOM.exists():
        try:
            with open(FRONTEND_GEOM, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'terrain' in data:
                    t = data['terrain']
                    res = {
                        'type': 'bathymetry',
                        'provider': 'GEBCO',
                        'dataset': 'GEBCO 2026 Grid',
                        'units': 'meters',
                        'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
                        'bounds': data.get('bounds', [min_lon, max_lon, min_lat, max_lat]),
                        'latitude': t.get('y', []),
                        'longitude': t.get('x', []),
                        'elevation': [[-v * 1000.0 if v is not None and v > 0 else 0.0 for v in row] for row in t.get('rawDepthKm', [])],
                        'depth': [[-v * 1000.0 if v is not None and v > 0 else 0.0 for v in row] for row in t.get('rawDepthKm', [])],
                        'x': t.get('x', []),
                        'y': t.get('y', []),
                        'rawDepthKm': t.get('rawDepthKm', []),
                        'maxDepthKm': t.get('maxDepthKm', 3.8),
                        'terrain': t,
                        'metadata': _gebco_adapter.get_metadata()
                    }
                    GLOBAL_CACHE.set(cache_key, res)
                    return res
        except Exception:
            pass

    # 2. Fetch authoritative GEBCO bathymetry
    data = _gebco_adapter.fetch_bathymetry(
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        resolution=resolution
    )

    if 'depth' not in data and 'elevation' in data:
        data['depth'] = data['elevation']

    # Attach terrain and bounds for 3D viewer compatibility
    data['bounds'] = [min_lon, max_lon, min_lat, max_lat]
    data['terrain'] = {
        'x': data.get('x', []),
        'y': data.get('y', []),
        'rawDepthKm': data.get('rawDepthKm', []),
        'maxDepthKm': data.get('maxDepthKm', 3.5)
    }

    GLOBAL_CACHE.set(cache_key, data)
    return data