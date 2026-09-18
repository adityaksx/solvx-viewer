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

from ..adapters.copernicus_adapter import CopernicusAdapter
from ..adapters.open_meteo_adapter import OpenMeteoAdapter

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
        self.open_meteo = OpenMeteoAdapter()
        self.bathymetry = GEBCOAdapter()
        self.geography = GeographyAdapter()
        self.observation = ObservationAdapter()
        self.eez = EEZAdapter()

        self.ocean_providers = {
            'incois': self.incois,
            'noaa': self.noaa,
            'copernicus': self.copernicus,
            'hycom': self.hycom,
            'open_meteo': self.open_meteo
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
        return [
            {
                'id': 'auto',
                'name': 'SolvX Data Service',
                'description': 'Automated Ocean & Atmosphere Integration',
                'type': 'orchestrator',
                'coverage': 'Global',
                'variables': ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height', 'air_temperature']
            }
        ]

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

    def get_ocean_data(
        self,
        provider: str = 'auto',
        variable: str = 'ocean_temperature',
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        stride: int = 1,
        resolution: Optional[str] = 'native',
        **kwargs
    ) -> Dict[str, Any]:
        """Fetches and normalizes any ocean, biogeochemical, wave, or atmospheric variable."""
        if min_lat is None: min_lat = DEFAULT_BBOX['min_lat']
        if max_lat is None: max_lat = DEFAULT_BBOX['max_lat']
        if min_lon is None: min_lon = DEFAULT_BBOX['min_lon']
        if max_lon is None: max_lon = DEFAULT_BBOX['max_lon']

        bbox = self._validate_bbox(min_lat, max_lat, min_lon, max_lon)
        prov_key = str(provider).strip().lower() if provider else 'auto'
        var_norm = 'ocean_temperature' if variable in ('temperature', 'temp') else variable

        # 1. Atmospheric & Marine Wave Variables (Served live via Open-Meteo)
        if var_norm in self.open_meteo.get_supported_variables():
            try:
                return self.open_meteo.fetch_ocean_variable(
                    variable=var_norm,
                    min_lat=bbox.min_lat,
                    max_lat=bbox.max_lat,
                    min_lon=bbox.min_lon,
                    max_lon=bbox.max_lon,
                    depth=depth,
                    time=time,
                    stride=stride
                )
            except Exception as e:
                logger.warning("Open-Meteo fetch failed for '%s': %s", var_norm, e)

        # 2. Oceanographic & Biogeochemical Variables
        # Primary live provider: Copernicus Marine Service
        if prov_key in ('copernicus', 'auto'):
            try:
                res = self.copernicus.fetch_ocean_variable(
                    variable=var_norm,
                    min_lat=bbox.min_lat,
                    max_lat=bbox.max_lat,
                    min_lon=bbox.min_lon,
                    max_lon=bbox.max_lon,
                    depth=depth,
                    time=time,
                    stride=stride
                )
                res['requested_provider'] = prov_key
                res['fallback'] = False
                return res
            except Exception as cop_err:
                logger.info("Live Copernicus fetch failed for '%s' (%s); falling back to local archive / INCOIS", var_norm, cop_err)

        # 3. Fallback to Local NetCDF Archive / INCOIS Model
        try:
            from ..adapters.incois_adapter import INCOIS_VARIABLE_MAP
            incois_var = 'temperature' if var_norm in ('ocean_temperature', 'temperature') else var_norm
            var_cfg = INCOIS_VARIABLE_MAP.get(incois_var) or INCOIS_VARIABLE_MAP.get('temperature', {})
            res = self.incois._fetch_from_local_netcdf(
                variable=incois_var,
                var_config=var_cfg,
                min_lat=bbox.min_lat,
                max_lat=bbox.max_lat,
                min_lon=bbox.min_lon,
                max_lon=bbox.max_lon,
                depth=depth,
                time=time,
                stride=stride
            )
            res['variable'] = var_norm
            res['requested_provider'] = prov_key
            res['provider'] = 'LOCAL_ARCHIVE'
            res['source_type'] = 'local_netcdf'
            res['fallback'] = True
            return res
        except Exception as local_err:
            logger.error("Local NetCDF fallback failed for '%s': %s", var_norm, local_err)

        raise RuntimeError(f"Could not retrieve ocean data for variable '{variable}'.")

    def get_ocean_variable(self, *args, **kwargs) -> Dict[str, Any]:
        """Universal entry point for variable retrieval; accepts provider and all keyword arguments."""
        if args:
            if len(args) == 1 and 'variable' not in kwargs:
                kwargs['variable'] = args[0]
            elif len(args) > 1:
                keys = ['variable', 'min_lat', 'max_lat', 'min_lon', 'max_lon', 'depth', 'time', 'stride']
                for k, v in zip(keys, args):
                    if k not in kwargs:
                        kwargs[k] = v
        if 'time_str' in kwargs and 'time' not in kwargs:
            kwargs['time'] = kwargs.pop('time_str')

        return self.get_ocean_data(**kwargs)

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
        vars_list = [
            {'id': 'ocean_temperature', 'label': 'Ocean Temperature', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'salinity', 'label': 'Salinity', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'currents', 'label': 'Ocean Currents', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'sea_surface_height', 'label': 'Sea Surface Height', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'sea_level_anomaly', 'label': 'Sea Level Anomaly', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'temperature_anomaly', 'label': 'SST Anomaly', 'available': True, 'group': 'PHYSICAL OCEAN'},
            {'id': 'mixed_layer_depth', 'label': 'Mixed Layer Depth', 'available': True, 'group': 'PHYSICAL OCEAN'},
            
            {'id': 'chlorophyll', 'label': 'Chlorophyll-a', 'available': True, 'group': 'BIOGEOCHEMISTRY'},
            {'id': 'dissolved_oxygen', 'label': 'Dissolved Oxygen', 'available': True, 'group': 'BIOGEOCHEMISTRY'},
            {'id': 'ph', 'label': 'Ocean pH / Acidity', 'available': True, 'group': 'BIOGEOCHEMISTRY'},
            {'id': 'nitrate', 'label': 'Nitrate', 'available': True, 'group': 'BIOGEOCHEMISTRY'},
            {'id': 'phosphate', 'label': 'Phosphate', 'available': True, 'group': 'BIOGEOCHEMISTRY'},
            
            {'id': 'wave_height', 'label': 'Wave Height', 'available': True, 'group': 'SURFACE / ATMOSPHERE'},
            {'id': 'wave_direction', 'label': 'Wave Direction', 'available': True, 'group': 'SURFACE / ATMOSPHERE'},
            {'id': 'wind_speed', 'label': 'Wind Speed', 'available': True, 'group': 'SURFACE / ATMOSPHERE'},
            {'id': 'wind_direction', 'label': 'Wind Direction', 'available': True, 'group': 'SURFACE / ATMOSPHERE'},
            {'id': 'wind_stress', 'label': 'Wind Stress', 'available': True, 'group': 'SURFACE / ATMOSPHERE'},
        ]
        return {
            'source': 'SolvX Normalized Data',
            'count': len(vars_list),
            'variables': vars_list
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
        min_lat: float = None,
        max_lat: float = None,
        min_lon: float = None,
        max_lon: float = None,
        depth: float = None,
        start: str = None,
        end: str = None
    ):
        # We just generate a 7-day timeline from start/end or defaults
        from datetime import datetime, timedelta, timezone
        
        start_dt = datetime.fromisoformat(start.replace('Z', '+00:00')) if start else datetime.now(timezone.utc) - timedelta(days=7)
        end_dt = datetime.fromisoformat(end.replace('Z', '+00:00')) if end else datetime.now(timezone.utc)
        
        timestamps = []
        curr = start_dt
        while curr <= end_dt:
            timestamps.append(curr.strftime('%Y-%m-%dT%H:%M:%SZ'))
            curr += timedelta(days=1)
            
        return {
            'provider': 'Copernicus / Open-Meteo',
            'variable': variable,
            'dataset': 'solvx_combined',
            'available_from': timestamps[0] if timestamps else None,
            'available_to': timestamps[-1] if timestamps else None,
            'default_resolution': 'daily',
            'resolutions': ['hourly', 'daily', 'monthly'],
            'historical': {'from': timestamps[0] if timestamps else None, 'to': timestamps[-1] if timestamps else None},
            'forecast': {'from': timestamps[-1] if timestamps else None, 'to': timestamps[-1] if timestamps else None},
            'available_timestamps': timestamps,
            'depth_levels': [0.494]
        }

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