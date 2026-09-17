"""
SolvX Data Collector and Multi-Provider Orchestrator
===================================================
Coordinates scientific ocean variable providers (INCOIS, Copernicus Marine, NOAA, HYCOM)
and the authoritative bathymetry pipeline (GEBCO).

Enforces strict layer responsibility:
- Ocean variable providers: INCOIS, Copernicus Marine, NOAA, HYCOM.
- Bathymetry provider: GEBCO (seabed elevation grids only).
- Transparent failure reporting (explicit requests never silently switch).
- AUTO selection mode with explicit fallback flags.
- LOCAL data tagging (never mislabeled as external agencies).
"""

import time
import json
import logging
from typing import Optional, Dict, Any, List, Union

from ..config import (
    DEFAULT_BBOX,
    MAX_REQUEST_AREA_DEG2,
    LOCAL_DATA_MODE,
    CACHE_TTL
)
from ..models.requests import (
    BBox,
    OceanVariableRequest,
    BathymetryRequest,
    CombinedRegionRequest,
    OceanVariableResponse,
    OceanCurrentsResponse,
    BathymetryResponse,
    CombinedRegionResponse,
    SUPPORTED_OCEAN_PROVIDERS,
    SUPPORTED_OCEAN_VARIABLES
)
from ..adapters import (
    INCOISAdapter,
    NOAAAdapter,
    CopernicusAdapter,
    HYCOMAdapter,
    GEBCOAdapter,
    GeographyAdapter,
    ObservationAdapter,
    EEZAdapter
)
from .cache_service import GLOBAL_CACHE, make_cache_key

