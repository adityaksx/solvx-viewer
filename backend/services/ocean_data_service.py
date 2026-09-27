import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
import numpy as np
import pandas as pd
import xarray as xr
from fastapi import HTTPException

from ..config import MODEL_DATA_DIR
from ..processing.normalization import sanitize, normalize_time_coordinate, variable_catalog
from ..processing.subset import subset_array, select_surface, select_time, select_depth
from .cache_service import safe_open_dataset, NETCDF_LOCK

logger = logging.getLogger("solvx.ocean_data_service")

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

def get_ocean_current_grid(
    time: Optional[str] = None,
    depth: Optional[float] = None,
    stride: int = 3,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
) -> Dict[str, Any]:
    f, u_name, v_name = find_current_components()
    if not f:
        raise HTTPException(404, detail='Both eastward and northward current variables are required')
    with safe_open_dataset(f) as ds:
        u, v = ds[u_name], ds[v_name]
        
        # Check depth availability
        depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in u.dims or d in ds.coords), None)
        if depth is not None and depth_dim and depth_dim in ds.coords:
            d_vals = ds.coords[depth_dim].values
            d_min = float(np.min(d_vals))
            d_max = float(np.max(d_vals))
            if depth < d_min - 2.0 or depth > d_max + 10.0:
                return {
                    'file': f.name,
                    'available': False,
                    'reason': f"Selected depth {depth}m is outside available current data range ({d_min:.1f}m to {d_max:.1f}m)",
                    'depth': depth,
                    'available_range': [round(d_min, 1), round(d_max, 1)],
                    'latitude': [],
                    'longitude': [],
                    'lat': [],
                    'lon': [],
                    'u': [],
                    'v': [],
                    'units': u.attrs.get('units') or v.attrs.get('units') or 'm/s'
                }
            u = u.sel({depth_dim: depth}, method='nearest')
            v = v.sel({depth_dim: depth}, method='nearest')
        else:
            u, v = select_surface(u), select_surface(v)

        if time is not None:
            u, v = select_time(u, time), select_time(v, time)
        elif 'time' in u.dims:
            u, v = u.isel(time=0), v.isel(time=0)

        yd = 'latitude' if 'latitude' in u.dims else 'lat' if 'lat' in u.dims else None
        xd = 'longitude' if 'longitude' in u.dims else 'lon' if 'lon' in u.dims else None
        if not yd or not xd:
            raise HTTPException(422, detail='Current dataset has no latitude/longitude dimensions')

        # Subsetting by spatial bbox if provided
        if min_lat is not None and max_lat is not None:
            lat_arr = ds.coords[yd].values
            if len(lat_arr) > 1 and lat_arr[0] > lat_arr[-1]:
                u = u.sel({yd: slice(max_lat, min_lat)})
                v = v.sel({yd: slice(max_lat, min_lat)})
            else:
                u = u.sel({yd: slice(min_lat, max_lat)})
                v = v.sel({yd: slice(min_lat, max_lat)})

        if min_lon is not None and max_lon is not None:
            u = u.sel({xd: slice(min_lon, max_lon)})
            v = v.sel({xd: slice(min_lon, max_lon)})

        stride = max(1, min(stride, 20))
        u = u.isel({yd: slice(None, None, stride), xd: slice(None, None, stride)}).squeeze()
        v = v.isel({yd: slice(None, None, stride), xd: slice(None, None, stride)}).squeeze()
        lat, lon = u.coords[yd], u.coords[xd]

        u_data = np.asarray(u.values, dtype=np.float32)
        v_data = np.asarray(v.values, dtype=np.float32)
        speeds = np.hypot(u_data, v_data)
        valid_speeds = speeds[~np.isnan(speeds)]
        min_s = float(np.min(valid_speeds)) if len(valid_speeds) > 0 else 0.0
        max_s = float(np.max(valid_speeds)) if len(valid_speeds) > 0 else 1.0

        time_val = str(u.coords['time'].values)[:19] if 'time' in u.coords else (time or '')

        return {
            'file': f.name,
            'available': True,
            'u_variable': u_name,
            'v_variable': v_name,
            'latitude': sanitize(lat.values),
            'longitude': sanitize(lon.values),
            'lat': sanitize(lat.values),
            'lon': sanitize(lon.values),
            'u': sanitize(u_data),
            'v': sanitize(v_data),
            'u_grid': sanitize(u_data),
            'v_grid': sanitize(v_data),
            'speed_grid': sanitize(speeds),
            'stats': {
                'min_speed': round(min_s, 3),
                'max_speed': round(max_s, 3)
            },
            'depth': float(depth) if depth is not None else 0.0,
            'time': time_val,
            'min_speed': round(min_s, 3),
            'max_speed': round(max_s, 3),
            'units': u.attrs.get('units') or v.attrs.get('units') or 'm/s'
        }


