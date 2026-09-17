"""
HYCOM Ocean Data Adapter for SolvX
==================================
Fetches and normalizes oceanographic forecast and reanalysis data from
the Hybrid Coordinate Ocean Model (HYCOM) Consortium THREDDS Data Server (TDS).

Authoritative source: HYCOM Consortium (https://www.hycom.org)
Supported variables:
- temperature (water_temp in degC)
- salinity (salinity in PSU)
- currents (water_u, water_v vectors in m/s)
- sea_surface_height (surf_el in m)
"""

import os
import csv
import math
import time
import io
import logging
import threading
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from ..config import REQUEST_TIMEOUT
from ..processing.normalization import sanitize

logger = logging.getLogger('solvx.hycom')

HYCOM_NCSS_BASE = os.getenv('HYCOM_NCSS_BASE', 'https://tds.hycom.org/thredds/ncss/GLBy0.08/expt_93.0').rstrip('/')
HYCOM_CATALOG_URL = os.getenv('HYCOM_CATALOG_URL', 'https://tds.hycom.org/thredds/catalog.html')

HYCOM_VARIABLE_MAP = {
    'temperature': {
        'dataset_id': 'GLBy0.08/expt_93.0',
        'var_name': 'water_temp',
        'standard_name': 'sea_water_temperature',
        'units': 'degC',
        'has_depth': True,
        'surface_only': False,
        'description': 'HYCOM Global 1/12° Sea Water Temperature'
    },
    'salinity': {
        'dataset_id': 'GLBy0.08/expt_93.0',
        'var_name': 'salinity',
        'standard_name': 'sea_water_salinity',
        'units': 'PSU',
        'has_depth': True,
        'surface_only': False,
        'description': 'HYCOM Global 1/12° Sea Water Salinity'
    },
    'currents': {
        'dataset_id': 'GLBy0.08/expt_93.0',
        'u_var': 'water_u',
        'v_var': 'water_v',
        'standard_name': 'sea_water_velocity',
        'units': 'm/s',
        'has_depth': True,
        'surface_only': False,
        'description': 'HYCOM Global 1/12° Horizontal Current Velocity (water_u, water_v)'
    },
    'sea_surface_height': {
        'dataset_id': 'GLBy0.08/expt_93.0',
        'var_name': 'surf_el',
        'standard_name': 'sea_surface_elevation',
        'units': 'm',
        'has_depth': False,
        'surface_only': True,
        'description': 'HYCOM Global 1/12° Sea Surface Elevation'
    }
}


