import logging
import os
import base64
from pathlib import Path
from typing import Dict, Any, Optional, List
import numpy as np

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
        """Fetches a normalized ocean variable slice or 3D volume from Copernicus Marine."""
        import hashlib
        from datetime import datetime, timezone
        import xarray as xr
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

        # Format date for subset
        if time:
            t_clean = time.replace('Z', '+00:00') if 'Z' in time else time
            try:
                dt = datetime.fromisoformat(t_clean)
                time_str = dt.strftime('%Y-%m-%d')
            except Exception:
                time_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        else:
            time_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

        start_dt = f"{time_str}T00:00:00"
        end_dt = f"{time_str}T23:59:59"

        # Handle depth range
        min_depth = 0.5
        max_depth = 0.5
        if depth is not None and is_3d:
            d_val = float(depth)
            min_depth = max(0.5, d_val)
            max_depth = max(0.5, d_val)

        # Cache key
        cache_seed = f"{dataset_id}_{','.join(vars_to_fetch)}_{min_lat:.3f}_{max_lat:.3f}_{min_lon:.3f}_{max_lon:.3f}_{min_depth}_{max_depth}_{time_str}"
        cache_hash = hashlib.md5(cache_seed.encode()).hexdigest()
        out_nc = os.path.join(self.cache_dir, f"cmems_{cache_hash}.nc")

        if not os.path.exists(out_nc):
            logger.info("Downloading Copernicus subset: %s for %s (%s)", dataset_id, vars_to_fetch, time_str)
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
                output_filename=os.path.basename(out_nc),
                overwrite=True
            )

        with xr.open_dataset(out_nc) as ds:
            # Squeeze time and depth
            ds_slice = ds
            if 'time' in ds_slice.dims:
                ds_slice = ds_slice.isel(time=0)
            if 'depth' in ds_slice.coords and ds_slice.depth.ndim > 0 and ds_slice.depth.size > 0:
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
                        'data_type': 'LIVE_API',
                        'retrieved_at': datetime.now(timezone.utc).isoformat(),
                        'time': time_str,
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
                        'data_type': 'LIVE_API',
                        'retrieved_at': datetime.now(timezone.utc).isoformat(),
                        'time': time_str,
                        'depth_m': depth or 0.494
                    }
                }

    def fetch_ocean_point(self, lat: float, lon: float, start_time: Optional[str] = None, end_time: Optional[str] = None) -> Dict[str, Any]:
        """Inspects all physical ocean variables at a specific geographic point from Copernicus Marine."""
        from datetime import datetime, timezone
        import copernicusmarine

        time_str = start_time[:10] if start_time else datetime.now(timezone.utc).strftime('%Y-%m-%d')
        start_dt = f"{time_str}T00:00:00"
        end_dt = f"{time_str}T23:59:59"

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

        # Temperature
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id="cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m",
                username=self.username,
                password=self.password
            )
            p_ds = ds.sel(latitude=lat, longitude=lon, method="nearest")
            if 'depth' in p_ds.coords:
                p_ds = p_ds.isel(depth=0)
            if 'time' in p_ds.dims:
                p_ds = p_ds.isel(time=0)
            v = float(p_ds['thetao'].values)
            if np.isfinite(v):
                point_data["ocean_temperature"] = round(v, 2)
        except Exception as e:
            logger.debug("Point temperature fetch failed: %s", e)

        # Salinity
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id="cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m",
                username=self.username,
                password=self.password
            )
            p_ds = ds.sel(latitude=lat, longitude=lon, method="nearest")
            if 'depth' in p_ds.coords:
                p_ds = p_ds.isel(depth=0)
            if 'time' in p_ds.dims:
                p_ds = p_ds.isel(time=0)
            v = float(p_ds['so'].values)
            if np.isfinite(v):
                point_data["salinity"] = round(v, 2)
        except Exception as e:
            logger.debug("Point salinity fetch failed: %s", e)

        # Currents
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id="cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m",
                username=self.username,
                password=self.password
            )
            p_ds = ds.sel(latitude=lat, longitude=lon, method="nearest")
            if 'depth' in p_ds.coords:
                p_ds = p_ds.isel(depth=0)
            if 'time' in p_ds.dims:
                p_ds = p_ds.isel(time=0)
            u = float(p_ds['uo'].values)
            v = float(p_ds['vo'].values)
            if np.isfinite(u): point_data["current_u"] = round(u, 3)
            if np.isfinite(v): point_data["current_v"] = round(v, 3)
        except Exception as e:
            logger.debug("Point currents fetch failed: %s", e)

        # Sea surface height
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id="cmems_mod_glo_phy_anfc_0.083deg_P1D-m",
                username=self.username,
                password=self.password
            )
            p_ds = ds.sel(latitude=lat, longitude=lon, method="nearest")
            if 'time' in p_ds.dims:
                p_ds = p_ds.isel(time=0)
            z = float(p_ds['zos'].values)
            if np.isfinite(z): point_data["sea_surface_height"] = round(z, 3)
        except Exception as e:
            logger.debug("Point sea surface height fetch failed: %s", e)

        return point_data
