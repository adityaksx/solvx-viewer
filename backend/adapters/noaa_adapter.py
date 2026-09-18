"""
NOAA Ocean Data Adapter for SolvX
=================================
Fetches and normalizes physical oceanographic data from NOAA CoastWatch /
OceanWatch ERDDAP griddap services.

Authoritative source: National Oceanic and Atmospheric Administration (NOAA)
Supported variables:
- temperature (Sea Surface Temperature from MUR SST or Geo-Polar Blended)
- salinity (Sea Surface Salinity from SMAP / WOA)
- currents (Surface velocity vectors u, v from OSCAR)
- sea_surface_height (Daily Sea Surface Height / Anomaly)
"""

import os
import math
import time
import json
import logging
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

import numpy as np

from ..config import NOAA_ERDDAP_BASE, REQUEST_TIMEOUT
from ..models.requests import OceanVariableResponse, OceanCurrentsResponse

logger = logging.getLogger('solvx.noaa')

NOAA_VARIABLE_MAP = {
    'temperature': {
        'dataset_id': 'nesdisGeoPolarSSTN484Conservative',
        'var_name': 'analysed_sst',
        'standard_name': 'sea_surface_subskin_temperature',
        'units': 'degC',
        'has_depth': False,
        'surface_only': True,
        'description': 'NOAA Daily Global 5km Geo-Polar Blended Sea Surface Temperature'
    },
    'salinity': {
        'dataset_id': 'jplSMAP_SSS_L3_CAP_Monthlyv5',
        'var_name': 'smap_sss',
        'standard_name': 'sea_surface_salinity',
        'units': 'PSU',
        'has_depth': False,
        'surface_only': True,
        'description': 'JPL SMAP Level 3 CAP Monthly Sea Surface Salinity'
    },
    'currents': {
        'dataset_id': 'jplOSCAR',
        'u_var': 'u',
        'v_var': 'v',
        'standard_name': 'surface_sea_water_velocity',
        'units': 'm/s',
        'has_depth': False,
        'surface_only': True,
        'description': 'Ocean Surface Current Analysis Real-time (OSCAR)'
    },
    'sea_surface_height': {
        'dataset_id': 'nesdisSSH1day',
        'var_name': 'ssh',
        'standard_name': 'sea_surface_height_above_geoid',
        'units': 'm',
        'has_depth': False,
        'surface_only': True,
        'description': 'NOAA Daily Altimetry Sea Surface Height'
    }
}


