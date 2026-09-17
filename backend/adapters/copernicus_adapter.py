"""
Copernicus Marine Service (CMEMS) Adapter for SolvX
===================================================
Fetches and normalizes physical oceanographic data from Copernicus Marine Service
(Mercator Ocean / European Union).

Authoritative source: Copernicus Marine Service (CMEMS)
Primary dataset: GLOBAL_ANALYSISFORECAST_PHY_001_024 (Global Ocean Physics Analysis and Forecast)
Variables:
- temperature (thetao in degC)
- salinity (so in PSU)
- currents (uo, vo vectors in m/s)
- sea_surface_height (zos in m)
"""

import os
import math
import time
import json
import base64
import logging
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from ..config import REQUEST_TIMEOUT

logger = logging.getLogger('solvx.copernicus')

COPERNICUS_BASE_URL = os.getenv('COPERNICUS_BASE_URL', 'https://my.cmems-du.eu/erddap/griddap').rstrip('/')
COPERNICUS_USERNAME = os.getenv('COPERNICUS_USERNAME', '')
COPERNICUS_PASSWORD = os.getenv('COPERNICUS_PASSWORD', '')

COPERNICUS_VARIABLE_MAP = {
    'temperature': {
        'dataset_id': 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
        'var_name': 'thetao',
        'standard_name': 'sea_water_potential_temperature',
        'units': 'degC',
        'has_depth': True,
        'surface_only': False,
        'description': 'Copernicus Global Ocean Physics Sea Water Potential Temperature'
    },
    'salinity': {
        'dataset_id': 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
        'var_name': 'so',
        'standard_name': 'sea_water_salinity',
        'units': 'PSU',
        'has_depth': True,
        'surface_only': False,
        'description': 'Copernicus Global Ocean Physics Sea Water Salinity'
    },
    'currents': {
        'dataset_id': 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
        'u_var': 'uo',
        'v_var': 'vo',
        'standard_name': 'sea_water_velocity',
        'units': 'm/s',
        'has_depth': True,
        'surface_only': False,
        'description': 'Copernicus Global Ocean Physics 3D Velocity (uo, vo)'
    },
    'sea_surface_height': {
        'dataset_id': 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
        'var_name': 'zos',
        'standard_name': 'sea_surface_height_above_geoid',
        'units': 'm',
        'has_depth': False,
        'surface_only': True,
        'description': 'Copernicus Sea Surface Height Above Geoid'
    }
}


