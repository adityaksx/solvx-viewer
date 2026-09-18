import logging
import os
import copernicusmarine
import xarray as xr
from typing import Dict, Any, Optional

logger = logging.getLogger('solvx.copernicus_adapter')

class CopernicusAdapter:
    def __init__(self):
        self.username = os.getenv('COPERNICUSMARINE_SERVICE_USERNAME')
        self.password = os.getenv('COPERNICUSMARINE_SERVICE_PASSWORD')
        self.dataset_id = "cmems_mod_glo_phy_anfc_0.083deg_P1D-m"
        self.cache_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data/external/ocean'))
        os.makedirs(self.cache_dir, exist_ok=True)
        
    def _map_variable(self, solx_var: str) -> str:
        mapping = {
            "ocean_temperature": "thetao",
            "salinity": "so",
            "current_u": "uo",
            "current_v": "vo",
            "sea_surface_height": "zos"
        }
        return mapping.get(solx_var, solx_var)

    def fetch_ocean_grid(self, variable: str, min_lat: float, max_lat: float, min_lon: float, max_lon: float, start_time: str, end_time: str) -> Dict[str, Any]:
        if not self.username or not self.password:
            raise ValueError("Copernicus Marine credentials not configured.")
            
        cmems_var = self._map_variable(variable)
        
        # Simple cache key
        import hashlib
        key_str = f"{self.dataset_id}_{cmems_var}_{min_lat}_{max_lat}_{min_lon}_{max_lon}_{start_time}_{end_time}"
        cache_key = hashlib.md5(key_str.encode()).hexdigest()
        out_file = os.path.join(self.cache_dir, f"{cache_key}.nc")
        
        if not os.path.exists(out_file):
            logger.info(f"Downloading Copernicus subset to {out_file}")
            copernicusmarine.subset(
                dataset_id=self.dataset_id,
                variables=[cmems_var],
                minimum_longitude=min_lon,
                maximum_longitude=max_lon,
                minimum_latitude=min_lat,
                maximum_latitude=max_lat,
                start_datetime=start_time,
                end_datetime=end_time,
                minimum_depth=0.493,
                maximum_depth=0.495,
                output_filename=out_file,
                force_download=True,
                username=self.username,
                password=self.password
            )
            
        with xr.open_dataset(out_file) as ds:
            # We want to return the first time slice if multiple exist, or just the whole thing
            # The UI usually renders one time slice
            if 'time' in ds.dims:
                ds_t = ds.isel(time=0)
            else:
                ds_t = ds
            if 'depth' in ds_t.coords:
                ds_t = ds_t.isel(depth=0)
                
            lats = ds_t.latitude.values.tolist()
            lons = ds_t.longitude.values.tolist()
            # Convert NaN to None
            import numpy as np
            vals = np.where(np.isnan(ds_t[cmems_var].values), None, ds_t[cmems_var].values).tolist()
            
            return {
                "latitude": lats,
                "longitude": lons,
                "values": vals,
                "units": ds[cmems_var].attrs.get("units", "")
            }

    def fetch_ocean_point(self, lat: float, lon: float, start_time: str, end_time: str) -> Dict[str, Any]:
        """
        Fetches ocean variables from Copernicus Marine using the Python toolbox for a single point.
        """
        if not self.username or not self.password:
            raise ValueError("Copernicus Marine credentials not configured.")
            
        delta = 0.1
        min_lon, max_lon = lon - delta, lon + delta
        min_lat, max_lat = lat - delta, lat + delta
        
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id=self.dataset_id,
                username=self.username,
                password=self.password,
            )
            
            point_ds = ds.sel(latitude=lat, longitude=lon, method="nearest")
            if start_time and end_time:
                point_ds = point_ds.sel(time=slice(start_time, end_time))
            elif start_time:
                point_ds = point_ds.sel(time=start_time, method="nearest")
                
            if 'depth' in point_ds.coords:
                point_ds = point_ds.isel(depth=0)
                
            if 'time' in point_ds.dims:
                times = point_ds['time'].dt.strftime('%Y-%m-%dT%H:%M:%SZ').values.tolist()
            else:
                times = [str(point_ds['time'].values)]
            
            def get_var(name):
                if name in point_ds:
                    import numpy as np
                    vals = point_ds[name].values
                    if vals.ndim == 0:
                        vals = np.array([vals])
                    return [float(v) if np.isfinite(v) else None for v in vals]
                return [None] * len(times)
                
            # For a single point response we only return the latest or requested time slice for the popup
            return {
                "timestamp": times[0] if times else None,
                "latitude": float(point_ds.latitude.values),
                "longitude": float(point_ds.longitude.values),
                "ocean_temperature": get_var("thetao")[0],
                "salinity": get_var("so")[0],
                "current_u": get_var("uo")[0],
                "current_v": get_var("vo")[0],
                "sea_surface_height": get_var("zos")[0]
            }
            
        except Exception as e:
            logger.error(f"Copernicus fetch failed: {e}")
            raise RuntimeError(f"Ocean data unavailable: {e}")