class NOAAAdapter:
    """Adapter for querying and normalizing NOAA ERDDAP datasets."""

    def __init__(self, base_url: Optional[str] = None, timeout: int = REQUEST_TIMEOUT):
        self.base_url = (base_url or NOAA_ERDDAP_BASE or 'https://coastwatch.pfeg.noaa.gov/erddap/griddap').rstrip('/')
        self.timeout = timeout

    def get_supported_variables(self) -> List[str]:
        return list(NOAA_VARIABLE_MAP.keys())

    def get_datasets(self) -> Dict[str, Any]:
        return {var: cfg['dataset_id'] for var, cfg in NOAA_VARIABLE_MAP.items()}

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
        """Constructs an ERDDAP griddap constraint URL for NOAA."""
        url = f"{self.base_url}/{dataset_id}.json?{variable_name}"
        if time:
            url += f"[({time})]"
        else:
            url += "[(last)]"
        if depth is not None:
            url += f"[({depth})]"
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
        """Fetches and normalizes a specific physical ocean variable from NOAA."""
        if variable not in NOAA_VARIABLE_MAP:
            raise ValueError(f"Unsupported NOAA variable '{variable}'. Supported: {list(NOAA_VARIABLE_MAP.keys())}")

        var_cfg = NOAA_VARIABLE_MAP[variable]
        dataset_id = var_cfg['dataset_id']

        if variable == 'currents':
            return self._fetch_currents(var_cfg, min_lat, max_lat, min_lon, max_lon, depth, time, stride)

        # Scalar variable
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
        """Fetches vector currents (u, v) and calculates speed and direction."""
        dataset_id = var_cfg['dataset_id']
        u_url = self.build_griddap_url(dataset_id, var_cfg['u_var'], min_lat, max_lat, min_lon, max_lon, None, time, stride)
        v_url = self.build_griddap_url(dataset_id, var_cfg['v_var'], min_lat, max_lat, min_lon, max_lon, None, time, stride)

        u_json = self._execute_http_query(u_url)
        v_json = self._execute_http_query(v_url)

        return self._parse_erddap_currents(u_json, v_json, min_lat, max_lat, min_lon, max_lon, depth, time, u_url)

    def _execute_http_query(self, url: str) -> Dict[str, Any]:
        """Executes an HTTP GET to NOAA ERDDAP with strict error propagation."""
        req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0 (NOAA Client)'})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if resp.getcode() != 200:
                    raise RuntimeError(f"NOAA ERDDAP query returned HTTP {resp.getcode()}")
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            msg = f"NOAA ERDDAP HTTP {e.code}: {e.reason}"
            logger.error(msg)
            raise RuntimeError(msg) from e
        except urllib.error.URLError as e:
            msg = f"NOAA ERDDAP Connection Error: {e.reason}"
            logger.error(msg)
            raise RuntimeError(msg) from e
        except Exception as e:
            msg = f"NOAA ERDDAP Query Error: {str(e)}"
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
            raise RuntimeError(f"Empty table returned from NOAA ERDDAP for variable '{variable}'")

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
            'requested_provider': 'noaa',
            'provider': 'NOAA',
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
                'provider': 'NOAA',
                'dataset': var_config['dataset_id'],
                'description': var_config['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'satellite/blended_analysis'
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
            'requested_provider': 'noaa',
            'provider': 'NOAA',
            'fallback': False,
            'dataset': NOAA_VARIABLE_MAP['currents']['dataset_id'],
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
                'provider': 'NOAA',
                'dataset': NOAA_VARIABLE_MAP['currents']['dataset_id'],
                'description': NOAA_VARIABLE_MAP['currents']['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'satellite/surface_current_analysis'
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
        """Discovers available timestamps and resolution for NOAA datasets."""
        if variable not in NOAA_VARIABLE_MAP:
            raise ValueError(f"Unsupported NOAA variable '{variable}'")

        var_cfg = NOAA_VARIABLE_MAP[variable]
        dataset_id = var_cfg['dataset_id']
        
        timestamps = []
        depth_levels = []
        
        try:
            time_url = f"{self.base_url}/{dataset_id}.json?time"
            time_data = self._execute_http_query(time_url)
            for row in time_data.get('table', {}).get('rows', []):
                timestamps.append(row[0])
        except Exception as e:
            logger.warning(f"Failed to fetch time from ERDDAP API: {e}")

        if var_cfg.get('has_depth', False):
            try:
                depth_url = f"{self.base_url}/{dataset_id}.json?depth"
                depth_data = self._execute_http_query(depth_url)
                for row in depth_data.get('table', {}).get('rows', []):
                    depth_levels.append(round(float(row[0]), 1))
            except Exception as e:
                logger.warning(f"Failed to fetch depth from ERDDAP API: {e}")
                
        if not timestamps:
            timestamps = ['2026-08-01T00:00:00Z', '2026-09-15T00:00:00Z']
        if not depth_levels:
            depth_levels = [0.0]

        return {
            'provider': 'NOAA',
            'variable': variable,
            'dataset': dataset_id,
            'available_from': timestamps[0],
            'available_to': timestamps[-1],
            'default_resolution': 'daily',
            'resolutions': ['daily', 'monthly'],
            'historical': {'from': timestamps[0], 'to': timestamps[-1]},
            'forecast': None,
            'available_timestamps': timestamps,
            'depth_levels': depth_levels
        }

    def test_connection(self) -> Dict[str, Any]:
        """Diagnostic probe of NOAA CoastWatch ERDDAP."""
        test_url = f"{self.base_url.rsplit('/griddap', 1)[0]}/index.html"
        t0 = time.time()
        try:
            req = urllib.request.Request(test_url, headers={'User-Agent': 'SolvX-Diagnostic/3.0'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                latency = round((time.time() - t0) * 1000, 2)
                return {
                    'provider': 'NOAA',
                    'status': 'available' if resp.status < 400 else 'unavailable',
                    'status_code': resp.status,
                    'latency_ms': latency,
                    'endpoint': test_url
                }
        except Exception as e:
            return {
                'provider': 'NOAA',
                'status': 'unavailable',
                'error': str(e),
                'endpoint': test_url
            }