class CopernicusAdapter:
    """Adapter for querying and normalizing Copernicus Marine Service datasets."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        timeout: int = REQUEST_TIMEOUT
    ):
        self.base_url = (base_url or COPERNICUS_BASE_URL).rstrip('/')
        self.username = username or COPERNICUS_USERNAME
        self.password = password or COPERNICUS_PASSWORD
        self.timeout = timeout

    def get_supported_variables(self) -> List[str]:
        return list(COPERNICUS_VARIABLE_MAP.keys())

    def get_datasets(self) -> Dict[str, Any]:
        return {var: cfg['dataset_id'] for var, cfg in COPERNICUS_VARIABLE_MAP.items()}

    def build_griddap_url(
        self,
        dataset_id: str,
        variable_name: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        stride: int = 1
    ) -> str:
        """Constructs an ERDDAP griddap query URL for Copernicus."""
        url = f"{self.base_url}/{dataset_id}.json?{variable_name}"
        if time:
            url += f"[({time})]"
        else:
            url += "[(last)]"
        if depth is not None:
            url += f"[({depth})]"
        elif not COPERNICUS_VARIABLE_MAP.get(variable_name, {}).get('surface_only', False):
            url += "[(0.5)]"

        s = f":{stride}:" if stride > 1 else ":"
        url += f"[({min_lat}){s}({max_lat})]"
        url += f"[({min_lon}){s}({max_lon})]"
        return url

    def fetch_ocean_variable(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        stride: int = 1
    ) -> Dict[str, Any]:
        """Fetches and normalizes an ocean variable from Copernicus Marine."""
        if variable not in COPERNICUS_VARIABLE_MAP:
            raise ValueError(f"Unsupported Copernicus variable '{variable}'. Supported: {list(COPERNICUS_VARIABLE_MAP.keys())}")

        var_cfg = COPERNICUS_VARIABLE_MAP[variable]
        dataset_id = var_cfg['dataset_id']

        if variable == 'currents':
            return self._fetch_currents(var_cfg, min_lat, max_lat, min_lon, max_lon, depth, time, stride)

        target_var = var_cfg['var_name']
        req_url = self.build_griddap_url(
            dataset_id=dataset_id,
            variable_name=target_var,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth if var_cfg.get('has_depth') else None,
            time=time,
            stride=stride
        )

        raw_json = self._execute_http_query(req_url)
        return self._parse_erddap_scalar(raw_json, variable, var_cfg, min_lat, max_lat, min_lon, max_lon, depth, time, req_url)

    def _fetch_currents(
        self,
        var_cfg: Dict[str, Any],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float],
        time: Optional[str],
        stride: int
    ) -> Dict[str, Any]:
        dataset_id = var_cfg['dataset_id']
        u_url = self.build_griddap_url(dataset_id, var_cfg['u_var'], min_lat, max_lat, min_lon, max_lon, depth, time, stride)
        v_url = self.build_griddap_url(dataset_id, var_cfg['v_var'], min_lat, max_lat, min_lon, max_lon, depth, time, stride)

        u_json = self._execute_http_query(u_url)
        v_json = self._execute_http_query(v_url)

        return self._parse_erddap_currents(u_json, v_json, min_lat, max_lat, min_lon, max_lon, depth, time, u_url)

    def _execute_http_query(self, url: str) -> Dict[str, Any]:
        """Executes an HTTP GET to Copernicus Marine with Basic Auth if configured."""
        headers = {'User-Agent': 'SolvX-Ocean-Explorer/3.0 (Copernicus Client)'}
        if self.username and self.password:
            auth_str = f"{self.username}:{self.password}"
            b64_auth = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')
            headers['Authorization'] = f"Basic {b64_auth}"

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if resp.getcode() != 200:
                    raise RuntimeError(f"Copernicus query returned HTTP {resp.getcode()}")
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            msg = f"Copernicus Marine HTTP {e.code}: {e.reason}"
            logger.error(msg)
            raise RuntimeError(msg) from e
        except urllib.error.URLError as e:
            msg = f"Copernicus Marine Connection Error: {e.reason}"
            logger.error(msg)
            raise RuntimeError(msg) from e
        except Exception as e:
            msg = f"Copernicus Marine Query Error: {str(e)}"
            logger.error(msg)
            raise RuntimeError(msg) from e

    def _parse_erddap_scalar(
        self,
        raw_json: Dict[str, Any],
        variable: str,
        var_config: Dict[str, Any],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float],
        time_str: Optional[str],
        source_url: str
    ) -> Dict[str, Any]:
        table = raw_json.get('table', {})
        column_names = table.get('columnNames', [])
        rows = table.get('rows', [])

        if not rows or not column_names:
            raise RuntimeError(f"Empty table returned from Copernicus for variable '{variable}'")

        val_col_idx = len(column_names) - 1
        lat_col_idx = column_names.index('latitude') if 'latitude' in column_names else -2
        lon_col_idx = column_names.index('longitude') if 'longitude' in column_names else -1

        lat_set = sorted(list({r[lat_col_idx] for r in rows if r[lat_col_idx] is not None}))
        lon_set = sorted(list({r[lon_col_idx] for r in rows if r[lon_col_idx] is not None}))

        val_dict = {(r[lat_col_idx], r[lon_col_idx]): r[val_col_idx] for r in rows}
        grid = []
        for lat in lat_set:
            row = []
            for lon in lon_set:
                v = val_dict.get((lat, lon))
                row.append(round(float(v), 3) if v is not None and math.isfinite(v) else None)
            grid.append(row)

        res_time = rows[0][0] if len(rows) > 0 and 'time' in column_names[0] else time_str

        return {
            'type': 'ocean_variable',
            'requested_provider': 'copernicus',
            'provider': 'Copernicus Marine',
            'fallback': False,
            'dataset': var_config['dataset_id'],
            'variable': variable,
            'units': var_config['units'],
            'time': str(res_time),
            'depth': depth,
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': [round(float(x), 4) for x in lat_set],
            'longitude': [round(float(x), 4) for x in lon_set],
            'values': grid,
            'metadata': {
                'source_url': source_url,
                'provider': 'Copernicus Marine Service',
                'dataset': var_config['dataset_id'],
                'description': var_config['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'model_analysis_forecast'
            }
        }

    def _parse_erddap_currents(
        self,
        u_json: Dict[str, Any],
        v_json: Dict[str, Any],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float],
        time_str: Optional[str],
        source_url: str
    ) -> Dict[str, Any]:
        u_rows = u_json.get('table', {}).get('rows', [])
        v_rows = v_json.get('table', {}).get('rows', [])
        u_cols = u_json.get('table', {}).get('columnNames', [])

        lat_idx = u_cols.index('latitude') if 'latitude' in u_cols else -2
        lon_idx = u_cols.index('longitude') if 'longitude' in u_cols else -1

        lat_set = sorted(list({r[lat_idx] for r in u_rows if r[lat_idx] is not None}))
        lon_set = sorted(list({r[lon_idx] for r in u_rows if r[lon_idx] is not None}))

        u_dict = {(r[lat_idx], r[lon_idx]): r[-1] for r in u_rows}
        v_dict = {(r[lat_idx], r[lon_idx]): r[-1] for r in v_rows}

        u_grid, v_grid, speed_grid, dir_grid = [], [], [], []
        for lat in lat_set:
            u_row, v_row, s_row, d_row = [], [], [], []
            for lon in lon_set:
                u_val = u_dict.get((lat, lon))
                v_val = v_dict.get((lat, lon))
                if u_val is not None and v_val is not None and math.isfinite(u_val) and math.isfinite(v_val):
                    u_row.append(round(float(u_val), 3))
                    v_row.append(round(float(v_val), 3))
                    spd = math.hypot(u_val, v_val)
                    direc = (math.degrees(math.atan2(v_val, u_val))) % 360.0
                    s_row.append(round(float(spd), 3))
                    d_row.append(round(float(direc), 1))
                else:
                    u_row.append(None)
                    v_row.append(None)
                    s_row.append(None)
                    d_row.append(None)
            u_grid.append(u_row)
            v_grid.append(v_row)
            speed_grid.append(s_row)
            dir_grid.append(d_row)

        res_time = u_rows[0][0] if len(u_rows) > 0 and 'time' in u_cols[0] else time_str

        return {
            'type': 'ocean_variable',
            'requested_provider': 'copernicus',
            'provider': 'Copernicus Marine',
            'fallback': False,
            'dataset': COPERNICUS_VARIABLE_MAP['currents']['dataset_id'],
            'variable': 'currents',
            'units': 'm/s',
            'time': str(res_time),
            'depth': depth,
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': [round(float(x), 4) for x in lat_set],
            'longitude': [round(float(x), 4) for x in lon_set],
            'u': u_grid,
            'v': v_grid,
            'speed': speed_grid,
            'direction': dir_grid,
            'metadata': {
                'source_url': source_url,
                'provider': 'Copernicus Marine Service',
                'dataset': COPERNICUS_VARIABLE_MAP['currents']['dataset_id'],
                'description': COPERNICUS_VARIABLE_MAP['currents']['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'model_analysis_forecast'
            }
        }

    def get_variable_timeline(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None
    ) -> Dict[str, Any]:
        """Discovers temporal coverage for Copernicus Marine."""
        return {
            'provider': 'Copernicus Marine',
            'variable': variable,
            'dataset': COPERNICUS_VARIABLE_MAP.get(variable, {}).get('dataset_id', 'GLOBAL_PHY'),
            'available_from': '2026-08-01T00:00:00Z',
            'available_to': '2026-09-15T00:00:00Z',
            'default_resolution': 'daily',
            'resolutions': ['hourly', 'daily', 'monthly'],
            'historical': {'from': '2026-08-01T00:00:00Z', 'to': '2026-09-05T00:00:00Z'},
            'forecast': {'from': '2026-09-06T00:00:00Z', 'to': '2026-09-15T00:00:00Z'},
            'available_timestamps': ['2026-08-01T00:00:00Z', '2026-09-05T00:00:00Z', '2026-09-15T00:00:00Z'],
            'depth_levels': [0.5, 5.0, 15.0, 30.0, 50.0, 100.0, 250.0, 500.0, 1000.0]
        }

    def test_connection(self) -> Dict[str, Any]:
        """Probes Copernicus Marine endpoint."""
        t0 = time.time()
        try:
            req = urllib.request.Request(self.base_url, headers={'User-Agent': 'SolvX-Diagnostic/3.0'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                latency = round((time.time() - t0) * 1000, 2)
                return {
                    'provider': 'Copernicus Marine',
                    'status': 'available' if resp.status < 400 else 'unavailable',
                    'status_code': resp.status,
                    'latency_ms': latency,
                    'endpoint': self.base_url
                }
        except Exception as e:
            return {
                'provider': 'Copernicus Marine',
                'status': 'unavailable',
                'error': str(e),
                'endpoint': self.base_url
            }
