from typing import Dict, Any, Optional
from ..adapters.eez_adapter import EEZAdapter
from .cache_service import GLOBAL_CACHE, make_cache_key

_EEZ_ADAPTER = EEZAdapter()

def get_eez_data(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> Dict[str, Any]:
    """Retrieves cached Marine Regions EEZ boundaries for the bounding box."""
    cache_key = make_cache_key('eez_v12', {
        'min_lon': round(min_lon, 3),
        'max_lon': round(max_lon, 3),
        'min_lat': round(min_lat, 3),
        'max_lat': round(max_lat, 3)
    })
    cached = GLOBAL_CACHE.get(cache_key)
    if cached:
        return cached

    res = _EEZ_ADAPTER.fetch_eez(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    GLOBAL_CACHE.set(cache_key, res)
    return res
