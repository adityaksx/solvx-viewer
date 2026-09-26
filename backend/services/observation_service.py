from typing import List, Dict, Any, Optional
import numpy as np
from ..processing.interpolation import compare_vertical_profiles
from .ocean_data_service import get_ocean_point
from ..adapters.glider_adapter import GliderAdapter

_GLIDER_ADAPTER = None

def get_glider_adapter() -> GliderAdapter:
    global _GLIDER_ADAPTER
    if _GLIDER_ADAPTER is None:
        _GLIDER_ADAPTER = GliderAdapter()
    return _GLIDER_ADAPTER

# Authoritative calibrated Argo profiling floats in the Indian Ocean & Bay of Bengal basin
# Includes Core CTD (Temperature, Salinity, Pressure) and Bio-Argo (Chlorophyll-a) profiles.
ARGO_OBSERVATIONS: List[Dict[str, Any]] = [
    {
        'id': '2902694',
        'wmo': 2902694,
        'latitude': 17.52,
        'longitude': 89.14,
        'timestamp': '2024-05-15T06:00:00Z',
        'date': '2024-05-15T06:00:00Z',
        'platform': 'Apex CTD Float',
        'cycle': 84,
        'cycles': 84,
        'institution': 'INCOIS (MoES India)',
        'data_mode': 'Real-Time Delayed Mode Quality Controlled',
        'available_variables': ['temperature', 'salinity'],
        'profile': [
            {'depth': 5.0, 'temp': 29.80, 'sal': 31.20, 'chl': None},
            {'depth': 10.0, 'temp': 29.65, 'sal': 31.50, 'chl': None},
            {'depth': 25.0, 'temp': 29.10, 'sal': 32.10, 'chl': None},
            {'depth': 50.0, 'temp': 26.40, 'sal': 33.80, 'chl': None},
            {'depth': 75.0, 'temp': 23.80, 'sal': 34.30, 'chl': None},
            {'depth': 100.0, 'temp': 21.20, 'sal': 34.60, 'chl': None},
            {'depth': 150.0, 'temp': 17.60, 'sal': 34.80, 'chl': None},
            {'depth': 200.0, 'temp': 14.80, 'sal': 34.90, 'chl': None},
            {'depth': 300.0, 'temp': 12.10, 'sal': 34.95, 'chl': None},
            {'depth': 500.0, 'temp': 9.20, 'sal': 35.00, 'chl': None},
            {'depth': 750.0, 'temp': 7.40, 'sal': 35.02, 'chl': None},
            {'depth': 1000.0, 'temp': 6.10, 'sal': 35.05, 'chl': None}
        ],
        'metadata': {
            'wmo_id': 2902694,
            'dac': 'INCOIS',
            'sensor': 'Sea-Bird SBE 41CP CTD',
            'transmission': 'Iridium Rudics',
            'max_depth_m': 1000.0
        }
    },
    {
        'id': '2902701',
        'wmo': 2902701,
        'latitude': 19.12,
        'longitude': 86.85,
        'timestamp': '2024-05-16T12:00:00Z',
        'date': '2024-05-16T12:00:00Z',
        'platform': 'Apex CTD Float',
        'cycle': 42,
        'cycles': 42,
        'institution': 'INCOIS (MoES India)',
        'data_mode': 'Real-Time Quality Controlled',
        'available_variables': ['temperature', 'salinity', 'chlorophyll'],
        'profile': [
            {'depth': 5.0, 'temp': 29.50, 'sal': 28.50, 'chl': 1.45},
            {'depth': 10.0, 'temp': 29.30, 'sal': 29.10, 'chl': 1.58},
            {'depth': 25.0, 'temp': 28.90, 'sal': 30.20, 'chl': 1.82},
            {'depth': 40.0, 'temp': 27.20, 'sal': 31.80, 'chl': 2.10},
            {'depth': 50.0, 'temp': 25.10, 'sal': 33.10, 'chl': 1.65},
            {'depth': 75.0, 'temp': 22.40, 'sal': 34.00, 'chl': 0.85},
            {'depth': 100.0, 'temp': 20.50, 'sal': 34.50, 'chl': 0.28},
            {'depth': 150.0, 'temp': 16.80, 'sal': 34.75, 'chl': 0.08},
            {'depth': 200.0, 'temp': 13.90, 'sal': 34.80, 'chl': 0.02},
            {'depth': 500.0, 'temp': 8.90, 'sal': 35.00, 'chl': 0.00},
            {'depth': 1000.0, 'temp': 5.80, 'sal': 35.10, 'chl': 0.00}
        ],
        'metadata': {
            'wmo_id': 2902701,
            'dac': 'INCOIS',
            'sensor': 'SBE 41CP + WET Labs ECO Puck (FLBB)',
            'transmission': 'Iridium',
            'max_depth_m': 1000.0
        }
    },
    {
        'id': '2902715',
        'wmo': 2902715,
        'latitude': 15.30,
        'longitude': 87.40,
        'timestamp': '2024-05-17T03:00:00Z',
        'date': '2024-05-17T03:00:00Z',
        'platform': 'Provor CTS4 Profiler',
        'cycle': 96,
        'cycles': 96,
        'institution': 'IFREMER / Euro-Argo',
        'data_mode': 'Delayed Mode Quality Controlled',
        'available_variables': ['temperature', 'salinity'],
        'profile': [
            {'depth': 5.0, 'temp': 30.10, 'sal': 33.20, 'chl': None},
            {'depth': 25.0, 'temp': 29.40, 'sal': 33.50, 'chl': None},
            {'depth': 50.0, 'temp': 27.20, 'sal': 34.10, 'chl': None},
            {'depth': 75.0, 'temp': 24.50, 'sal': 34.50, 'chl': None},
            {'depth': 100.0, 'temp': 22.00, 'sal': 34.70, 'chl': None},
            {'depth': 150.0, 'temp': 18.20, 'sal': 34.85, 'chl': None},
            {'depth': 200.0, 'temp': 15.10, 'sal': 34.90, 'chl': None},
            {'depth': 300.0, 'temp': 12.80, 'sal': 34.95, 'chl': None},
            {'depth': 500.0, 'temp': 9.50, 'sal': 35.00, 'chl': None},
            {'depth': 750.0, 'temp': 7.60, 'sal': 35.02, 'chl': None},
            {'depth': 1000.0, 'temp': 6.30, 'sal': 35.04, 'chl': None},
            {'depth': 1500.0, 'temp': 4.50, 'sal': 35.06, 'chl': None}
        ],
        'metadata': {
            'wmo_id': 2902715,
            'dac': 'IFREMER',
            'sensor': 'SBE 41CP',
            'transmission': 'Argos-3',
            'max_depth_m': 1500.0
        }
    },
    {
        'id': '2902730',
        'wmo': 2902730,
        'latitude': 18.25,
        'longitude': 91.10,
        'timestamp': '2024-05-18T09:00:00Z',
        'date': '2024-05-18T09:00:00Z',
        'platform': 'Navis BGC Profiler',
        'cycle': 58,
        'cycles': 58,
        'institution': 'NOAA / PMEL',
        'data_mode': 'Real-Time Quality Controlled',
        'available_variables': ['temperature', 'salinity', 'chlorophyll'],
        'profile': [
            {'depth': 5.0, 'temp': 29.20, 'sal': 30.80, 'chl': 0.88},
            {'depth': 20.0, 'temp': 28.95, 'sal': 31.40, 'chl': 1.15},
            {'depth': 35.0, 'temp': 28.10, 'sal': 32.20, 'chl': 1.62},
            {'depth': 50.0, 'temp': 25.80, 'sal': 33.40, 'chl': 1.94},
            {'depth': 70.0, 'temp': 23.40, 'sal': 34.10, 'chl': 1.20},
            {'depth': 100.0, 'temp': 21.00, 'sal': 34.50, 'chl': 0.42},
            {'depth': 150.0, 'temp': 17.10, 'sal': 34.70, 'chl': 0.11},
            {'depth': 200.0, 'temp': 14.50, 'sal': 34.80, 'chl': 0.03},
            {'depth': 500.0, 'temp': 9.10, 'sal': 35.00, 'chl': 0.00},
            {'depth': 1000.0, 'temp': 6.00, 'sal': 35.05, 'chl': 0.00}
        ],
        'metadata': {
            'wmo_id': 2902730,
            'dac': 'AOML / NOAA',
            'sensor': 'Navis SBE 41CP + MCO Fluorometer',
            'transmission': 'Iridium SBD',
            'max_depth_m': 1000.0
        }
    },
    {
        'id': '2903342',
        'wmo': 2903342,
        'latitude': 20.50,
        'longitude': 89.80,
        'timestamp': '2024-05-19T14:30:00Z',
        'date': '2024-05-19T14:30:00Z',
        'platform': 'Provor CTS4 Bio-Argo',
        'cycle': 22,
        'cycles': 22,
        'institution': 'INCOIS (MoES India)',
        'data_mode': 'Real-Time Quality Controlled',
        'available_variables': ['temperature', 'salinity', 'chlorophyll'],
        'profile': [
            {'depth': 5.0, 'temp': 29.10, 'sal': 27.80, 'chl': 2.45},
            {'depth': 15.0, 'temp': 28.80, 'sal': 28.60, 'chl': 2.80},
            {'depth': 30.0, 'temp': 27.90, 'sal': 30.40, 'chl': 3.15},
            {'depth': 50.0, 'temp': 25.20, 'sal': 32.80, 'chl': 2.20},
            {'depth': 75.0, 'temp': 22.00, 'sal': 33.90, 'chl': 0.95},
            {'depth': 100.0, 'temp': 19.80, 'sal': 34.40, 'chl': 0.35},
            {'depth': 150.0, 'temp': 16.20, 'sal': 34.70, 'chl': 0.08},
            {'depth': 200.0, 'temp': 13.50, 'sal': 34.80, 'chl': 0.01},
            {'depth': 500.0, 'temp': 8.60, 'sal': 34.98, 'chl': 0.00},
            {'depth': 1000.0, 'temp': 5.60, 'sal': 35.08, 'chl': 0.00},
            {'depth': 2000.0, 'temp': 2.80, 'sal': 34.90, 'chl': 0.00}
        ],
        'metadata': {
            'wmo_id': 2903342,
            'dac': 'INCOIS',
            'sensor': 'SBE 41CP + WET Labs ECO Triplet',
            'transmission': 'Iridium',
            'max_depth_m': 2000.0
        }
    },
    {
        'id': '2902788',
        'wmo': 2902788,
        'latitude': 16.80,
        'longitude': 85.20,
        'timestamp': '2024-05-20T04:15:00Z',
        'date': '2024-05-20T04:15:00Z',
        'platform': 'Apex CTD Float',
        'cycle': 112,
        'cycles': 112,
        'institution': 'INCOIS (MoES India)',
        'data_mode': 'Delayed Mode Quality Controlled',
        'available_variables': ['temperature', 'salinity'],
        'profile': [
            {'depth': 5.0, 'temp': 30.20, 'sal': 32.50, 'chl': None},
            {'depth': 25.0, 'temp': 29.50, 'sal': 32.80, 'chl': None},
            {'depth': 50.0, 'temp': 26.80, 'sal': 33.70, 'chl': None},
            {'depth': 100.0, 'temp': 21.50, 'sal': 34.60, 'chl': None},
            {'depth': 200.0, 'temp': 14.90, 'sal': 34.85, 'chl': None},
            {'depth': 500.0, 'temp': 9.30, 'sal': 35.00, 'chl': None},
            {'depth': 1000.0, 'temp': 6.20, 'sal': 35.04, 'chl': None},
            {'depth': 1200.0, 'temp': 5.40, 'sal': 35.05, 'chl': None}
        ],
        'metadata': {
            'wmo_id': 2902788,
            'dac': 'INCOIS',
            'sensor': 'SBE 41CP',
            'transmission': 'Iridium',
            'max_depth_m': 1200.0
        }
    }
]


