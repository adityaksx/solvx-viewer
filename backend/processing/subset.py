from typing import Optional
import xarray as xr
from .normalization import normalize_time_coordinate, normalize_time_value

def select_time(data: xr.DataArray, value, method='nearest') -> xr.DataArray:
    if value is None or 'time' not in data.dims:
        return data
    norm_time = normalize_time_value(value)
    return normalize_time_coordinate(data).sel(time=norm_time, method=method)

def coord_slice(data: xr.DataArray, dim: str, lo, hi) -> xr.DataArray:
    if dim not in data.dims or lo is None or hi is None:
        return data
    if dim == 'time':
        data = normalize_time_coordinate(data)
        lo, hi = normalize_time_value(lo), normalize_time_value(hi)
    c = data[dim].values
    if not c.size:
        return data
    if lo == hi:
        # Singleton selection (e.g. depth=0.0) -> select nearest point
        try:
            return data.sel({dim: lo}, method='nearest')
        except Exception:
            pass
    sl = slice(lo, hi) if c[0] <= c[-1] else slice(hi, lo)
    sliced = data.sel({dim: sl})
    # If slice ended up empty (e.g. lo and hi fall in between grid points or out of range)
    if sliced.sizes.get(dim, 0) == 0:
        try:
            return data.sel({dim: lo}, method='nearest')
        except Exception:
            return data
    return sliced

def select_surface(data: xr.DataArray) -> xr.DataArray:
    """Selects the surface layer along any standard depth dimension."""
    for dim in ('depth', 'deptht', 'depthu', 'depthv', 'depthw', 'lev', 'level', 'z'):
        if dim in data.dims:
            c = data[dim].values
            if not c.size:
                continue
            try:
                return data.sel({dim: 0.0}, method='nearest')
            except Exception:
                if c.size > 0:
                    return data.isel({dim: 0})
    return data

def subset_array(
    data: xr.DataArray,
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    stride: int = 1
) -> xr.DataArray:
    """Subsets a DataArray along spatial, vertical, and temporal dimensions with optional stride downsampling."""
    for d, lo, hi in [
        ('latitude', lat_min, lat_max),
        ('longitude', lon_min, lon_max),
        ('depth', depth_min, depth_max),
        ('lat', lat_min, lat_max),
        ('lon', lon_min, lon_max)
    ]:
        if lo is not None and hi is not None:
            data = coord_slice(data, d, lo, hi)

    data = coord_slice(data, 'time', time_start, time_end)

    stride = max(1, min(stride, 20))
    if stride > 1:
        for dim in ('latitude', 'longitude', 'lat', 'lon'):
            if dim in data.dims:
                data = data.isel({dim: slice(None, None, stride)})

    return data