def get_current_field(
    dataset: Optional[str] = None,
    variable: str = 'currents',
    time: Optional[str] = None,
    depth: Optional[float] = None,
    bbox: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    stride: int = 3
) -> Dict[str, Any]:
    """Universal API for 2D/3D current vector fields meeting requirement specifications."""
    if bbox:
        # Parse "min_lon,min_lat,max_lon,max_lat" or "min_lat,max_lat,min_lon,max_lon"
        parts = [float(p.strip()) for p in bbox.split(',') if p.strip()]
        if len(parts) == 4:
            if parts[0] > parts[1] and parts[0] > 40: # min_lon, min_lat, max_lon, max_lat
                min_lon, min_lat, max_lon, max_lat = parts[0], parts[1], parts[2], parts[3]
            else:
                min_lat, max_lat, min_lon, max_lon = parts[0], parts[1], parts[2], parts[3]

    return get_ocean_current_grid(
        time=time,
        depth=depth,
        stride=stride,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon
    )


def get_point_profile(
    latitude: float,
    longitude: float,
    time: Optional[str] = None,
    variable: str = 'temperature',
    dataset: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieves vertical sounding profile for a specific variable against depth."""
    var_norm = variable.lower().strip()
    profile_points = []
    unit_str = '°C'

    if var_norm in ('currents', 'current_speed', 'velocity', 'uo', 'vo'):
        cf, un, vn = find_current_components()
        if cf and un and vn:
            with safe_open_dataset(cf) as ds:
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in ds.dims or d in ds.coords), None)
                if depth_dim and depth_dim in ds.coords:
                    depth_vals = [round(float(d), 2) for d in ds.coords[depth_dim].values]
                    qu = ds[un]
                    qv = ds[vn]
                    for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                        if dim in qu.dims:
                            qu = qu.sel({dim: val}, method='nearest')
                            qv = qv.sel({dim: val}, method='nearest')
                    if time is not None:
                        qu = select_time(qu, time)
                        qv = select_time(qv, time)
                    for d in ('time', 't'):
                        if d in qu.dims:
                            qu = qu.isel({d: 0})
                            qv = qv.isel({d: 0})

                    u_arr = qu.values
                    v_arr = qv.values
                    speeds = np.hypot(u_arr, v_arr)
                    for d_val, s_val, u_val, v_val in zip(depth_vals, speeds, u_arr, v_arr):
                        if not np.isnan(s_val):
                            profile_points.append({
                                'depth': d_val,
                                'value': round(float(s_val), 3),
                                'current_speed': round(float(s_val), 3),
                                'u': round(float(u_val), 3),
                                'v': round(float(v_val), 3)
                            })
            unit_str = 'm/s'
    else:
        logical = (
            'salinity' if var_norm in ('salinity', 'so', 'sal')
            else 'chlorophyll' if var_norm in ('chlorophyll', 'chl', 'chlor_a')
            else 'sea_level' if var_norm in ('sea_surface_height', 'sea_level', 'zos')
            else 'temperature'
        )
        unit_str = 'PSU' if logical == 'salinity' else 'mg/m³' if logical == 'chlorophyll' else 'm' if logical == 'sea_level' else '°C'
        m = find_logical(logical)
        if m:
            f, n, a, _, _ = m[0]
            unit_str = a.get('units') or unit_str
            with safe_open_dataset(f) as ds:
                da = ds[n]
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in da.dims or d in da.coords), None)
                if depth_dim and depth_dim in da.coords:
                    depth_vals = [round(float(d), 2) for d in da.coords[depth_dim].values]
                    q = da
                    for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                        if dim in q.dims:
                            q = q.sel({dim: val}, method='nearest')
                    if time is not None:
                        q = select_time(q, time)
                    for d in ('time', 't'):
                        if d in q.dims:
                            q = q.isel({d: 0})
                    for d_val, val in zip(depth_vals, q.values):
                        if not np.isnan(val):
                            profile_points.append({
                                'depth': d_val,
                                'value': round(float(val), 3)
                            })
                else:
                    # Surface variable
                    q = da
                    for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                        if dim in q.dims:
                            q = q.sel({dim: val}, method='nearest')
                    if time is not None:
                        q = select_time(q, time)
                    val = float(q.values.flat[0]) if q.size > 0 else None
                    if val is not None and not np.isnan(val):
                        profile_points.append({'depth': 0.0, 'value': round(val, 3)})

    # Sort ascending by depth
    profile_points.sort(key=lambda p: p['depth'])

    return {
        'latitude': latitude,
        'longitude': longitude,
        'time': time,
        'variable': variable,
        'units': unit_str,
        'count': len(profile_points),
        'profile': profile_points
    }


def get_point_timeseries(
    latitude: float,
    longitude: float,
    depth: Optional[float] = 0.0,
    start: Optional[str] = None,
    end: Optional[str] = None,
    variable: str = 'temperature',
    dataset: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieves temporal time series of a variable at a specific geographic point and depth."""
    var_norm = variable.lower().strip()
    timestamps = []
    values = []
    unit_str = '°C'

    if var_norm in ('currents', 'current_speed', 'velocity'):
        cf, un, vn = find_current_components()
        if cf and un and vn:
            with safe_open_dataset(cf) as ds:
                qu = ds[un]
                qv = ds[vn]
                for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                    if dim in qu.dims:
                        qu = qu.sel({dim: val}, method='nearest')
                        qv = qv.sel({dim: val}, method='nearest')
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in qu.dims or d in ds.coords), None)
                if depth_dim and depth is not None and depth_dim in qu.dims:
                    qu = qu.sel({depth_dim: depth}, method='nearest')
                    qv = qv.sel({depth_dim: depth}, method='nearest')
                elif depth_dim and depth_dim in qu.dims:
                    qu = qu.isel({depth_dim: 0})
                    qv = qv.isel({depth_dim: 0})

                if 'time' in qu.dims:
                    t_coord = qu.coords['time'].values
                    for t_idx, t_val in enumerate(t_coord):
                        t_iso = pd.Timestamp(t_val).isoformat()
                        if start and t_iso[:10] < str(start)[:10]:
                            continue
                        if end and t_iso[:10] > str(end)[:10]:
                            continue
                        u_v = float(qu.isel(time=t_idx).values)
                        v_v = float(qv.isel(time=t_idx).values)
                        sp = float(np.hypot(u_v, v_v)) if (not np.isnan(u_v) and not np.isnan(v_v)) else None
                        timestamps.append(t_iso)
                        values.append(round(sp, 3) if sp is not None else None)
            unit_str = 'm/s'
    else:
        logical = (
            'salinity' if var_norm in ('salinity', 'so', 'sal')
            else 'chlorophyll' if var_norm in ('chlorophyll', 'chl', 'chlor_a')
            else 'sea_level' if var_norm in ('sea_surface_height', 'sea_level', 'zos')
            else 'temperature'
        )
        unit_str = 'PSU' if logical == 'salinity' else 'mg/m³' if logical == 'chlorophyll' else 'm' if logical == 'sea_level' else '°C'
        m = find_logical(logical)
        if m:
            f, n, a, _, _ = m[0]
            unit_str = a.get('units') or unit_str
            with safe_open_dataset(f) as ds:
                da = ds[n]
                for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                    if dim in da.dims:
                        da = da.sel({dim: val}, method='nearest')
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in da.dims or d in ds.coords), None)
                if depth_dim and depth is not None and depth_dim in da.dims:
                    da = da.sel({depth_dim: depth}, method='nearest')
                elif depth_dim and depth_dim in da.dims:
                    da = da.isel({depth_dim: 0})

                if 'time' in da.dims:
                    t_coord = da.coords['time'].values
                    for t_idx, t_val in enumerate(t_coord):
                        t_iso = pd.Timestamp(t_val).isoformat()
                        if start and t_iso[:10] < str(start)[:10]:
                            continue
                        if end and t_iso[:10] > str(end)[:10]:
                            continue
                        val = float(da.isel(time=t_idx).values)
                        timestamps.append(t_iso)
                        values.append(round(val, 3) if not np.isnan(val) else None)

    valid_vals = [v for v in values if v is not None and not np.isnan(v)]
    stats = {
        'min': round(float(np.min(valid_vals)), 3) if valid_vals else None,
        'max': round(float(np.max(valid_vals)), 3) if valid_vals else None,
        'mean': round(float(np.mean(valid_vals)), 3) if valid_vals else None,
        'count': len(valid_vals)
    }

    return {
        'latitude': latitude,
        'longitude': longitude,
        'depth': depth or 0.0,
        'variable': variable,
        'units': unit_str,
        'unit': unit_str,
        'count': len(timestamps),
        'timestamps': timestamps,
        'values': values,
        'timeseries': [{'time': t, 'value': v} for t, v in zip(timestamps, values)],
        'stats': stats
    }