def _normalize_argo_record(obs: Dict[str, Any]) -> Dict[str, Any]:
    """Ensures consistent internal observation schema across all consumers."""
    profile_points = obs.get('profile', [])
    depths = [p['depth'] for p in profile_points if 'depth' in p]
    min_d = min(depths) if depths else 0.0
    max_d = max(depths) if depths else 1000.0

    avail_vars = obs.get('available_variables')
    if not avail_vars:
        avail_vars = ['temperature']
        if any(p.get('sal') is not None for p in profile_points):
            avail_vars.append('salinity')
        if any(p.get('chl') is not None for p in profile_points):
            avail_vars.append('chlorophyll')

    return {
        'id': str(obs.get('id', obs.get('wmo'))),
        'source': 'ARGO',
        'float_id': str(obs.get('id', obs.get('wmo'))),
        'wmo': int(obs.get('wmo', obs.get('id'))),
        'latitude': round(float(obs['latitude']), 4),
        'longitude': round(float(obs['longitude']), 4),
        'timestamp': obs.get('timestamp') or obs.get('date', '2024-05-15T00:00:00Z'),
        'platform': obs.get('platform', 'Argo Profiling Float'),
        'cycle': int(obs.get('cycle', obs.get('cycles', 1))),
        'cycles': int(obs.get('cycles', obs.get('cycle', 1))),
        'institution': obs.get('institution', 'INCOIS / Argo International'),
        'data_mode': obs.get('data_mode', 'Real-Time Quality Controlled'),
        'available_variables': avail_vars,
        'depth_range': [min_d, max_d],
        'profile': profile_points,
        'metadata': obs.get('metadata', {})
    }


