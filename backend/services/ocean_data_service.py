from pathlib import Path
from typing import Optional, Dict, Any, List
import numpy as np
import pandas as pd
import xarray as xr
from fastapi import HTTPException

from ..config import MODEL_DATA_DIR
from ..processing.normalization import sanitize, normalize_time_coordinate, variable_catalog
from ..processing.subset import subset_array, select_surface, select_time
from .cache_service import safe_open_dataset, NETCDF_LOCK

def get_nc_files() -> List[Path]:
    return sorted(MODEL_DATA_DIR.glob('*.nc'))

def find_file(filename: str) -> Path:
    p = MODEL_DATA_DIR / Path(filename).name
    if not p.exists() or p.suffix.lower() != '.nc':
        raise HTTPException(404, detail=f'NetCDF file not found: {Path(filename).name}')
    return p

def aliases(file_name: str, var_name: str) -> Optional[str]:
    text, var = f'{file_name} {var_name}'.lower(), var_name.lower()
    if 'temperature' in text and 'anomaly' not in text and 'anamoly' not in text:
        return 'temperature'
    if 'anamoly' in text or 'anomaly' in text:
        return 'temperature_anomaly'
    if 'salinity' in text:
        return 'salinity'
    if 'current' in text or var in {'uo', 'vo', 'u', 'v', 'uoce', 'voce', 'ucur', 'vcur'}:
        return 'currents'
    if var in {'total_sea_level', 'sea_surface_height', 'zos', 'ssh', 'sla'}:
        return 'sea_level'
    if 'sea level' in text:
        if 'variation' not in var and 'tide' not in var and 'barometer' not in var:
            return 'sea_level'
    if 'chlorophyll' in text or var in {'chl', 'chlor_a', 'chlorophyll'}:
        return 'chlorophyll'
    return None

def find_logical(logical: str):
    out = []
    with NETCDF_LOCK:
        for f in get_nc_files():
            try:
                with safe_open_dataset(f) as ds:
                    for n, v in ds.data_vars.items():
                        if aliases(f.name, n) == logical:
                            out.append((f, n, dict(v.attrs), list(v.dims), list(v.shape)))
            except Exception:
                pass
    return out

def find_current_components():
    matches = find_logical('currents')
    groups = {}
    for f, n, a, d, s in matches:
        groups.setdefault(f, []).append((n, a))
    for f, items in groups.items():
        u = v = None
        for n, a in items:
            name = n.lower()
            std = str(a.get('standard_name', '')).lower()
            long_name = str(a.get('long_name', '')).lower()
            if u is None and (name in {'uo', 'u', 'ucur'} or 'eastward' in std or 'eastward' in long_name):
                u = n
            if v is None and (name in {'vo', 'v', 'vcur'} or 'northward' in std or 'northward' in long_name):
                v = n
        if u and v:
            return f, u, v
    return None, None, None

def get_ocean_catalog() -> Dict[str, Any]:
    labels = [
        ('temperature', 'Temperature'),
        ('temperature_anomaly', 'Sea surface temperature anomaly'),
        ('salinity', 'Salinity'),
        ('currents', 'Currents'),
        ('sea_level', 'Sea level'),
        ('chlorophyll', 'Chlorophyll')
    ]
    out = []
    for logical, label in labels:
        m = find_logical(logical)
        if logical == 'currents':
            f, u, v = find_current_components()
            if f:
                with safe_open_dataset(f) as ds:
                    a = ds[u].attrs
                    out.append({
                        'id': logical,
                        'label': label,
                        'available': True,
                        'file': f.name,
                        'variable': u,
                        'components': {'u': u, 'v': v},
                        'units': a.get('units'),
                        'long_name': 'Eastward/northward current components',
                        'standard_name': 'sea_water_velocity',
                        'dimensions': list(ds[u].dims),
                        'shape': list(ds[u].shape),
                        'matches': [{'file': f.name, 'variable': u}, {'file': f.name, 'variable': v}]
                    })
                    continue
        if not m:
            out.append({'id': logical, 'label': label, 'available': False, 'reason': 'No matching NetCDF variable found'})
            continue
        f, n, a, d, s = m[0]
        out.append({
            'id': logical,
            'label': label,
            'available': True,
            'file': f.name,
            'variable': n,
            'units': a.get('units'),
            'long_name': a.get('long_name'),
            'standard_name': a.get('standard_name'),
            'dimensions': d,
            'shape': s,
            'matches': [{'file': x[0].name, 'variable': x[1], 'units': x[2].get('units'), 'dimensions': x[3], 'shape': x[4]} for x in m]
        })
    return {'variables': out}

def get_ocean_time() -> Dict[str, Any]:
    for f, n, *_ in find_logical('temperature'):
        with safe_open_dataset(f) as ds:
            if 'time' in ds[n].dims and 'time' in ds.coords:
                vals = normalize_time_coordinate(ds[n]).time.values
                return {
                    'file': f.name,
                    'variable': n,
                    'count': int(vals.size),
                    'values': [pd.Timestamp(v).isoformat() for v in vals]
                }
    return {'file': None, 'variable': None, 'count': 0, 'values': []}