def get_ocean_point(latitude: float, longitude: float, time: Optional[str] = None, depth: Optional[float] = None) -> Dict[str, Any]:
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
                        q = select_depth(q, depth)
                        if q.ndim:
                            q = q.isel({dim: 0 for dim in q.dims})
                        if q.ndim == 0:
                            vals[name] = sanitize(q.values)
                    speed = float(np.hypot(vals.get(un, 0), vals.get(vn, 0))) if (un in vals and vn in vals and vals.get(un) is not None and vals.get(vn) is not None) else None
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
                q = select_depth(q, depth)
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

    # Extract vertical profile across real available depths
    available_depths: List[float] = []
    profile_points: List[Dict[str, Any]] = []

    try:
        m_temp = find_logical('temperature')
        m_sal = find_logical('salinity')
        cf_curr, un_curr, vn_curr = find_current_components()

        temp_by_depth = {}
        sal_by_depth = {}
        u_by_depth = {}
        v_by_depth = {}

        if m_temp:
            f, n, _, _, _ = m_temp[0]
            with safe_open_dataset(f) as ds:
                da = ds[n]
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in da.dims or d in da.coords), None)
                if depth_dim and depth_dim in da.coords:
                    available_depths = [round(float(d_val), 2) for d_val in da.coords[depth_dim].values]
                    q = da
                    for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                        if dim in q.dims:
                            q = q.sel({dim: val}, method='nearest')
                    if time is not None:
                        q = select_time(q, time)
                    for d in ('time', 't'):
                        if d in q.dims:
                            q = q.isel({d: 0})
                    if q.ndim == 1 and depth_dim in q.dims:
                        for d_val, t_val in zip(available_depths, q.values):
                            if not np.isnan(t_val):
                                temp_by_depth[d_val] = round(float(t_val), 3)

        if m_sal:
            f, n, _, _, _ = m_sal[0]
            with safe_open_dataset(f) as ds:
                da = ds[n]
                depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in da.dims or d in da.coords), None)
                if depth_dim and depth_dim in da.coords:
                    q = da
                    for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                        if dim in q.dims:
                            q = q.sel({dim: val}, method='nearest')
                    if time is not None:
                        q = select_time(q, time)
                    for d in ('time', 't'):
                        if d in q.dims:
                            q = q.isel({d: 0})
                    if q.ndim == 1 and depth_dim in q.dims:
                        for d_val, s_val in zip(da.coords[depth_dim].values, q.values):
                            d_round = round(float(d_val), 2)
                            if not np.isnan(s_val):
                                sal_by_depth[d_round] = round(float(s_val), 3)

        if cf_curr and un_curr and vn_curr:
            with safe_open_dataset(cf_curr) as ds:
                for name, d_dict in [(un_curr, u_by_depth), (vn_curr, v_by_depth)]:
                    da = ds[name]
                    depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in da.dims or d in da.coords), None)
                    if depth_dim and depth_dim in da.coords:
                        q = da
                        for dim, val in [('latitude', latitude), ('longitude', longitude), ('lat', latitude), ('lon', longitude)]:
                            if dim in q.dims:
                                q = q.sel({dim: val}, method='nearest')
                        if time is not None:
                            q = select_time(q, time)
                        for d in ('time', 't'):
                            if d in q.dims:
                                q = q.isel({d: 0})
                        if q.ndim == 1 and depth_dim in q.dims:
                            for d_val, val in zip(da.coords[depth_dim].values, q.values):
                                d_round = round(float(d_val), 2)
                                if not np.isnan(val):
                                    d_dict[d_round] = round(float(val), 3)

        all_depths = sorted(set(available_depths) | set(sal_by_depth.keys()) | set(u_by_depth.keys()))
        for d in all_depths:
            t_val = temp_by_depth.get(d)
            s_val = sal_by_depth.get(d)
            u_val = u_by_depth.get(d)
            v_val = v_by_depth.get(d)
            speed_val = float(np.hypot(u_val, v_val)) if (u_val is not None and v_val is not None) else None
            if t_val is not None or s_val is not None or u_val is not None or v_val is not None:
                profile_points.append({
                    'depth': d,
                    'temperature': t_val,
                    'salinity': s_val,
                    'current_u': u_val,
                    'current_v': v_val,
                    'current_speed': round(speed_val, 3) if speed_val is not None else None
                })
    except Exception as e:
        logger.warning(f"Failed to extract vertical profile at ({latitude}, {longitude}): {e}")

    return {
        'latitude': latitude,
        'longitude': longitude,
        'time': time,
        'depth': depth,
        'available_depths': available_depths,
        'profile': profile_points,
        'values': result
    }

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