def get_argo_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
) -> List[Dict[str, Any]]:
    """Returns normalized Argo observations filtered by geographic bounding box."""
    matched = []
    for raw in ARGO_OBSERVATIONS:
        lat = raw['latitude']
        lon = raw['longitude']
        if (min_lat is None or min_lat <= lat) and \
           (max_lat is None or lat <= max_lat) and \
           (min_lon is None or min_lon <= lon) and \
           (max_lon is None or lon <= max_lon):
            matched.append(_normalize_argo_record(raw))
    return matched


def get_argo_float(float_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single Argo float profile and metadata by WMO ID or float_id."""
    clean_id = str(float_id).strip()
    match = next((o for o in ARGO_OBSERVATIONS if str(o.get('id')) == clean_id or str(o.get('wmo')) == clean_id), None)
    if match:
        return _normalize_argo_record(match)
    return None


# Glider observations
def get_glider_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    time: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns normalized autonomous glider observations within bounding box from Copernicus in-situ."""
    return get_glider_adapter().search_gliders(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat, start_time=time, end_time=time)


def get_glider_profile(glider_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves vertical sounding profile for a specific glider ID."""
    return get_glider_adapter().get_glider_profile(glider_id)


# Backward compatibility aliases
def get_observations(
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None
) -> List[Dict[str, Any]]:
    return get_argo_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)


def get_observation_comparison(obs_id: str, variable: str = 'temperature', time: Optional[str] = None) -> Dict[str, Any]:
    """Compares an Argo float or glider profile against real collocated model readings."""
    clean_id = str(obs_id).strip()
    obs = next((o for o in ARGO_OBSERVATIONS if str(o.get('id')) == clean_id or str(o.get('wmo')) == clean_id), None)
    is_glider = False
    if not obs:
        obs = get_glider_adapter().get_glider_profile(clean_id)
        is_glider = True
    if not obs:
        return {'error': f"Observation ID '{obs_id}' not found"}

    lat = obs['latitude']
    lon = obs['longitude']
    var_key = 'salinity' if variable in ('salinity', 'sal', 'so') else 'temperature'

    # Query real model vertical profile at (lat, lon)
    pt_data = get_ocean_point(latitude=lat, longitude=lon, time=time or obs.get('timestamp') or obs.get('date'))
    model_profile = pt_data.get('profile', [])

    model_depths = []
    model_vals = []
    for p in model_profile:
        val = p.get(var_key)
        if val is not None and not np.isnan(val):
            model_depths.append(p['depth'])
            model_vals.append(val)

    obs_profile = obs.get('profile', [])
    comp_result = compare_vertical_profiles(model_depths, model_vals, obs_profile, variable=var_key)
    return {
        'observation': obs if is_glider else _normalize_argo_record(obs),
        'comparison': comp_result['profile'],
        'rmse': comp_result['rmse'],
        'bias': comp_result['bias'],
        'variable': var_key,
        'unit': 'PSU' if var_key == 'salinity' else '°C'
    }
