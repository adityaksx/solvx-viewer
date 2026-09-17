from typing import Any
import numpy as np
import pandas as pd
import xarray as xr

def sanitize(v: Any) -> Any:
    """Sanitizes numpy arrays, datetimes, and NaN/inf values into standard JSON-compliant Python structures."""
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        try:
            return pd.Timestamp(v).isoformat()
        except Exception:
            return str(v)
    if isinstance(v, np.ndarray):
        if np.issubdtype(v.dtype, np.floating):
            if v.ndim == 1:
                return [None if not np.isfinite(x) else round(float(x), 5) for x in v.tolist()]
            if v.ndim == 2:
                return [[None if not np.isfinite(x) else round(float(x), 5) for x in row] for row in v.tolist()]
        return v.tolist()
    if isinstance(v, np.generic):
        val = v.item()
        return val if not isinstance(val, float) or np.isfinite(val) else None
    if isinstance(v, dict):
        return {str(k): sanitize(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [sanitize(x) for x in v]
    if isinstance(v, float):
        return v if np.isfinite(v) else None
    return v

def normalize_time_coordinate(data: xr.DataArray) -> xr.DataArray:
    """Standardizes dataset time coordinate to UTC datetime64[ns]."""
    if 'time' not in data.dims or 'time' not in data.coords:
        return data
    raw = data.time.values
    try:
        if np.issubdtype(np.asarray(raw).dtype, np.number):
            units = str(data.time.attrs.get('units', '')).lower()
            if 'since' in units:
                try:
                    raw = xr.coding.times.decode_cf_datetime(raw, units, data.time.attrs.get('calendar', 'standard'))
                except Exception:
                    raw = pd.to_datetime(raw, unit='ns', utc=True)
            else:
                raw = pd.to_datetime(raw, unit='ns', utc=True)
        else:
            raw = pd.to_datetime(raw, utc=True)
        return data.assign_coords(time=('time', pd.DatetimeIndex(raw).tz_localize(None).to_numpy(dtype='datetime64[ns]')))
    except Exception as e:
        raise ValueError(f"Could not normalize NetCDF time coordinate: {e}")

def normalize_time_value(value: Any):
    """Converts user or query time string/int into a pandas Timestamp without tzinfo."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float, np.integer, np.floating)):
            n = float(value)
            a = abs(n)
            u = 'ns' if a >= 1e17 else 'us' if a >= 1e14 else 'ms' if a >= 1e11 else 's'
            p = pd.to_datetime(n, unit=u, utc=True)
        else:
            text = str(value).strip()
            if text.isdigit() and len(text) >= 10:
                n = float(text)
                a = abs(n)
                u = 'ns' if a >= 1e17 else 'us' if a >= 1e14 else 'ms' if a >= 1e11 else 's'
                p = pd.to_datetime(n, unit=u, utc=True)
            else:
                p = pd.to_datetime(text, utc=True)
        return p.tz_convert(None) if getattr(p, 'tzinfo', None) is not None else p
    except Exception as e:
        raise ValueError(f"Invalid time value '{value}': {e}")

def variable_catalog(ds: xr.Dataset):
    """Generates standardized metadata catalog for dataset variables."""
    return [
        {
            'name': n,
            'dimensions': list(v.dims),
            'shape': list(v.shape),
            'dtype': str(v.dtype),
            'long_name': v.attrs.get('long_name'),
            'standard_name': v.attrs.get('standard_name'),
            'units': v.attrs.get('units')
        }
        for n, v in ds.data_vars.items()
    ]
