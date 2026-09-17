import time
import logging
import json
from typing import Optional, Dict, Any, List, Union

from ..config import (
    DEFAULT_BBOX,
    MAX_REQUEST_AREA_DEG2,
    CACHE_TTL
)
from ..models.requests import (
    BBox,
    SolvXOceanResponse,
    SolvXCurrentsResponse,
    SolvXBathymetryResponse,
    SolvXGeographyResponse,
    SolvXVariableCatalogResponse,
    SolvXObservationsResponse
)
from ..adapters import (
    INCOISAdapter,
    BathymetryAdapter,
    GeographyAdapter,
    ObservationAdapter,
    EEZAdapter
)
from .cache_service import GLOBAL_CACHE, make_cache_key

# Configure structured logger
logger = logging.getLogger('solvx.collector')
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class DataCollector:
    """Central Orchestrator and Data Collection Manager for SolvX.

    Responsible for fetching, validating, subsetting, normalizing,
    caching and returning oceanographic, bathymetric, and geographic data.
    """

    def __init__(self):
        self.incois = INCOISAdapter()
        self.bathymetry = BathymetryAdapter()
        self.geography = GeographyAdapter()
        self.observation = ObservationAdapter()
        self.eez = EEZAdapter()

    def _validate_bbox(self, min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> BBox:
        """Validates bounding box coordinates and maximum allowed query area."""
        bbox = BBox(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
        if bbox.area_deg2 > MAX_REQUEST_AREA_DEG2:
            raise ValueError(
                f"Requested region area ({bbox.area_deg2:.1f} deg²) exceeds maximum allowed limit ({MAX_REQUEST_AREA_DEG2:.1f} deg²)"
            )
        return bbox

    def get_variables_catalog(self) -> Dict[str, Any]:
        """Returns catalogue of all physical variables supported by the collector."""
        vars_list = self.incois.get_supported_variables()
        return {
            'source': 'INCOIS Ocean Information Bank / SolvX Registry',
            'count': len(vars_list),
            'variables': [v.model_dump() for v in vars_list]
        }

    def get_ocean_variable(
        self,
        variable: str,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time_str: Optional[str] = None,
        stride: int = 1
    ) -> Dict[str, Any]:
        """Retrieves and normalizes a specific physical ocean variable for the bounding box."""
        if not isinstance(min_lat, (int, float)): min_lat = DEFAULT_BBOX['min_lat']
        if not isinstance(max_lat, (int, float)): max_lat = DEFAULT_BBOX['max_lat']
        if not isinstance(min_lon, (int, float)): min_lon = DEFAULT_BBOX['min_lon']
        if not isinstance(max_lon, (int, float)): max_lon = DEFAULT_BBOX['max_lon']
        if not isinstance(depth, (int, float)): depth = None
        if not isinstance(time_str, str): time_str = None
        if not isinstance(stride, int): stride = 1

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)

        cache_key = make_cache_key('ocean_var', {
            'var': variable,
            'min_lat': round(bbox.min_lat, 3),
            'max_lat': round(bbox.max_lat, 3),
            'min_lon': round(bbox.min_lon, 3),
            'max_lon': round(bbox.max_lon, 3),
            'depth': round(depth, 1) if depth is not None else None,
            'time': time_str,
            'stride': stride
        })

        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        t0 = time.time()
        try:
            res = self.incois.fetch_ocean_variable(
                variable=variable,
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                depth=depth,
                time=time_str,
                stride=stride
            )
            duration_ms = round((time.time() - t0) * 1000, 2)
            size_bytes = len(json.dumps(res, default=str))

            logger.info(
                "Fetch SUCCESS | Source: %s | Var: %s | Bounds: [%.2f, %.2f, %.2f, %.2f] | Depth: %s | Time: %s | %s ms | %s bytes",
                res.get('source'), variable, bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat, depth, time_str, duration_ms, size_bytes
            )

            GLOBAL_CACHE.set(cache_key, res)
            return res
        except Exception as e:
            duration_ms = round((time.time() - t0) * 1000, 2)
            logger.error(
                "Fetch FAILED | Source: INCOIS | Var: %s | Bounds: [%.2f, %.2f, %.2f, %.2f] | %s ms | Error: %s",
                variable, bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat, duration_ms, e
            )
            raise

    def get_ocean_variables(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time_str: Optional[str] = None
    ) -> Dict[str, Any]:
        """Retrieves multiple primary oceanographic fields (temperature, salinity, currents)."""
        vars_to_fetch = ['temperature', 'salinity', 'currents']
        results = {}
        for v in vars_to_fetch:
            try:
                results[v] = self.get_ocean_variable(
                    variable=v,
                    min_lat=min_lat,
                    max_lat=max_lat,
                    min_lon=min_lon,
                    max_lon=max_lon,
                    depth=depth,
                    time_str=time_str
                )
            except Exception as e:
                logger.warning("Failed to fetch variable '%s': %s", v, e)
                results[v] = {'error': str(e)}

        return {
            'source': 'INCOIS Ocean Data Collection',
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'variables': results
        }

    def get_bathymetry(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        resolution: str = '0.083deg'
    ) -> Dict[str, Any]:
        """Retrieves and normalizes 3D seabed bathymetry elevation grid."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)

        cache_key = make_cache_key('bathymetry_col', {
            'min_lat': round(bbox.min_lat, 3),
            'max_lat': round(bbox.max_lat, 3),
            'min_lon': round(bbox.min_lon, 3),
            'max_lon': round(bbox.max_lon, 3),
            'resolution': resolution
        })

        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        t0 = time.time()
        try:
            res = self.bathymetry.fetch_bathymetry(
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                resolution=resolution
            )
            duration_ms = round((time.time() - t0) * 1000, 2)
            logger.info("Bathymetry SUCCESS | Source: %s | %s ms", res.get('source'), duration_ms)
            GLOBAL_CACHE.set(cache_key, res)
            return res
        except Exception as e:
            logger.error("Bathymetry FAILED | Error: %s", e)
            raise

    def get_geometry(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
        """Retrieves 3D land polygons and boundary geometry."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)

        cache_key = make_cache_key('geography_col', {
            'min_lat': round(bbox.min_lat, 3),
            'max_lat': round(bbox.max_lat, 3),
            'min_lon': round(bbox.min_lon, 3),
            'max_lon': round(bbox.max_lon, 3)
        })

        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        t0 = time.time()
        try:
            res = self.geography.fetch_geography(
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon
            )
            duration_ms = round((time.time() - t0) * 1000, 2)
            logger.info("Geography SUCCESS | Source: %s | %s ms", res.get('source'), duration_ms)
            GLOBAL_CACHE.set(cache_key, res)
            return res
        except Exception as e:
            logger.error("Geography FAILED | Error: %s", e)
            raise

    def get_coastline(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
        """Retrieves shoreline and EEZ boundary contours."""
        geo = self.get_geometry(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
        return {
            'source': geo.get('source'),
            'bounds': geo.get('bounds'),
            'coast': geo.get('coast', []),
            'eezBeads': geo.get('eezBeads', []),
            'metadata': geo.get('metadata', {})
        }

    def get_timeline(
        self,
        variable: str,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None
    ) -> Dict[str, Any]:
        """Discovers temporal coverage, resolution, and forecast availability for a variable."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        return self.incois.get_variable_timeline(
            variable=variable,
            min_lat=bbox.min_lat,
            max_lat=bbox.max_lat,
            min_lon=bbox.min_lon,
            max_lon=bbox.max_lon,
            depth=depth
        )

    def get_eez(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
        """Retrieves official Marine Regions / VLIZ EEZ boundaries."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        cache_key = make_cache_key('eez_col', {
            'min_lat': round(bbox.min_lat, 3),
            'max_lat': round(bbox.max_lat, 3),
            'min_lon': round(bbox.min_lon, 3),
            'max_lon': round(bbox.max_lon, 3)
        })

        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        res = self.eez.fetch_eez(
            min_lat=bbox.min_lat,
            max_lat=bbox.max_lat,
            min_lon=bbox.min_lon,
            max_lon=bbox.max_lon
        )
        GLOBAL_CACHE.set(cache_key, res)
        return res

    def get_observations(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
        """Retrieves in-situ Argo float profiles in the region."""
        return self.observation.fetch_observations(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon
        )

    def get_observation_comparison(self, obs_id: str, variable: str = 'temperature') -> Dict[str, Any]:
        """Compares float sounding profile against collocated model values."""
        return self.observation.compare_observation(obs_id, variable=variable)


# Global singleton instance
COLLECTOR = DataCollector()
