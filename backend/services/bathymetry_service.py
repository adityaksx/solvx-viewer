import json
from pathlib import Path
from typing import Dict, Any
import numpy as np
import xarray as xr

from ..config import DATA_DIR, BASE_DIR, MODEL_DATA_DIR, DEFAULT_BBOX, MAX_GRID_POINTS
from ..processing.coordinate_utils import project_xy
from .cache_service import GLOBAL_CACHE, make_cache_key, safe_open_dataset

FRONTEND_GEOM = BASE_DIR / 'frontend' / 'geometry.json'

def is_near_default(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> bool:
    b = DEFAULT_BBOX
    return (
        abs(min_lon - b['min_lon']) < 0.2 and
        abs(max_lon - b['max_lon']) < 0.2 and
        abs(min_lat - b['min_lat']) < 0.2 and
        abs(max_lat - b['max_lat']) < 0.2
    )

def extract_from_netcdf(ds: xr.Dataset, var_name: str, min_lon: float, max_lon: float, min_lat: float, max_lat: float):
    yd = 'latitude' if 'latitude' in ds.coords else 'lat'
    xd = 'longitude' if 'longitude' in ds.coords else 'lon'
    
    da = ds[var_name]
    lat_vals = da[yd].values
    lon_vals = da[xd].values

    # Determine slice direction
    lat_slice = slice(min_lat, max_lat) if lat_vals[0] <= lat_vals[-1] else slice(max_lat, min_lat)
    lon_slice = slice(min_lon, max_lon) if lon_vals[0] <= lon_vals[-1] else slice(max_lon, min_lon)

    sub = da.sel({yd: lat_slice, xd: lon_slice})
    if sub.size == 0:
        return None

    sub_lat = sub[yd].values
    sub_lon = sub[xd].values
    arr = sub.values.astype(np.float32)

    # Downsample if too dense
    if arr.size > MAX_GRID_POINTS:
        f = int(np.ceil(np.sqrt(arr.size / MAX_GRID_POINTS)))
        arr = arr[::f, ::f]
        sub_lat = sub_lat[::f]
        sub_lon = sub_lon[::f]

    # Convert elevation (negative is underwater) or depth (positive is underwater)
    if np.nanmin(arr) < 0 and np.nanmax(arr) <= 0:
        dep = -arr / 1000.0
    elif 'elev' in var_name.lower():
        dep = np.where(arr < 0, -arr / 1000.0, np.nan).astype(np.float32)
    else:
        dep = np.where(arr > 0, arr / 1000.0, np.nan).astype(np.float32)

    dep_json = [[None if not np.isfinite(v) or v <= 0 else round(float(v), 4) for v in row] for row in dep]
    xx, yy = project_xy(sub_lon, sub_lat, min_lon, max_lon, min_lat, max_lat)
    max_d = float(np.nanmax(dep)) if np.any(np.isfinite(dep)) else 3.5

    return {
        'x': [round(float(v), 3) for v in xx],
        'y': [round(float(v), 3) for v in yy],
        'rawDepthKm': dep_json,
        'maxDepthKm': round(max_d, 3)
    }

def generate_synthetic_bathymetry(min_lon: float, max_lon: float, min_lat: float, max_lat: float, nx=50, ny=45):
    """Generates physically plausible ocean basin bathymetry when external bathymetry data is unavailable."""
    lons = np.linspace(min_lon, max_lon, nx)
    lats = np.linspace(min_lat, max_lat, ny)
    xx, yy = project_xy(lons, lats, min_lon, max_lon, min_lat, max_lat)

    # Model an ocean basin bowl sloping down to abyssal depths (2.5 - 3.8 km)
    X, Y = np.meshgrid(np.linspace(-1, 1, nx), np.linspace(-1, 1, ny))
    dist = np.sqrt(X**2 + Y**2)
    depth_km = 0.5 + 3.0 * (1.0 - np.clip(dist * 0.7, 0.0, 1.0))
    depth_km = np.clip(depth_km, 0.1, 3.8)

    dep_json = [[round(float(v), 4) for v in row] for row in depth_km]

    return {
        'x': [round(float(v), 3) for v in xx],
        'y': [round(float(v), 3) for v in yy],
        'rawDepthKm': dep_json,
        'maxDepthKm': round(float(np.max(depth_km)), 3)
    }

def get_bathymetry_data(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> Dict[str, Any]:
    """Retrieves 3D bathymetric seabed grid for any requested bounding box."""
    cache_key = make_cache_key('bathymetry', {
        'min_lon': round(min_lon, 3),
        'max_lon': round(max_lon, 3),
        'min_lat': round(min_lat, 3),
        'max_lat': round(max_lat, 3)
    })
    cached = GLOBAL_CACHE.get(cache_key)
    if cached:
        return cached

    # 1. Check if near Bay of Bengal and geometry.json is present
    if is_near_default(min_lon, max_lon, min_lat, max_lat) and FRONTEND_GEOM.exists():
        try:
            with open(FRONTEND_GEOM, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'terrain' in data:
                    res = {
                        'bounds': data.get('bounds', [min_lon, max_lon, min_lat, max_lat]),
                        'terrain': data['terrain']
                    }
                    GLOBAL_CACHE.set(cache_key, res)
                    return res
        except Exception:
            pass

    # 2. Check local baymetry.nc
    baymetry_path = MODEL_DATA_DIR / 'baymetry.nc'
    if baymetry_path.exists():
        try:
            with safe_open_dataset(baymetry_path) as ds:
                t = extract_from_netcdf(ds, 'deptho', min_lon, max_lon, min_lat, max_lat)
                if t:
                    res = {'bounds': [min_lon, max_lon, min_lat, max_lat], 'terrain': t}
                    GLOBAL_CACHE.set(cache_key, res)
                    return res
        except Exception as e:
            print(f"Error reading baymetry.nc: {e}")

    # 3. Fallback to plausible basin terrain
    t = generate_synthetic_bathymetry(min_lon, max_lon, min_lat, max_lat)
    res = {'bounds': [min_lon, max_lon, min_lat, max_lat], 'terrain': t}
    GLOBAL_CACHE.set(cache_key, res)
    return res