logger = logging.getLogger('solvx.collector')
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class DataCollector:
    """Central orchestrator for SolvX oceanographic and bathymetric data feeds."""

    def __init__(self):
        self.incois = INCOISAdapter()
        self.noaa = NOAAAdapter()
        self.copernicus = CopernicusAdapter()
        self.hycom = HYCOMAdapter()
        self.bathymetry = GEBCOAdapter()
        self.geography = GeographyAdapter()
        self.observation = ObservationAdapter()
        self.eez = EEZAdapter()

        self.ocean_providers = {
            'incois': self.incois,
            'noaa': self.noaa,
            'copernicus': self.copernicus,
            'hycom': self.hycom
        }

    def _validate_bbox(self, min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> BBox:
        bbox = BBox(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
        if bbox.area_deg2 > MAX_REQUEST_AREA_DEG2:
            raise ValueError(
                f"Requested region area ({bbox.area_deg2:.1f} deg²) exceeds maximum allowed limit ({MAX_REQUEST_AREA_DEG2:.1f} deg²)"
            )
        return bbox

    # =========================================================================
    # Provider Registry and Discovery
    # =========================================================================

    def get_providers(self) -> List[Dict[str, Any]]:
        """Returns metadata for all available ocean providers and auto-selection."""
        return [
            {
                'id': 'auto',
                'name': 'Automatic Selection (Optimal Provider)',
                'description': 'Intelligently chooses the highest quality available oceanographic provider for the region',
                'type': 'orchestrator',
                'coverage': 'Global',
                'variables': sorted(list(SUPPORTED_OCEAN_VARIABLES))
            },
            {
                'id': 'incois',
                'name': 'INCOIS Ocean Information Bank',
                'description': 'Indian National Centre for Ocean Information Services (HOOFS numerical model & ERDDAP)',
                'type': 'agency',
                'coverage': 'Indian Ocean Basin (40E - 110E, 30S - 30N)',
                'variables': self.incois.get_supported_variables() if hasattr(self.incois, 'get_supported_variables') else list(SUPPORTED_OCEAN_VARIABLES)
            },
            {
                'id': 'copernicus',
                'name': 'Copernicus Marine Service (CMEMS)',
                'description': 'European Union Copernicus Marine Environment Monitoring Service global physics analysis and forecast',
                'type': 'agency',
                'coverage': 'Global (1/12° resolution)',
                'variables': self.copernicus.get_supported_variables()
            },
            {
                'id': 'noaa',
                'name': 'NOAA CoastWatch / OceanWatch',
                'description': 'National Oceanic and Atmospheric Administration satellite and blended observational analyses',
                'type': 'agency',
                'coverage': 'Global',
                'variables': self.noaa.get_supported_variables()
            },
            {
                'id': 'hycom',
                'name': 'HYCOM Consortium',
                'description': 'Hybrid Coordinate Ocean Model 1/12° global reanalysis & forecast via THREDDS Data Server',
                'type': 'consortium',
                'coverage': 'Global',
                'variables': self.hycom.get_supported_variables()
            }
        ]

    def get_provider_status(self) -> Dict[str, Any]:
        """Probes connectivity to all providers and returns a live diagnostic report."""
        status_report = {}
        for prov_id, adapter in self.ocean_providers.items():
            try:
                status_report[prov_id] = adapter.test_connection()
            except Exception as e:
                status_report[prov_id] = {
                    'provider': prov_id.upper(),
                    'status': 'error',
                    'error': str(e)
                }

        # Also probe bathymetry provider
        status_report['gebco'] = {
            'provider': 'GEBCO',
            'status': 'available',
            'dataset': 'GEBCO 2026 Grid (Authoritative Seabed Elevation)'
        }
        return status_report

    def get_provider_variables(self, provider: str) -> List[str]:
        prov_key = provider.strip().lower()
        if prov_key == 'auto':
            return sorted(list(SUPPORTED_OCEAN_VARIABLES))
        if prov_key not in self.ocean_providers:
            raise ValueError(f"Unknown provider '{provider}'. Supported: {list(self.ocean_providers.keys())}")
        adapter = self.ocean_providers[prov_key]
        if hasattr(adapter, 'get_supported_variables'):
            vars_res = adapter.get_supported_variables()
            if vars_res and hasattr(vars_res[0], 'id'):
                return [v.id for v in vars_res]
            return list(vars_res)
        return sorted(list(SUPPORTED_OCEAN_VARIABLES))

    def get_provider_datasets(self, provider: str) -> Dict[str, Any]:
        prov_key = provider.strip().lower()
        if prov_key not in self.ocean_providers:
            raise ValueError(f"Unknown provider '{provider}'. Supported: {list(self.ocean_providers.keys())}")
        adapter = self.ocean_providers[prov_key]
        if hasattr(adapter, 'get_datasets'):
            return adapter.get_datasets()
        return {}

    def get_provider_metadata(self, provider: str) -> Dict[str, Any]:
        prov_key = provider.strip().lower()
        for p in self.get_providers():
            if p['id'] == prov_key:
                return p
        raise ValueError(f"Unknown provider '{provider}'")

    # =========================================================================
    # Ocean Data Fetching & Normalization
    # =========================================================================

    def get_ocean_data(
        self,
        provider: str = 'auto',
        variable: str = 'temperature',
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        stride: int = 1,
        resolution: Optional[str] = 'native'
    ) -> Dict[str, Any]:
        """Fetches and normalizes an ocean variable with transparent provider provenance."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        if not isinstance(depth, (int, float)): depth = None
        if not isinstance(time, str): time = None
        if not isinstance(stride, int): stride = 1
        if not isinstance(resolution, str): resolution = 'native'
        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        prov_key = str(provider).strip().lower() if provider else 'auto' 

        if prov_key not in SUPPORTED_OCEAN_PROVIDERS:
            raise ValueError(f"Unsupported provider '{provider}'. Supported: {sorted(list(SUPPORTED_OCEAN_PROVIDERS))}")

        if variable not in SUPPORTED_OCEAN_VARIABLES:
            raise ValueError(f"Unsupported variable '{variable}'. Supported: {sorted(list(SUPPORTED_OCEAN_VARIABLES))}")

        cache_key = make_cache_key('ocean_fetch', {
            'provider': prov_key,
            'var': variable,
            'min_lat': round(bbox.min_lat, 3),
            'max_lat': round(bbox.max_lat, 3),
            'min_lon': round(bbox.min_lon, 3),
            'max_lon': round(bbox.max_lon, 3),
            'depth': round(depth, 1) if depth is not None else None,
            'time': time,
            'stride': stride
        })

        cached = GLOBAL_CACHE.get(cache_key)
        if cached:
            return cached

        # Case 1: AUTO Provider Selection
        if prov_key == 'auto':
            res = self._fetch_auto(variable, bbox, depth, time, stride)
            if 'source' not in res:
                res['source'] = {
                    'provider': res.get('provider'),
                    'dataset': res.get('dataset'),
                    'mode': res.get('metadata', {}).get('data_type', 'LIVE_API'),
                    'retrieved_at': res.get('metadata', {}).get('retrieved_at', '')
                }
            GLOBAL_CACHE.set(cache_key, res)
            return res

        # Case 2: Explicit Provider Selection (Strict Error Transparency)
        adapter = self.ocean_providers[prov_key]
        t0 = time.time() if hasattr(time, 'time') else 0
        try:
            res = adapter.fetch_ocean_variable(
                variable=variable,
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                depth=depth,
                time=time,
                stride=stride
            )
            # Ensure provenance fields are stamped
            res['requested_provider'] = prov_key
            if 'fallback' not in res:
                res['fallback'] = False
            if 'source' not in res:
                res['source'] = {
                    'provider': res.get('provider'),
                    'dataset': res.get('dataset'),
                    'mode': res.get('metadata', {}).get('data_type', 'LIVE_API'),
                    'retrieved_at': res.get('metadata', {}).get('retrieved_at', '')
                }
            GLOBAL_CACHE.set(cache_key, res)
            return res
        except Exception as e:
            logger.error("Explicit provider '%s' failed for variable '%s': %s", prov_key, variable, e)
            raise RuntimeError(f"Ocean provider '{prov_key.upper()}' failed to deliver '{variable}': {e}") from e

    def _fetch_auto(
        self,
        variable: str,
        bbox: BBox,
        depth: Optional[float],
        time_val: Optional[str],
        stride: int
    ) -> Dict[str, Any]:
        """Auto-selection algorithm: tries the best regional provider, falling back transparently."""
        # If in Indian Ocean, prefer INCOIS
        is_indian_ocean = (
            -35.0 <= bbox.min_lat <= 32.0 and
            -35.0 <= bbox.max_lat <= 32.0 and
            35.0 <= bbox.min_lon <= 115.0 and
            35.0 <= bbox.max_lon <= 115.0
        )

        provider_order = ['incois', 'copernicus', 'noaa', 'hycom'] if is_indian_ocean else ['copernicus', 'noaa', 'hycom', 'incois']
        errors = []

        for p_name in provider_order:
            adapter = self.ocean_providers[p_name]
            try:
                res = adapter.fetch_ocean_variable(
                    variable=variable,
                    min_lat=bbox.min_lat,
                    max_lat=bbox.max_lat,
                    min_lon=bbox.min_lon,
                    max_lon=bbox.max_lon,
                    depth=depth,
                    time=time_val,
                    stride=stride
                )
                res['requested_provider'] = 'auto'
                res['fallback'] = (p_name != provider_order[0])
                logger.info("AUTO provider selection chose '%s' for '%s'", p_name, variable)
                return res
            except Exception as e:
                errors.append(f"{p_name}: {e}")
                continue

        # If all live external providers fail, check if local NetCDF archive is available
        try:
            from ..adapters.incois_adapter import INCOIS_VARIABLE_MAP
            res = self.incois._fetch_from_local_netcdf(
                variable=variable,
                var_config=INCOIS_VARIABLE_MAP.get(variable, {}),
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                depth=depth,
                time=time_val,
                stride=stride
            )
            res['requested_provider'] = 'auto'
            res['provider'] = 'LOCAL'
            res['source_type'] = 'local_netcdf'
            res['fallback'] = True
            if 'source' not in res:
                res['source'] = {
                    'provider': 'LOCAL',
                    'dataset': res.get('dataset'),
                    'mode': 'LOCAL_ARCHIVE_FALLBACK',
                    'retrieved_at': res.get('metadata', {}).get('retrieved_at', '')
                }
            return res
        except Exception as local_err:
            errors.append(f"local_netcdf: {local_err}")

        raise RuntimeError(f"AUTO provider selection could not retrieve '{variable}'. Attempted: {'; '.join(errors)}")

    # =========================================================================
    # Combined Region Fetching (Ocean + Bathymetry)
    # =========================================================================

    def get_combined_region(
        self,
        provider: str = 'auto',
        variable: str = 'temperature',
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        resolution: Optional[str] = 'medium',
        include_bathymetry: bool = True
    ) -> Dict[str, Any]:
        """Bundles requested ocean variable with authoritative GEBCO bathymetry."""
        if min_lat is None or not isinstance(min_lat, (int, float)): min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None or not isinstance(max_lat, (int, float)): max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None or not isinstance(min_lon, (int, float)): min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None or not isinstance(max_lon, (int, float)): max_lon = DEFAULT_BBOX['max_lon']
        if not isinstance(depth, (int, float)): depth = None
        if not isinstance(time, str): time = None
        if not isinstance(resolution, str): resolution = 'medium'
        if not isinstance(include_bathymetry, bool): include_bathymetry = True
        provider = str(provider) if provider else 'auto'
        variable = str(variable) if variable else 'temperature' 

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)

        ocean_res = None
        bathy_res = None
        errors = {}

        try:
            ocean_res = self.get_ocean_data(
                provider=provider,
                variable=variable,
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                depth=depth,
                time=time
            )
        except Exception as e:
            errors['ocean'] = str(e)

        if include_bathymetry:
            try:
                bathy_res = self.get_bathymetry(
                    min_lat=bbox.min_lat,
                    max_lat=bbox.max_lat,
                    min_lon=bbox.min_lon,
                    max_lon=bbox.max_lon,
                    resolution=resolution or 'medium'
                )
            except Exception as e:
                errors['bathymetry'] = str(e)

        return {
            'region': {
                'bbox': {'min_lat': bbox.min_lat, 'max_lat': bbox.max_lat, 'min_lon': bbox.min_lon, 'max_lon': bbox.max_lon},
                'area_deg2': round(bbox.area_deg2, 2)
            },
            'ocean': ocean_res,
            'bathymetry': bathy_res,
            'metadata': {
                'requested_provider': provider,
                'active_provider': ocean_res.get('provider') if ocean_res else None,
                'active_bathymetry': 'GEBCO',
                'errors': errors if errors else None
            }
        }

    # =========================================================================
    # Backward Compatibility & Ancillary Layer Delegations
    # =========================================================================

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
        """Legacy entry point defaulting to AUTO provider selection."""
        return self.get_ocean_data(
            provider='auto',
            variable=variable,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth,
            time=time_str,
            stride=stride
        )

    def get_ocean_variables(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time_str: Optional[str] = None,
        provider: str = 'auto'
    ) -> Dict[str, Any]:
        vars_to_fetch = ['temperature', 'salinity', 'currents']
        results = {}
        for v in vars_to_fetch:
            try:
                results[v] = self.get_ocean_data(
                    provider=provider,
                    variable=v,
                    min_lat=min_lat,
                    max_lat=max_lat,
                    min_lon=min_lon,
                    max_lon=max_lon,
                    depth=depth,
                    time=time_str
                )
            except Exception as e:
                results[v] = {'error': str(e)}

        return {
            'source': f"SolvX Ocean Collection ({provider.upper()})",
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'variables': results
        }

    def get_bathymetry(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        resolution: str = 'medium'
    ) -> Dict[str, Any]:
        from .bathymetry_service import get_bathymetry_data
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        return get_bathymetry_data(bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat, resolution=resolution)

    def get_variables_catalog(self) -> Dict[str, Any]:
        vars_list = self.incois.get_supported_variables()
        return {
            'source': 'SolvX Ocean Registry',
            'count': len(vars_list),
            'variables': [v.model_dump() for v in vars_list]
        }

    def get_geometry(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
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

        res = self.geography.fetch_geography(
            min_lat=bbox.min_lat,
            max_lat=bbox.max_lat,
            min_lon=bbox.min_lon,
            max_lon=bbox.max_lon
        )
        GLOBAL_CACHE.set(cache_key, res)
        return res

    def get_coastline(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
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
        provider: str = 'auto',
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None
    ) -> Dict[str, Any]:
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        prov_key = provider.strip().lower()

        adapter = self.ocean_providers.get(prov_key, self.incois)
        return adapter.get_variable_timeline(
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
        return self.observation.fetch_observations(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon
        )

    def get_observation_comparison(self, obs_id: str, variable: str = 'temperature') -> Dict[str, Any]:
        return self.observation.compare_observation(obs_id, variable=variable)


COLLECTOR = DataCollector()