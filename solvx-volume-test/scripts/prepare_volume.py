#!/usr/bin/env python3
"""
Prepares datasets for solvx-volume-test:
1. Generates synthetic_ocean.nc with vertical temperature gradient and localized warm anomaly.
2. Creates symlinks or copies of real NetCDF datasets (temperature.nc, salinity.nc, etc.).
"""

import os
import shutil
import numpy as np
import xarray as xr
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "netcdf"
WORKSPACE_DIR = BASE_DIR.parent


def generate_synthetic_dataset(output_path: Path):
    """
    Generates synthetic ocean dataset following Section 45 & 46:
    T(z, x, y) = 30 - 0.02*z + 2*sin(x) + 2*cos(y)
    with +5°C warm anomaly inside a 3D subvolume.
    Dimensions: 32 depths (0 to 1000m), 90 lats (16°N to 23.5°N), 106 lons (84.1°E to 93°E)
    """
    print(f"Generating synthetic dataset at {output_path}...")
    lons = np.linspace(84.167, 92.917, 106, dtype=np.float32)
    lats = np.linspace(16.083, 23.500, 90, dtype=np.float32)
    depths = np.geomspace(1.0, 1000.0, 32).astype(np.float32)
    times = [np.datetime64("2026-09-01T12:00:00")]

    nz = len(depths)
    ny = len(lats)
    nx = len(lons)

    # Base grid
    Z = depths[:, np.newaxis, np.newaxis]
    Y = np.linspace(0, 2 * np.pi, ny)[np.newaxis, :, np.newaxis]
    X = np.linspace(0, 2 * np.pi, nx)[np.newaxis, np.newaxis, :]

    # T(z,x,y) = 30 - 0.02*z + 2*sin(x) + 2*cos(y)
    temp = 30.0 - 0.02 * Z + 2.0 * np.sin(X) + 2.0 * np.cos(Y)

    # Localized warm pool anomaly (+5.0°C)
    # z: indices 10..20, y: indices 45..65, x: indices 40..65
    temp[10:21, 45:66, 40:66] += 5.0

    # Add time dimension: (1, 32, 90, 106)
    temp_4d = temp[np.newaxis, :, :, :].astype(np.float32)

    # Synthetic salinity
    # S(z,x,y) = 32.0 + 0.003*z + 0.5*cos(X) + 0.2*sin(Y)
    sal = 32.0 + 0.003 * Z + 0.5 * np.cos(X) + 0.2 * np.sin(Y)
    sal_4d = sal[np.newaxis, :, :, :].astype(np.float32)

    ds = xr.Dataset(
        data_vars={
            "temperature": (["time", "depth", "latitude", "longitude"], temp_4d, {
                "units": "degC",
                "long_name": "Sea Water Potential Temperature (Synthetic)",
                "_FillValue": np.nan,
            }),
            "salinity": (["time", "depth", "latitude", "longitude"], sal_4d, {
                "units": "psu",
                "long_name": "Sea Water Salinity (Synthetic)",
                "_FillValue": np.nan,
            }),
        },
        coords={
            "time": ("time", times),
            "depth": ("depth", depths, {"units": "m", "positive": "down"}),
            "latitude": ("latitude", lats, {"units": "degrees_north"}),
            "longitude": ("longitude", lons, {"units": "degrees_east"}),
        },
        attrs={
            "title": "SolvX Synthetic Ocean Volume Validation Dataset",
            "institution": "SolvX Ocean Testing Team",
            "source": "Analytical test function with depth gradient and warm pool anomaly",
        }
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(output_path)
    print(f"Synthetic dataset saved: {output_path} (size: {output_path.stat().st_size / 1024:.1f} KB)")


def link_real_datasets():
    """Links or copies real NetCDF datasets into solvx-volume-test/data/netcdf/"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    candidates = [
        WORKSPACE_DIR / "data" / "model" / "temperature.nc",
        WORKSPACE_DIR / "data" / "model" / "salinity.nc",
        WORKSPACE_DIR / "data" / "external" / "ocean" / "solvx_ocean_2026-09-17_2026-09-18.nc",
    ]

    for cand in candidates:
        if cand.exists():
            target = DATA_DIR / cand.name
            if not target.exists():
                try:
                    target.symlink_to(cand)
                    print(f"Symlinked {cand.name} -> {target}")
                except OSError:
                    shutil.copy2(cand, target)
                    print(f"Copied {cand.name} -> {target}")
            else:
                print(f"Dataset {cand.name} already in place.")
        else:
            print(f"Candidate {cand} not found.")


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    synthetic_file = DATA_DIR / "synthetic_ocean.nc"
    generate_synthetic_dataset(synthetic_file)
    link_real_datasets()
    print("Dataset preparation complete!")


if __name__ == "__main__":
    main()
