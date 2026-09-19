import logging
import os
import base64
import uuid
from pathlib import Path
from typing import Dict, Any, Optional, List
import numpy as np

from ..services.cache_service import NETCDF_LOCK

logger = logging.getLogger('solvx.copernicus_adapter')

COPERNICUS_VARIABLE_CATALOG = {
    "ocean_temperature": {"dataset_id": "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m", "var": "thetao", "units": "°C", "is_3d": True},
    "temperature": {"dataset_id": "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m", "var": "thetao", "units": "°C", "is_3d": True},
    "salinity": {"dataset_id": "cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m", "var": "so", "units": "PSU", "is_3d": True},
    "currents": {"dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m", "vars": ["uo", "vo"], "units": "m/s", "is_vector": True, "is_3d": True},
    "current_u": {"dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m", "var": "uo", "units": "m/s", "is_3d": True},
    "current_v": {"dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m", "var": "vo", "units": "m/s", "is_3d": True},
    "sea_surface_height": {"dataset_id": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m", "var": "zos", "units": "m", "is_3d": False},
    "sea_level_anomaly": {"dataset_id": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m", "var": "zos", "units": "m", "is_3d": False},
    "mixed_layer_depth": {"dataset_id": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m", "var": "mlotst", "units": "m", "is_3d": False},
    "temperature_anomaly": {"dataset_id": "cmems_mod_glo_phy_anfc_0.083deg-sst-anomaly_P1D-m", "var": "sst_anomaly", "units": "°C", "is_3d": False},
    "chlorophyll": {"dataset_id": "cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m", "var": "chl", "units": "mg/m³", "is_3d": True},
    "dissolved_oxygen": {"dataset_id": "cmems_mod_glo_bgc-bio_anfc_0.25deg_P1D-m", "var": "o2", "units": "mmol/m³", "is_3d": True},
    "ph": {"dataset_id": "cmems_mod_glo_bgc-car_anfc_0.25deg_P1D-m", "var": "ph", "units": "pH", "is_3d": True},
    "nitrate": {"dataset_id": "cmems_mod_glo_bgc-nut_anfc_0.25deg_P1D-m", "var": "no3", "units": "mmol/m³", "is_3d": True},
    "phosphate": {"dataset_id": "cmems_mod_glo_bgc-nut_anfc_0.25deg_P1D-m", "var": "po4", "units": "mmol/m³", "is_3d": True}
}

COPERNICUS_VARIABLE_MAP = COPERNICUS_VARIABLE_CATALOG


def _to_naive_utc(ts):
    if ts is None:
        return None
    try:
        import pandas as pd
        p = pd.to_datetime(ts)
        if hasattr(p, 'tz') and p.tz is not None:
            p = p.tz_convert('UTC').tz_localize(None)
        return p
    except Exception:
        return None


class CopernicusAdapter:
    """Official Copernicus Marine Service (CMEMS) adapter with automatic credential discovery."""

    def __init__(self):
        self.username, self.password = self._discover_credentials()
        self.cache_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data/external/ocean'))
        os.makedirs(self.cache_dir, exist_ok=True)

    def _discover_credentials(self):
        u = os.getenv('COPERNICUSMARINE_SERVICE_USERNAME') or os.getenv('COPERNICUS_MARINE_SERVICE_USERNAME')
        p = os.getenv('COPERNICUSMARINE_SERVICE_PASSWORD') or os.getenv('COPERNICUS_MARINE_SERVICE_PASSWORD')
        if u and p:
            return u, p

        # Check .copernicusmarine/.copernicusmarine-credentials
        candidate_paths = [
            Path(__file__).resolve().parent.parent.parent / '.copernicusmarine' / '.copernicusmarine-credentials',
            Path.home() / '.copernicusmarine' / '.copernicusmarine-credentials'
        ]

        for cp in candidate_paths:
            if cp.exists():
                try:
                    raw = cp.read_text().strip()
                    if "username=" not in raw:
                        try:
                            raw = base64.b64decode(raw).decode('utf-8')
                        except Exception:
                            pass
                    for line in raw.splitlines():
                        line = line.strip()
                        if line.startswith('username='):
                            u = line.split('=', 1)[1].strip()
                        elif line.startswith('password='):
                            p = line.split('=', 1)[1].strip()
                    if u and p:
                        os.environ['COPERNICUSMARINE_SERVICE_USERNAME'] = u
                        os.environ['COPERNICUSMARINE_SERVICE_PASSWORD'] = p
                        logger.info("Discovered Copernicus credentials from %s (user: %s)", cp, u)
                        return u, p
                except Exception as e:
                    logger.debug("Failed parsing credentials file %s: %s", cp, e)

        return None, None

    def get_supported_variables(self) -> List[str]:
        return sorted(list(COPERNICUS_VARIABLE_CATALOG.keys()))

    def test_connection(self) -> Dict[str, Any]:
        if not self.username or not self.password:
            return {'provider': 'COPERNICUS', 'status': 'missing_credentials', 'message': 'Credentials not configured'}
        return {'provider': 'COPERNICUS', 'status': 'available', 'user': self.username}

    def find_cached_file(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        time: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None
    ) -> Optional[str]:
        """Finds any local NetCDF file in cache_dir that covers this variable, bbox, and target time range."""
        import glob
        import xarray as xr
        import pandas as pd

        norm_var = 'ocean_temperature' if variable in ('temperature', 'temp') else variable
        prefix = f"cmems_{norm_var}_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}"
        pattern = os.path.join(self.cache_dir, f"{prefix}*.nc")
        candidates = glob.glob(pattern)

        # If no direct prefix matches, also scan recent cmems_*.nc files for matching spatial coverage
        if not candidates:
            all_cmems = glob.glob(os.path.join(self.cache_dir, "cmems_*.nc"))
            all_cmems.sort(key=os.path.getmtime, reverse=True)
            for c in all_cmems[:35]:
                if os.path.getsize(c) == 0: continue
                try:
                    with xr.open_dataset(c) as ds:
                        if 'latitude' in ds.coords and 'longitude' in ds.coords:
                            ds_min_lat = float(ds.latitude.min())
                            ds_max_lat = float(ds.latitude.max())
                            ds_min_lon = float(ds.longitude.min())
                            ds_max_lon = float(ds.longitude.max())
                            if (ds_min_lat <= min_lat + 0.1 and ds_max_lat >= max_lat - 0.1 and
                                ds_min_lon <= min_lon + 0.1 and ds_max_lon >= max_lon - 0.1):
                                cfg = COPERNICUS_VARIABLE_CATALOG.get(norm_var, {})
                                var_match = cfg.get("var") or (cfg.get("vars", [None])[0])
                                if var_match and var_match in ds.data_vars:
                                    candidates.append(c)
                except Exception:
                    continue

        if not candidates:
            return None

        # Parse timestamps safely as naive UTC for uniform comparison
        t_start = _to_naive_utc(start_time)
        t_end = _to_naive_utc(end_time)
        t_req = _to_naive_utc(time)

        if not t_req and not t_start and not t_end:
            return candidates[0]

        # 1. If a full start_time to end_time range is specified, candidate must cover the entire range
        if t_start and t_end:
            for c in candidates:
                try:
                    with xr.open_dataset(c) as ds:
                        if 'time' in ds.coords and ds.time.size > 0:
                            t_min = _to_naive_utc(ds.time.values.min())
                            t_max = _to_naive_utc(ds.time.values.max())
                            if t_min and t_max:
                                if (t_min - pd.Timedelta(days=1)) <= t_start and t_end <= (t_max + pd.Timedelta(days=1)):
                                    return c
                except Exception:
                    continue
            if not t_req:
                return None

        # 2. Check candidate covering the specific requested time (if specified)
        if t_req:
            for c in candidates:
                try:
                    with xr.open_dataset(c) as ds:
                        if 'time' in ds.coords and ds.time.size > 0:
                            t_min = _to_naive_utc(ds.time.values.min())
                            t_max = _to_naive_utc(ds.time.values.max())
                            if t_min and t_max:
                                if (t_min - pd.Timedelta(days=1)) <= t_req <= (t_max + pd.Timedelta(days=1)):
                                    return c
                except Exception:
                    continue

        # 3. Single boundary fallback if only start or end was provided
        single_boundary = t_start or t_end
        if single_boundary:
            for c in candidates:
                try:
                    with xr.open_dataset(c) as ds:
                        if 'time' in ds.coords and ds.time.size > 0:
                            t_min = _to_naive_utc(ds.time.values.min())
                            t_max = _to_naive_utc(ds.time.values.max())
                            if t_min and t_max:
                                if (t_min - pd.Timedelta(days=1)) <= single_boundary <= (t_max + pd.Timedelta(days=1)):
                                    return c
                except Exception:
                    continue

        return candidates[0] if candidates and not (t_req or t_start or t_end) else None

    def fetch_ocean_variable(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        stride: int = 1
    ) -> Dict[str, Any]:
        """Fetches a normalized ocean variable slice or 3D volume from Copernicus Marine with full-timeline batch caching."""
        import hashlib
        from datetime import datetime, timezone, timedelta
        import xarray as xr
        import pandas as pd
        import copernicusmarine

        norm_var = 'ocean_temperature' if variable in ('temperature', 'temp') else variable
        if norm_var not in COPERNICUS_VARIABLE_CATALOG:
            raise ValueError(f"Variable '{variable}' not available in Copernicus catalog. Supported: {list(COPERNICUS_VARIABLE_CATALOG.keys())}")

        cfg = COPERNICUS_VARIABLE_CATALOG[norm_var]
        dataset_id = cfg["dataset_id"]
        vars_to_fetch = cfg.get("vars") or [cfg["var"]]
        is_vector = cfg.get("is_vector", False)
        is_3d = cfg.get("is_3d", False)
        units = cfg.get("units", "")

        min_depth = 0.5
        max_depth = 0.5
        if depth is not None and is_3d:
            d_val = float(depth)
            min_depth = max(0.5, d_val)
            max_depth = max(0.5, d_val)

        # 1. Check if an existing cached file already covers this region and requested time
        cached_nc = self.find_cached_file(norm_var, min_lat, max_lat, min_lon, max_lon, time=time, start_time=start_time, end_time=end_time)

        if cached_nc:
            out_nc = cached_nc
        else:
            # 2. Determine multi-day / full-year timeline range to download at once in a SINGLE NetCDF file
            now_dt = datetime.now(timezone.utc)
            if start_time and end_time:
                try:
                    s_clean = start_time.replace('Z', '+00:00') if 'Z' in start_time else start_time
                    e_clean = end_time.replace('Z', '+00:00') if 'Z' in end_time else end_time
                    dt_start = datetime.fromisoformat(s_clean)
                    dt_end = datetime.fromisoformat(e_clean)
                except Exception:
                    dt_end = now_dt
                    dt_start = now_dt - timedelta(days=365)
            elif time:
                try:
                    t_clean = time.replace('Z', '+00:00') if 'Z' in time else time
                    target_dt = datetime.fromisoformat(t_clean)
                    # Download generous 1-year timeline around or ending at latest date
                    dt_end = min(max(target_dt + timedelta(days=30), target_dt), now_dt)
                    dt_start = dt_end - timedelta(days=365)
                except Exception:
                    dt_end = now_dt
                    dt_start = now_dt - timedelta(days=365)
            else:
                dt_end = now_dt
                dt_start = now_dt - timedelta(days=365)

            start_dt = f"{dt_start.strftime('%Y-%m-%d')}T00:00:00"
            end_dt = f"{dt_end.strftime('%Y-%m-%d')}T23:59:59"

            fname = f"cmems_{norm_var}_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}_{dt_start.strftime('%Y%m%d')}_{dt_end.strftime('%Y%m%d')}.nc"
            out_nc = os.path.join(self.cache_dir, fname)

            with NETCDF_LOCK:
                if not os.path.exists(out_nc) or os.path.getsize(out_nc) == 0:
                    logger.info("Downloading full timeline Copernicus bundle: %s for %s (%s to %s)", dataset_id, vars_to_fetch, start_dt, end_dt)
                    tmp_filename = f"tmp_{uuid.uuid4().hex}_{os.path.basename(out_nc)}"
                    tmp_path = os.path.join(self.cache_dir, tmp_filename)
                    try:
                        copernicusmarine.subset(
                            dataset_id=dataset_id,
                            username=self.username,
                            password=self.password,
                            variables=vars_to_fetch,
                            minimum_longitude=min_lon,
                            maximum_longitude=max_lon,
                            minimum_latitude=min_lat,
                            maximum_latitude=max_lat,
                            minimum_depth=min_depth if is_3d else None,
                            maximum_depth=max_depth if is_3d else None,
                            start_datetime=start_dt,
                            end_datetime=end_dt,
                            output_directory=self.cache_dir,
                            output_filename=tmp_filename,
                            overwrite=True
                        )
                        if os.path.exists(tmp_path):
                            os.replace(tmp_path, out_nc)
                    except Exception as dl_err:
                        if os.path.exists(tmp_path):
                            try: os.remove(tmp_path)
                            except Exception: pass
                        raise dl_err

        # 3. Read dataset from local file & slice requested time
        with NETCDF_LOCK:
            with xr.open_dataset(out_nc) as ds:
                ds_loaded = ds.load()

        ds_slice = ds_loaded
        selected_time_str = time or datetime.now(timezone.utc).strftime('%Y-%m-%d')
        if 'time' in ds_slice.sizes and ds_slice.sizes['time'] > 1:
            if time:
                try:
                    t_req = _to_naive_utc(time)
                    ds_slice = ds_slice.sel(time=t_req, method='nearest')
                    if 'time' in ds_slice.coords:
                        selected_time_str = str(ds_slice.time.values)[:19] + 'Z'
                except Exception:
                    try:
                        ds_slice = ds_slice.sel(time=str(_to_naive_utc(time))[:19], method='nearest')
                    except Exception:
                        ds_slice = ds_slice.isel(time=-1)
            else:
                ds_slice = ds_slice.isel(time=-1)
        elif 'time' in ds_slice.sizes:
            ds_slice = ds_slice.isel(time=0)

        if 'depth' in ds_slice.coords and ds_slice.depth.ndim > 0 and ds_slice.depth.size > 0:
            if depth is not None and ds_slice.sizes.get('depth', 0) > 1:
                ds_slice = ds_slice.sel(depth=float(depth), method='nearest')
            else:
                ds_slice = ds_slice.isel(depth=0)

        lats = [float(x) for x in ds_slice.latitude.values]
        lons = [float(x) for x in ds_slice.longitude.values]

        # Apply stride if requested
        if stride > 1:
            lats = lats[::stride]
            lons = lons[::stride]

        if is_vector:
            # Currents u and v
            u_raw = ds_slice['uo'].values
            v_raw = ds_slice['vo'].values
            if stride > 1:
                u_raw = u_raw[::stride, ::stride]
                v_raw = v_raw[::stride, ::stride]

            u_grid = np.where(np.isnan(u_raw), 0.0, u_raw).tolist()
            v_grid = np.where(np.isnan(v_raw), 0.0, v_raw).tolist()

            speed_grid = []
            dir_grid = []
            for ru, rv in zip(u_grid, v_grid):
                s_row = []
                d_row = []
                for val_u, val_v in zip(ru, rv):
                    spd = float(np.sqrt(val_u**2 + val_v**2))
                    ang = float((np.degrees(np.arctan2(val_u, val_v)) + 360) % 360)
                    s_row.append(round(spd, 3))
                    d_row.append(round(ang, 1))
                speed_grid.append(s_row)
                dir_grid.append(d_row)

            return {
                'provider': 'COPERNICUS',
                'variable': 'currents',
                'dataset': dataset_id,
                'latitude': lats,
                'longitude': lons,
                'u': u_grid,
                'v': v_grid,
                'speed': speed_grid,
                'direction': dir_grid,
                'units': units,
                'metadata': {
                    'data_type': 'LOCAL_DISK_ARCHIVE' if cached_nc else 'LIVE_API',
                    'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'time': selected_time_str,
                    'depth_m': depth or 0.494
                }
            }
        else:
            var_name = vars_to_fetch[0]
            vals_raw = ds_slice[var_name].values
            if stride > 1:
                vals_raw = vals_raw[::stride, ::stride]

            vals_grid = np.where(np.isnan(vals_raw), None, vals_raw).tolist()

            # Calculate min and max
            valid_vals = vals_raw[~np.isnan(vals_raw)]
            val_min = float(valid_vals.min()) if len(valid_vals) > 0 else 0.0
            val_max = float(valid_vals.max()) if len(valid_vals) > 0 else 1.0

            return {
                'provider': 'COPERNICUS',
                'variable': norm_var,
                'dataset': dataset_id,
                'latitude': lats,
                'longitude': lons,
                'values': vals_grid,
                'units': units,
                'min_val': round(val_min, 3),
                'max_val': round(val_max, 3),
                'metadata': {
                    'data_type': 'LOCAL_DISK_ARCHIVE' if cached_nc else 'LIVE_API',
                    'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'time': selected_time_str,
                    'depth_m': depth or 0.494
                }
            }

    def is_variable_cached(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None
    ) -> bool:
        """Determines if the requested variable subset is already cached locally on disk."""
        norm_var = 'ocean_temperature' if variable in ('temperature', 'temp') else variable
        if norm_var not in COPERNICUS_VARIABLE_CATALOG:
            return False
        cached = self.find_cached_file(norm_var, min_lat, max_lat, min_lon, max_lon, time=time, start_time=start_time, end_time=end_time)
        return cached is not None


    def fetch_ocean_point(self, lat: float, lon: float, start_time: Optional[str] = None, end_time: Optional[str] = None) -> Dict[str, Any]:
        """Inspects physical ocean variables at a specific geographic point using local data or cached NetCDF files."""
        from datetime import datetime, timezone
        from ..services.ocean_data_service import get_ocean_point

        time_str = start_time[:10] if start_time else datetime.now(timezone.utc).strftime('%Y-%m-%d')

        point_data = {
            "timestamp": f"{time_str}T12:00:00Z",
            "latitude": lat,
            "longitude": lon,
            "ocean_temperature": None,
            "salinity": None,
            "current_u": None,
            "current_v": None,
            "sea_surface_height": None
        }

        # 1. Primary fast lookup: Check local model (Bay of Bengal / local archive)
        try:
            local_res = get_ocean_point(lat, lon, time=start_time)
            for item in local_res.get('values', []):
                vid = item.get('id')
                val = item.get('value')
                if val is not None:
                    if vid == 'temperature':
                        point_data["ocean_temperature"] = round(float(val), 2)
                    elif vid == 'salinity':
                        point_data["salinity"] = round(float(val), 2)
                    elif vid in ('sea_level', 'sea_surface_height'):
                        point_data["sea_surface_height"] = round(float(val), 3)
                    elif vid == 'currents' and isinstance(val, dict):
                        point_data["current_u"] = round(float(val.get('uo', val.get('u', 0.0))), 3)
                        point_data["current_v"] = round(float(val.get('vo', val.get('v', 0.0))), 3)
        except Exception as e:
            logger.debug("Local get_ocean_point failed for (%.2f, %.2f): %s", lat, lon, e)

        # 2. If any variables still missing, search cached cmems_*.nc files in self.cache_dir
        if any(v is None for v in [point_data["ocean_temperature"], point_data["salinity"], point_data["sea_surface_height"]]):
            try:
                import glob
                import xarray as xr
                cached_files = glob.glob(os.path.join(self.cache_dir, "cmems_*.nc"))
                for cf in cached_files[-30:]:
                    try:
                        with xr.open_dataset(cf) as ds:
                            if 'latitude' in ds.coords and 'longitude' in ds.coords:
                                min_la = float(ds.latitude.min())
                                max_la = float(ds.latitude.max())
                                min_lo = float(ds.longitude.min())
                                max_lo = float(ds.longitude.max())
                                if min_la <= lat <= max_la and min_lo <= lon <= max_lo:
                                    p_ds = ds.sel(latitude=lat, longitude=lon, method='nearest')
                                    if 'depth' in p_ds.coords: p_ds = p_ds.isel(depth=0)
                                    if 'time' in p_ds.dims: p_ds = p_ds.isel(time=0)
                                    if 'thetao' in p_ds.data_vars and point_data["ocean_temperature"] is None:
                                        v = float(p_ds['thetao'].values)
                                        if np.isfinite(v): point_data["ocean_temperature"] = round(v, 2)
                                    if 'so' in p_ds.data_vars and point_data["salinity"] is None:
                                        v = float(p_ds['so'].values)
                                        if np.isfinite(v): point_data["salinity"] = round(v, 2)
                                    if 'zos' in p_ds.data_vars and point_data["sea_surface_height"] is None:
                                        v = float(p_ds['zos'].values)
                                        if np.isfinite(v): point_data["sea_surface_height"] = round(v, 3)
                                    if 'uo' in p_ds.data_vars and point_data["current_u"] is None:
                                        u = float(p_ds['uo'].values)
                                        v = float(p_ds['vo'].values)
                                        if np.isfinite(u): point_data["current_u"] = round(u, 3)
                                        if np.isfinite(v): point_data["current_v"] = round(v, 3)
                    except Exception:
                        continue
            except Exception as e:
                logger.debug("Cache search for point failed: %s", e)

        return point_data