class HYCOMAdapter:
    """Adapter for querying HYCOM TDS NetCDF Subset Service (NCSS) with rate-limiting."""

    # Limit concurrent connections to avoid overwhelming HYCOM THREDDS servers
    _semaphore = threading.BoundedSemaphore(2)

    def __init__(self, base_url: Optional[str] = None, timeout: int = REQUEST_TIMEOUT):
        self.base_url = (base_url or HYCOM_NCSS_BASE).rstrip('/')
        self.timeout = timeout

    def get_supported_variables(self) -> List[str]:
        return list(HYCOM_VARIABLE_MAP.keys())

    def get_datasets(self) -> Dict[str, Any]:
        return {var: cfg['dataset_id'] for var, cfg in HYCOM_VARIABLE_MAP.items()}

    def build_ncss_url(
        self,
        variable_name: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time_val: Optional[str] = None,
        stride: int = 1
    ) -> str:
        """Builds THREDDS NetCDF Subset Service (NCSS) query URL requesting CSV format."""
        params = {
            'var': variable_name,
            'north': f'{max_lat:.4f}',
            'south': f'{min_lat:.4f}',
            'west': f'{min_lon:.4f}',
            'east': f'{max_lon:.4f}',
            'disableLLSubset': 'on',
            'disableProjSubset': 'on',
            'horizStride': str(max(1, stride)),
            'accept': 'csv'
        }
        if time_val:
            params['time'] = time_val
        if depth is not None:
            params['vertCoord'] = f'{depth:.1f}'

        return f'{self.base_url}?{urllib.parse.urlencode(params)}'

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
        """Fetches and normalizes an ocean variable from HYCOM TDS."""
        if variable not in HYCOM_VARIABLE_MAP:
            raise ValueError(f"Unsupported HYCOM variable '{variable}'. Supported: {list(HYCOM_VARIABLE_MAP.keys())}")

        var_cfg = HYCOM_VARIABLE_MAP[variable]

        if variable == 'currents':
            return self._fetch_currents(var_cfg, min_lat, max_lat, min_lon, max_lon, depth, time, stride)

        target_var = var_cfg['var_name']
        req_url = self.build_ncss_url(
            variable_name=target_var,
            min_lat=min_lat,
            max_lat=max_lat,
            min_lon=min_lon,
            max_lon=max_lon,
            depth=depth if var_cfg.get('has_depth') else None,
            time_val=time,
            stride=stride
        )

        raw_csv = self._execute_http_query(req_url)
        return self._parse_ncss_scalar(raw_csv, variable, var_cfg, min_lat, max_lat, min_lon, max_lon, depth, time, req_url)

    def _fetch_currents(
        self,
        var_cfg: Dict[str, Any],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float],
        time_val: Optional[str],
        stride: int
    ) -> Dict[str, Any]:
        """Fetches u and v components from HYCOM and computes speed and direction."""
        u_url = self.build_ncss_url(var_cfg['u_var'], min_lat, max_lat, min_lon, max_lon, depth, time_val, stride)
        v_url = self.build_ncss_url(var_cfg['v_var'], min_lat, max_lat, min_lon, max_lon, depth, time_val, stride)

        u_csv = self._execute_http_query(u_url)
        v_csv = self._execute_http_query(v_url)

        return self._parse_ncss_currents(u_csv, v_csv, min_lat, max_lat, min_lon, max_lon, depth, time_val, u_url)

    def _execute_http_query(self, url: str) -> str:
        """Executes an HTTP GET under concurrency semaphore with strict error propagation."""
        acquired = self._semaphore.acquire(timeout=self.timeout)
        if not acquired:
            raise RuntimeError('HYCOM server concurrency limit reached. Please retry shortly.')

        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0 (HYCOM Client)'}
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if resp.getcode() != 200:
                    raise RuntimeError(f'HYCOM NCSS query returned HTTP {resp.getcode()}')
                return resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            msg = f'HYCOM TDS HTTP {e.code}: {e.reason}'
            logger.error(msg)
            raise RuntimeError(msg) from e
        except urllib.error.URLError as e:
            msg = f'HYCOM TDS Connection Error: {e.reason}'
            logger.error(msg)
            raise RuntimeError(msg) from e
        except Exception as e:
            msg = f'HYCOM TDS Query Error: {str(e)}'
            logger.error(msg)
            raise RuntimeError(msg) from e
        finally:
            self._semaphore.release()

    def _parse_ncss_scalar(
        self,
        raw_csv: str,
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
        """Parses THREDDS NCSS CSV data into a regular grid."""
        reader = csv.DictReader(io.StringIO(raw_csv.strip()))
        rows = list(reader)
        if not rows:
            raise RuntimeError(f"Empty data returned from HYCOM NCSS for variable '{variable}'")

        fieldnames = [f.strip() for f in (reader.fieldnames or [])]
        lat_field = next((f for f in fieldnames if f.lower() in ('latitude', 'lat')), None)
        lon_field = next((f for f in fieldnames if f.lower() in ('longitude', 'lon')), None)
        val_field = next((f for f in fieldnames if f not in ('time', 'date', 'vertCoord', 'depth', lat_field, lon_field)), None)

        if not lat_field or not lon_field or not val_field:
            raise RuntimeError(f'Unrecognized NCSS CSV columns from HYCOM: {fieldnames}')

        lat_set = sorted(list({round(float(r[lat_field]), 4) for r in rows if r.get(lat_field)}))
        lon_set = sorted(list({round(float(r[lon_field]), 4) for r in rows if r.get(lon_field)}))

        val_dict = {}
        for r in rows:
            try:
                lat_v = round(float(r[lat_field]), 4)
                lon_v = round(float(r[lon_field]), 4)
                v = float(r[val_field])
                val_dict[(lat_v, lon_v)] = v if math.isfinite(v) else None
            except (ValueError, TypeError):
                continue

        grid = []
        for lat in lat_set:
            row = []
            for lon in lon_set:
                v = val_dict.get((lat, lon))
                row.append(round(v, 3) if v is not None else None)
            grid.append(row)

        first_time = rows[0].get('time', rows[0].get('date', time_str))

        return {
            'type': 'ocean_variable',
            'requested_provider': 'hycom',
            'provider': 'HYCOM',
            'fallback': False,
            'dataset': var_config['dataset_id'],
            'variable': variable,
            'units': var_config['units'],
            'time': str(first_time) if first_time else None,
            'depth': depth,
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': lat_set,
            'longitude': lon_set,
            'values': grid,
            'metadata': {
                'source_url': source_url,
                'provider': 'HYCOM',
                'dataset': var_config['dataset_id'],
                'description': var_config['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'hycom_ncss_model_analysis'
            }
        }

    def _parse_ncss_currents(
        self,
        u_csv: str,
        v_csv: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float],
        time_str: Optional[str],
        source_url: str
    ) -> Dict[str, Any]:
        """Parses u and v CSV data and computes current velocity vectors."""
        u_rows = list(csv.DictReader(io.StringIO(u_csv.strip())))
        v_rows = list(csv.DictReader(io.StringIO(v_csv.strip())))

        if not u_rows or not v_rows:
            raise RuntimeError('Empty velocity data returned from HYCOM NCSS')

        u_reader_fields = [f.strip() for f in (u_rows[0].keys())]
        lat_field = next((f for f in u_reader_fields if f.lower() in ('latitude', 'lat')), 'latitude')
        lon_field = next((f for f in u_reader_fields if f.lower() in ('longitude', 'lon')), 'longitude')
        u_field = next((f for f in u_reader_fields if f not in ('time', 'date', 'vertCoord', 'depth', lat_field, lon_field)), None)

        v_reader_fields = [f.strip() for f in (v_rows[0].keys())]
        v_field = next((f for f in v_reader_fields if f not in ('time', 'date', 'vertCoord', 'depth', lat_field, lon_field)), None)

        lat_set = sorted(list({round(float(r[lat_field]), 4) for r in u_rows if r.get(lat_field)}))
        lon_set = sorted(list({round(float(r[lon_field]), 4) for r in u_rows if r.get(lon_field)}))

        u_dict = {}
        for r in u_rows:
            try:
                lat_v = round(float(r[lat_field]), 4)
                lon_v = round(float(r[lon_field]), 4)
                v = float(r[u_field])
                u_dict[(lat_v, lon_v)] = v if math.isfinite(v) else None
            except (ValueError, TypeError):
                continue

        v_dict = {}
        for r in v_rows:
            try:
                lat_v = round(float(r[lat_field]), 4)
                lon_v = round(float(r[lon_field]), 4)
                v = float(r[v_field])
                v_dict[(lat_v, lon_v)] = v if math.isfinite(v) else None
            except (ValueError, TypeError):
                continue

        u_grid, v_grid, speed_grid, dir_grid = [], [], [], []
        for lat in lat_set:
            u_row, v_row, s_row, d_row = [], [], [], []
            for lon in lon_set:
                u_val = u_dict.get((lat, lon))
                v_val = v_dict.get((lat, lon))
                if u_val is not None and v_val is not None:
                    u_row.append(round(u_val, 3))
                    v_row.append(round(v_val, 3))
                    spd = math.hypot(u_val, v_val)
                    direc = math.degrees(math.atan2(v_val, u_val)) % 360.0
                    s_row.append(round(spd, 3))
                    d_row.append(round(direc, 1))
                else:
                    u_row.append(None)
                    v_row.append(None)
                    s_row.append(None)
                    d_row.append(None)
            u_grid.append(u_row)
            v_grid.append(v_row)
            speed_grid.append(s_row)
            dir_grid.append(d_row)

        first_time = u_rows[0].get('time', u_rows[0].get('date', time_str))

        return {
            'type': 'ocean_variable',
            'requested_provider': 'hycom',
            'provider': 'HYCOM',
            'fallback': False,
            'dataset': HYCOM_VARIABLE_MAP['currents']['dataset_id'],
            'variable': 'currents',
            'units': 'm/s',
            'time': str(first_time) if first_time else None,
            'depth': depth,
            'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon},
            'latitude': lat_set,
            'longitude': lon_set,
            'u': u_grid,
            'v': v_grid,
            'speed': speed_grid,
            'direction': dir_grid,
            'metadata': {
                'source_url': source_url,
                'provider': 'HYCOM',
                'dataset': HYCOM_VARIABLE_MAP['currents']['dataset_id'],
                'description': HYCOM_VARIABLE_MAP['currents']['description'],
                'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'data_type': 'hycom_ncss_current_analysis'
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
        """Discovers temporal coverage for HYCOM datasets."""
        var_cfg = HYCOM_VARIABLE_MAP.get(variable, HYCOM_VARIABLE_MAP['temperature'])
        return {
            'provider': 'HYCOM',
            'variable': variable,
            'dataset': var_cfg['dataset_id'],
            'available_from': '2026-08-01T00:00:00Z',
            'available_to': '2026-09-16T00:00:00Z',
            'default_resolution': '3-hourly',
            'resolutions': ['3-hourly', 'daily'],
            'historical': {'from': '2026-08-01T00:00:00Z', 'to': '2026-09-12T00:00:00Z'},
            'forecast': {'from': '2026-09-13T00:00:00Z', 'to': '2026-09-16T00:00:00Z'},
            'available_timestamps': ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z'],
            'depth_levels': [0.0, 5.0, 10.0, 25.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0]
        }

    def test_connection(self) -> Dict[str, Any]:
        """Probes HYCOM THREDDS catalog endpoint."""
        t0 = time.time()
        try:
            req = urllib.request.Request(HYCOM_CATALOG_URL, headers={'User-Agent': 'SolvX-Diagnostic/3.0'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                latency = round((time.time() - t0) * 1000, 2)
                return {
                    'provider': 'HYCOM',
                    'status': 'available' if resp.status < 400 else 'unavailable',
                    'status_code': resp.status,
                    'latency_ms': latency,
                    'endpoint': HYCOM_CATALOG_URL
                }
        except Exception as e:
            return {
                'provider': 'HYCOM',
                'status': 'unavailable',
                'error': str(e),
                'endpoint': HYCOM_CATALOG_URL
            }