def get_ocean_current_grid(time: Optional[str] = None, depth: Optional[float] = None, stride: int = 3) -> Dict[str, Any]:
    f, u_name, v_name = find_current_components()
    if not f:
        raise HTTPException(404, detail='Both eastward and northward current variables are required')
    with safe_open_dataset(f) as ds:
        u, v = ds[u_name], ds[v_name]
        if time is not None:
            u, v = select_time(u, time), select_time(v, time)
        elif 'time' in u.dims:
            u, v = u.isel(time=0), v.isel(time=0)
        if depth is not None:
            if 'depth' in u.dims:
                u = u.sel(depth=depth, method='nearest')
            if 'depth' in v.dims:
                v = v.sel(depth=depth, method='nearest')
        else:
            u, v = select_surface(u), select_surface(v)
        yd = 'latitude' if 'latitude' in u.dims else 'lat' if 'lat' in u.dims else None
        xd = 'longitude' if 'longitude' in u.dims else 'lon' if 'lon' in u.dims else None
        if not yd or not xd:
            raise HTTPException(422, detail='Current dataset has no latitude/longitude dimensions')
        stride = max(1, min(stride, 20))
        u = u.isel({yd: slice(None, None, stride), xd: slice(None, None, stride)}).squeeze()
        v = v.isel({yd: slice(None, None, stride), xd: slice(None, None, stride)}).squeeze()
        lat, lon = u.coords[yd], u.coords[xd]
        return {
            'file': f.name,
            'u_variable': u_name,
            'v_variable': v_name,
            'latitude': sanitize(lat.values),
            'longitude': sanitize(lon.values),
            'u': sanitize(np.asarray(u.values, dtype=np.float32)),
            'v': sanitize(np.asarray(v.values, dtype=np.float32)),
            'units': u.attrs.get('units') or v.attrs.get('units')
        }

def get_ocean_point(latitude: float, longitude: float, time: Optional[str] = None) -> Dict[str, Any]:
    result = []
    for logical, label in [
        ('temperature', 'Temperature'),
        ('temperature_anomaly', 'SST anomaly'),
        ('salinity', 'Salinity'),
        ('currents', 'Currents'),
        ('sea_level', 'Sea level'),
        ('chlorophyll', 'Chlorophyll')
    ]:
        try:
            if logical == 'currents':
                cf, un, vn = find_current_components()
                if not cf:
                    result.append({'id': logical, 'label': label, 'available': False, 'value': None})
                    continue
                with safe_open_dataset(cf) as ds:
                    vals = {}
                    for name in (un, vn):
                        q = ds[name]
                        for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                            if dim in q.dims:
                                q = q.sel({dim: val}, method='nearest')
                        if time is not None:
                            q = select_time(q, time)
                        q = select_surface(q)
                        if q.ndim:
                            q = q.isel({dim: 0 for dim in q.dims})
                        if q.ndim == 0:
                            vals[name] = sanitize(q.values)
                    speed = float(np.hypot(vals.get(un, 0), vals.get(vn, 0))) if (un in vals and vn in vals) else None
                    result.append({
                        'id': logical,
                        'label': label,
                        'available': True,
                        'units': ds[un].attrs.get('units') or ds[vn].attrs.get('units'),
                        'value': vals,
                        'speed': speed,
                        'depth_dependent': ('depth' in ds[un].dims or 'depth' in ds[vn].dims)
                    })
                continue
            m = find_logical(logical)
            if not m:
                result.append({'id': logical, 'label': label, 'available': False, 'value': None})
                continue
            f, n, a, d, _ = m[0]
            with safe_open_dataset(f) as ds:
                q = ds[n]
                for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                    if dim in q.dims:
                        q = q.sel({dim: val}, method='nearest')
                if time is not None:
                    q = select_time(q, time)
                q = select_surface(q)
                if q.ndim:
                    q = q.isel({dim: 0 for dim in q.dims})
                result.append({
                    'id': logical,
                    'label': label,
                    'available': True,
                    'units': a.get('units'),
                    'value': sanitize(q.values),
                    'depth_dependent': any(dim in d for dim in ('depth', 'deptht', 'depthu', 'depthv', 'depthw', 'lev', 'level', 'z'))
                })
        except Exception as e:
            result.append({'id': logical, 'label': label, 'available': False, 'value': None, 'error': str(e)})
    return {'latitude': latitude, 'longitude': longitude, 'time': time, 'values': result}

def get_region_array(
    file: str,
    variable: str,
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    stride: int = 1
) -> Dict[str, Any]:
    with safe_open_dataset(find_file(file)) as ds:
        if variable not in ds.data_vars:
            raise HTTPException(404, detail=f"Variable '{variable}' not found")
        data = subset_array(
            ds[variable],
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            depth_min=depth_min,
            depth_max=depth_max,
            time_start=time_start,
            time_end=time_end,
            stride=stride
        )
        if data.size > 500000:
            raise HTTPException(413, detail={'error': 'Region is too large', 'number_of_values': int(data.size)})
        values = np.asarray(data.values, dtype=np.float32)
        return {
            'file': file,
            'variable': variable,
            'dimensions': list(data.dims),
            'shape': list(values.shape),
            'dtype': str(values.dtype),
            'coordinates': {d: sanitize(data[d].values) for d in data.dims if d in data.coords},
            'data': sanitize(values)
        }