def get_ocean_depths(variable: Optional[str] = None) -> Dict[str, Any]:
    """Returns available vertical depth levels for a variable or active model dataset."""
    logical = variable or 'temperature'
    if logical in ('temp', 'ocean_temperature'):
        logical = 'temperature'

    matches = find_logical(logical)
    if not matches and logical != 'temperature':
        matches = find_logical('temperature')

    if not matches:
        return {
            'variable': logical,
            'file': None,
            'depth_dimension': None,
            'depths': [0.49],
            'min_depth': 0.49,
            'max_depth': 0.49,
            'count': 1,
            'units': 'meters'
        }

    f, n, a, d, s = matches[0]
    with safe_open_dataset(f) as ds:
        da = ds[n]
        depth_dim = next((dim for dim in ('depth', 'deptht', 'depthu', 'depthv', 'depthw', 'lev', 'level', 'z') if dim in da.dims or dim in da.coords), None)
        if depth_dim and depth_dim in da.coords:
            raw_depths = [round(float(x), 2) for x in da.coords[depth_dim].values]
            return {
                'variable': logical,
                'file': f.name,
                'depth_dimension': depth_dim,
                'depths': raw_depths,
                'min_depth': min(raw_depths),
                'max_depth': max(raw_depths),
                'count': len(raw_depths),
                'units': 'meters'
            }

        return {
            'variable': logical,
            'file': f.name,
            'depth_dimension': None,
            'depths': [0.49],
            'min_depth': 0.49,
            'max_depth': 0.49,
            'count': 1,
            'units': 'meters'
        }


