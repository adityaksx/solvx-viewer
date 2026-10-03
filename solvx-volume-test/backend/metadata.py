"""
Metadata extraction and JSON serialization helpers for SolvX NetCDF datasets.
"""

from typing import Dict, Any, List, Optional
import numpy as np
import xarray as xr


def format_coord_values(arr: np.ndarray) -> List[Any]:
    """Converts numpy coordinates to python primitives (numbers or ISO date strings)."""
    if np.issubdtype(arr.dtype, np.datetime64):
        # Format as ISO 8601 strings
        return [str(np.datetime_as_string(t, unit='s')) for t in arr]
    return [float(x) if np.isfinite(x) else None for x in arr]


def extract_dataset_metadata(
    ds: xr.Dataset,
    dataset_name: str,
    lat_dim: str,
    lon_dim: str,
    depth_dim: Optional[str] = None,
    time_dim: Optional[str] = None
) -> Dict[str, Any]:
    """Generates complete metadata summary dictionary for a dataset."""
    dimensions = {dim: int(size) for dim, size in ds.sizes.items()}

    # Extract coordinates
    coords_info = {}
    for c_name, c_da in ds.coords.items():
        vals = c_da.values
        if np.issubdtype(vals.dtype, np.datetime64):
            coords_info[c_name] = {
                "length": len(vals),
                "type": "datetime",
                "start": str(np.datetime_as_string(vals[0], unit='s')),
                "end": str(np.datetime_as_string(vals[-1], unit='s')),
            }
        else:
            finite_vals = vals[np.isfinite(vals)]
            coords_info[c_name] = {
                "length": len(vals),
                "type": "numeric",
                "min": float(finite_vals.min()) if len(finite_vals) else None,
                "max": float(finite_vals.max()) if len(finite_vals) else None,
                "units": c_da.attrs.get("units", ""),
            }

    # Extract variables
    variables = []
    for var_name, da in ds.data_vars.items():
        var_dims = list(da.dims)
        # We focus on variables with at least 2 dimensions (lat, lon)
        if lat_dim in var_dims and lon_dim in var_dims:
            units = da.attrs.get("units", "")
            long_name = da.attrs.get("long_name", var_name)
            has_depth = depth_dim is not None and depth_dim in var_dims
            has_time = time_dim is not None and time_dim in var_dims
            variables.append({
                "name": var_name,
                "long_name": long_name,
                "units": units,
                "dimensions": var_dims,
                "has_depth": has_depth,
                "has_time": has_time,
                "shape": list(da.shape),
            })

    # Geographic bounding box
    lats = ds.coords[lat_dim].values
    lons = ds.coords[lon_dim].values
    bounds = {
        "lat_min": float(np.nanmin(lats)),
        "lat_max": float(np.nanmax(lats)),
        "lon_min": float(np.nanmin(lons)),
        "lon_max": float(np.nanmax(lons)),
    }

    depth_levels = []
    if depth_dim and depth_dim in ds.coords:
        depth_vals = ds.coords[depth_dim].values
        depth_levels = [float(z) for z in depth_vals if np.isfinite(z)]
        if depth_levels:
            bounds["depth_min"] = float(min(depth_levels))
            bounds["depth_max"] = float(max(depth_levels))

    times = []
    if time_dim and time_dim in ds.coords:
        times = format_coord_values(ds.coords[time_dim].values)

    return {
        "dataset": dataset_name,
        "dimensions": dimensions,
        "detected_axes": {
            "latitude": lat_dim,
            "longitude": lon_dim,
            "depth": depth_dim,
            "time": time_dim,
        },
        "bounds": bounds,
        "depth_levels": depth_levels,
        "times": times,
        "coordinates": coords_info,
        "variables": variables,
    }
