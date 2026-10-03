#!/usr/bin/env python3
"""
Inspects any NetCDF file and prints formatted dimension, variable, coordinate, shape, and value statistics.
Usage:
    python inspect_netcdf.py path/to/dataset.nc
"""

import sys
import numpy as np
import xarray as xr
from pathlib import Path

# Coordinate alias dictionaries (Section 8)
LAT_NAMES = ["lat", "latitude", "nav_lat", "y"]
LON_NAMES = ["lon", "longitude", "nav_lon", "x"]
DEPTH_NAMES = ["depth", "depths", "lev", "level", "z", "deptht"]
TIME_NAMES = ["time", "TIME", "date"]


def detect_dim(ds, candidates):
    for name in candidates:
        if name in ds.coords or name in ds.dims:
            return name
    return None


def inspect_dataset(file_path: Path):
    if not file_path.exists():
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    print("=" * 60)
    print("Dataset Inspection")
    print("=" * 60)
    print(f"File: {file_path.name}")
    print(f"Path: {file_path.resolve()}")

    try:
        ds = xr.open_dataset(file_path)
    except Exception as e:
        print(f"Error opening NetCDF file: {e}")
        sys.exit(1)

    lat_dim = detect_dim(ds, LAT_NAMES)
    lon_dim = detect_dim(ds, LON_NAMES)
    depth_dim = detect_dim(ds, DEPTH_NAMES)
    time_dim = detect_dim(ds, TIME_NAMES)

    print("\nDimensions:")
    for dim, size in ds.sizes.items():
        tag = ""
        if dim == lat_dim: tag = " [Latitude]"
        elif dim == lon_dim: tag = " [Longitude]"
        elif dim == depth_dim: tag = " [Depth]"
        elif dim == time_dim: tag = " [Time]"
        print(f"  {dim:12s}: {size:5d}{tag}")

    print("\nCoordinates:")
    for coord in ds.coords:
        c_vals = ds.coords[coord].values
        if np.issubdtype(c_vals.dtype, np.number):
            print(f"  {coord:12s} ({len(c_vals)}): min={c_vals.min():.3f}, max={c_vals.max():.3f}")
        else:
            print(f"  {coord:12s} ({len(c_vals)}): {c_vals[0]} to {c_vals[-1]}")

    print("\nVariables:")
    for var_name, da in ds.data_vars.items():
        units = da.attrs.get("units", "unknown")
        long_name = da.attrs.get("long_name", var_name)
        print(f"  • {var_name:12s} shape={str(da.shape):18s} units={units}")

    # Inspect first scalar variable in detail
    if ds.data_vars:
        first_var = list(ds.data_vars.keys())[0]
        da = ds[first_var]
        units = da.attrs.get("units", "unknown")
        arr = da.values
        valid = arr[~np.isnan(arr)]

        print("\nSelected variable:")
        print(f"  {first_var}")
        print(f"  Shape: {da.shape}")
        print(f"  Units: {units}")

        if len(valid) > 0:
            print(f"  Minimum: {float(valid.min()):.4f}")
            print(f"  Maximum: {float(valid.max()):.4f}")
            print(f"  Mean   : {float(valid.mean()):.4f}")
        else:
            print("  All values are NaN / masked!")

        nan_count = int(np.isnan(arr).sum())
        total_count = arr.size
        print(f"  Missing values: {nan_count:,} / {total_count:,} ({nan_count/total_count*100:.1f}%)")

    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        default_file = Path(__file__).resolve().parent.parent / "data" / "netcdf" / "synthetic_ocean.nc"
        if default_file.exists():
            inspect_dataset(default_file)
        else:
            print("Usage: python inspect_netcdf.py <path_to_netcdf_file>")
            sys.exit(1)
    else:
        inspect_dataset(Path(sys.argv[1]))