def get_ocean_slice(
    variable: str = 'temperature',
    depth: float = 0.0,
    time: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    stride: int = 1
) -> Dict[str, Any]:
    """Extracts a 2D horizontal field slice at a specific depth level."""
    logical = 'temperature' if variable in ('temp', 'ocean_temperature') else variable

    if logical == 'currents':
        cg = get_ocean_current_grid(time=time, depth=depth, stride=stride)
        return {
            'variable': 'currents',
            'depth': depth,
            'time': time,
            'latitude': cg['latitude'],
            'longitude': cg['longitude'],
            'u': cg['u'],
            'v': cg['v'],
            'units': cg.get('units', 'm/s')
        }

    matches = find_logical(logical)
    if not matches:
        raise HTTPException(404, detail=f"Variable '{variable}' not found in catalog")

    f, n, a, d, s = matches[0]
    with safe_open_dataset(f) as ds:
        da = ds[n]
        sub = subset_array(
            da,
            lat_min=min_lat,
            lat_max=max_lat,
            lon_min=min_lon,
            lon_max=max_lon,
            depth_min=depth,
            depth_max=depth,
            time_start=time,
            time_end=time,
            stride=stride
        )
        if time is None and 'time' in sub.dims:
            sub = sub.isel(time=0)
        elif time is not None:
            sub = select_time(sub, time)

        depth_dim = next((dim for dim in ('depth', 'deptht', 'depthu', 'depthv', 'depthw', 'lev', 'level', 'z') if dim in sub.dims), None)
        selected_depth = depth
        if depth_dim:
            if sub.sizes[depth_dim] > 1:
                sub = sub.sel({depth_dim: float(depth)}, method='nearest')
            else:
                sub = sub.squeeze(dim=depth_dim, drop=True)
            if depth_dim in da.coords:
                selected_depth = float(da[depth_dim].sel({depth_dim: float(depth)}, method='nearest').values)

        yd = 'latitude' if 'latitude' in sub.dims else 'lat' if 'lat' in sub.dims else None
        xd = 'longitude' if 'longitude' in sub.dims else 'lon' if 'lon' in sub.dims else None
        if not yd or not xd:
            raise HTTPException(422, detail='Dataset missing latitude/longitude dimensions')

        lats = sanitize(sub.coords[yd].values.tolist())
        lons = sanitize(sub.coords[xd].values.tolist())
        vals_raw = sub.values.astype(np.float32)
        vals_grid = sanitize(vals_raw.tolist())

        valid = vals_raw[~np.isnan(vals_raw)]
        min_v = float(valid.min()) if len(valid) > 0 else 0.0
        max_v = float(valid.max()) if len(valid) > 0 else 1.0

        return {
            'variable': logical,
            'file': f.name,
            'depth': round(selected_depth, 2),
            'time': time,
            'latitude': lats,
            'longitude': lons,
            'values': vals_grid,
            'min_val': round(min_v, 3),
            'max_val': round(max_v, 3),
            'units': a.get('units', '')
        }


def get_ocean_vertical_slice(
    variable: str = 'temperature',
    time: Optional[str] = None,
    start_lat: Optional[float] = None,
    start_lon: Optional[float] = None,
    end_lat: Optional[float] = None,
    end_lon: Optional[float] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    num_points: int = 100
) -> Dict[str, Any]:
    """
    Extracts a 2D vertical cross-section (depth x distance) along a transect.
    Supports:
      - Orthogonal transects: constant latitude (varying lon) or constant longitude (varying lat)
      - Arbitrary diagonal transects between (start_lat, start_lon) and (end_lat, end_lon).
    """
    logical = 'temperature' if variable in ('temp', 'ocean_temperature') else variable
    matches = find_logical(logical)
    if not matches:
        raise HTTPException(404, detail=f"Variable '{variable}' not found in catalog")

    f, n, a, d, s = matches[0]
    with safe_open_dataset(f) as ds:
        da = ds[n]
        yd = 'latitude' if 'latitude' in da.dims else 'lat' if 'lat' in da.dims else None
        xd = 'longitude' if 'longitude' in da.dims else 'lon' if 'lon' in da.dims else None
        if not yd or not xd:
            raise HTTPException(422, detail='Dataset missing latitude/longitude dimensions')

        grid_lats = np.asarray(da.coords[yd].values, dtype=float)
        grid_lons = np.asarray(da.coords[xd].values, dtype=float)

        # 1. Resolve transect endpoints
        transect_type = 'custom'
        if latitude is not None:
            transect_type = 'constant_latitude'
            s_lat = e_lat = float(latitude)
            s_lon = float(start_lon) if start_lon is not None else float(grid_lons.min())
            e_lon = float(end_lon) if end_lon is not None else float(grid_lons.max())
        elif longitude is not None:
            transect_type = 'constant_longitude'
            s_lon = e_lon = float(longitude)
            s_lat = float(start_lat) if start_lat is not None else float(grid_lats.min())
            e_lat = float(end_lat) if end_lat is not None else float(grid_lats.max())
        else:
            if start_lat is None or start_lon is None or end_lat is None or end_lon is None:
                # Default diagonal across the dataset
                s_lat = float(grid_lats.min())
                s_lon = float(grid_lons.min())
                e_lat = float(grid_lats.max())
                e_lon = float(grid_lons.max())
            else:
                s_lat = float(start_lat)
                s_lon = float(start_lon)
                e_lat = float(end_lat)
                e_lon = float(end_lon)

        num_points = max(2, min(int(num_points), 500))
        t_steps = np.linspace(0.0, 1.0, num_points)
        sample_lats = s_lat + t_steps * (e_lat - s_lat)
        sample_lons = s_lon + t_steps * (e_lon - s_lon)

        # Calculate distances in km along transect
        distances_km = [0.0]
        for k in range(1, num_points):
            lat1, lon1 = sample_lats[k - 1], sample_lons[k - 1]
            lat2, lon2 = sample_lats[k], sample_lons[k]
            d_lat = (lat2 - lat1) * 111.32
            mid_lat_rad = np.radians((lat1 + lat2) / 2.0)
            d_lon = (lon2 - lon1) * 111.32 * np.cos(mid_lat_rad)
            dist_step = float(np.hypot(d_lat, d_lon))
            distances_km.append(round(distances_km[-1] + dist_step, 2))

        stations = [
            {
                'station_index': k,
                'latitude': round(float(sample_lats[k]), 4),
                'longitude': round(float(sample_lons[k]), 4),
                'distance_km': round(distances_km[k], 2)
            }
            for k in range(num_points)
        ]

        # 2. Select temporal step
        da_time = da
        if time is not None and 'time' in da_time.dims:
            da_time = select_time(da_time, time)
        elif 'time' in da_time.dims:
            da_time = da_time.isel(time=0)

        # 3. Depth levels
        depth_dim = next((dim for dim in ('depth', 'deptht', 'depthu', 'depthv', 'depthw', 'lev', 'level', 'z') if dim in da_time.dims), None)
        if depth_dim and depth_dim in da_time.coords:
            depth_vals = [round(float(z), 2) for z in da_time.coords[depth_dim].values]
        else:
            depth_vals = [0.49]
            da_time = da_time.expand_dims('depth', axis=0)
            depth_dim = 'depth'

        D = len(depth_vals)
        H = len(grid_lats)
        W = len(grid_lons)
        vals_3d = da_time.values.astype(np.float32)
        if vals_3d.ndim == 2:
            vals_3d = vals_3d[np.newaxis, :, :]

        # 4. Bilinear sampling across transect
        lats_clamped = np.clip(sample_lats, grid_lats.min(), grid_lats.max())
        lons_clamped = np.clip(sample_lons, grid_lons.min(), grid_lons.max())

        i = np.clip(np.searchsorted(grid_lats, lats_clamped, side='right') - 1, 0, H - 2)
        j = np.clip(np.searchsorted(grid_lons, lons_clamped, side='right') - 1, 0, W - 2)

        dlat = grid_lats[i + 1] - grid_lats[i]
        dlon = grid_lons[j + 1] - grid_lons[j]
        fy = np.where(dlat > 0, (lats_clamped - grid_lats[i]) / dlat, 0.0)
        fx = np.where(dlon > 0, (lons_clamped - grid_lons[j]) / dlon, 0.0)

        v00 = vals_3d[:, i, j]
        v01 = vals_3d[:, i, j + 1]
        v10 = vals_3d[:, i + 1, j]
        v11 = vals_3d[:, i + 1, j + 1]

        w00 = (1.0 - fy) * (1.0 - fx)
        w01 = (1.0 - fy) * fx
        w10 = fy * (1.0 - fx)
        w11 = fy * fx

        interp_grid = w00 * v00 + w01 * v01 + w10 * v10 + w11 * v11
        nan_mask = np.isnan(interp_grid)
        if np.any(nan_mask):
            v_near = vals_3d[:, np.round(i + fy).astype(int), np.round(j + fx).astype(int)]
            interp_grid = np.where(nan_mask, v_near, interp_grid)

        valid = interp_grid[~np.isnan(interp_grid)]
        min_v = float(valid.min()) if len(valid) > 0 else 0.0
        max_v = float(valid.max()) if len(valid) > 0 else 1.0

        return {
            'variable': logical,
            'file': f.name,
            'transect_type': transect_type,
            'time': time,
            'stations': stations,
            'total_distance_km': distances_km[-1],
            'depths': depth_vals,
            'shape': [D, num_points],
            'values': sanitize(interp_grid.tolist()),
            'min_val': round(min_v, 3),
            'max_val': round(max_v, 3),
            'units': a.get('units', '')
        }

