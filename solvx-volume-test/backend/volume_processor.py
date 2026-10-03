"""
Volume Preprocessor for SolvX NetCDF data.
Handles subsetting, downsampling, axis alignment, NaN masking,
normalization, and binary float32 serialization.
Follows Sections 11, 12, 13, 14, 15, 16, 36, 37.
"""

from typing import Dict, Any, Optional, Tuple, List
import numpy as np
import xarray as xr


class VolumeProcessor:
    @staticmethod
    def extract_3d_volume(
        ds: xr.Dataset,
        variable_name: str,
        detected_dims: Dict[str, str],
        time_index: int = 0,
        lat_min: Optional[float] = None,
        lat_max: Optional[float] = None,
        lon_min: Optional[float] = None,
        lon_max: Optional[float] = None,
        depth_min: Optional[float] = None,
        depth_max: Optional[float] = None,
        stride: int = 1,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Extracts, subsets, downsamples, and canonicalizes a 3D scalar volume.
        Returns:
            volume_normalized (float32 array of shape [Nz, Ny, Nx], range [0.0, 1.0], NaN=0.0)
            metadata (dict with physical range, shape, axis order, coordinates)
        """
        if variable_name not in ds.data_vars:
            raise KeyError(f"Variable '{variable_name}' not found in dataset variables: {list(ds.data_vars.keys())}")

        da = ds[variable_name]
        lat_dim = detected_dims["latitude"]
        lon_dim = detected_dims["longitude"]
        depth_dim = detected_dims.get("depth")
        time_dim = detected_dims.get("time")

        # 1. Handle Time (Section 11)
        if time_dim and time_dim in da.dims:
            num_times = da.sizes[time_dim]
            safe_time_idx = max(0, min(time_index, num_times - 1))
            da = da.isel({time_dim: safe_time_idx})

        # 2. Geographic & Depth Subsetting (Section 13)
        # Handle coordinate ascending vs descending
        if lat_min is not None or lat_max is not None:
            lats = ds.coords[lat_dim].values
            if len(lats) > 1 and lats[0] > lats[-1]:
                # Descending latitudes
                s_min = lat_max if lat_max is not None else float(lats.min())
                s_max = lat_min if lat_min is not None else float(lats.max())
                da = da.sel({lat_dim: slice(s_min, s_max)})
            else:
                s_min = lat_min if lat_min is not None else float(lats.min())
                s_max = lat_max if lat_max is not None else float(lats.max())
                da = da.sel({lat_dim: slice(s_min, s_max)})

        if lon_min is not None or lon_max is not None:
            lons = ds.coords[lon_dim].values
            s_min = lon_min if lon_min is not None else float(lons.min())
            s_max = lon_max if lon_max is not None else float(lons.max())
            da = da.sel({lon_dim: slice(s_min, s_max)})

        if depth_dim and depth_dim in da.dims and (depth_min is not None or depth_max is not None):
            depths = ds.coords[depth_dim].values
            d_min = depth_min if depth_min is not None else float(depths.min())
            d_max = depth_max if depth_max is not None else float(depths.max())
            da = da.sel({depth_dim: slice(d_min, d_max)})

        # 3. Canonical Transpose to [depth, latitude, longitude] (Section 14)
        if depth_dim and depth_dim in da.dims:
            da = da.transpose(depth_dim, lat_dim, lon_dim)
            # Ensure physical vertical levels are uniformly spaced for 3D GPU ray-marching
            z_coords = np.asarray(da.coords[depth_dim].values, dtype=np.float32)
            if len(z_coords) > 3:
                z_diffs = np.diff(z_coords)
                if not np.allclose(z_diffs, z_diffs[0], rtol=0.15):
                    uniform_z = np.linspace(float(z_coords.min()), float(z_coords.max()), len(z_coords), dtype=np.float32)
                    da = da.interp({depth_dim: uniform_z}, method="linear")
        else:
            # 2D field, expand depth dimension to 1
            da = da.transpose(lat_dim, lon_dim)
            da = da.expand_dims(dim="depth", axis=0)

        # 4. Downsampling (Section 36)
        if stride > 1:
            # Apply stride to lat and lon, and optionally depth if depth > 10
            z_stride = stride if da.sizes[da.dims[0]] > 16 else 1
            da = da.isel({
                da.dims[0]: slice(None, None, z_stride),
                da.dims[1]: slice(None, None, stride),
                da.dims[2]: slice(None, None, stride)
            })

        # Load values into numpy float32
        raw_values = np.asarray(da.values, dtype=np.float32)

        # 5. Extract Extents & Coordinates
        final_lats = [float(x) for x in da.coords[lat_dim].values]
        final_lons = [float(x) for x in da.coords[lon_dim].values]
        if depth_dim and depth_dim in da.coords:
            final_depths = [float(x) for x in da.coords[depth_dim].values]
        else:
            final_depths = [0.0]

        nz, ny, nx = raw_values.shape

        # 6. NaN Handling and Normalization (Section 15 & 16)
        valid_mask = np.isfinite(raw_values)
        nan_count = int((~valid_mask).sum())
        total_voxels = raw_values.size

        if np.any(valid_mask):
            phys_min = float(raw_values[valid_mask].min())
            phys_max = float(raw_values[valid_mask].max())
            phys_mean = float(raw_values[valid_mask].mean())
        else:
            phys_min = 0.0
            phys_max = 1.0
            phys_mean = 0.5

        # Normalization: map valid values to [0.02, 1.0] so that 0.0 is strictly reserved
        # for transparent/masked/land regions (cutoff in shader is ~0.01)
        normalized = np.zeros_like(raw_values, dtype=np.float32)
        val_range = max(phys_max - phys_min, 1e-6)

        if np.any(valid_mask):
            # Scale from 0.02 to 1.0
            normalized[valid_mask] = 0.02 + 0.98 * ((raw_values[valid_mask] - phys_min) / val_range)

        # Metadata dictionary
        meta = {
            "variable": variable_name,
            "units": da.attrs.get("units", ""),
            "long_name": da.attrs.get("long_name", variable_name),
            "shape": [int(nz), int(ny), int(nx)],
            "axis_order": ["depth", "latitude", "longitude"],
            "dimensions": {
                "depth": int(nz),
                "latitude": int(ny),
                "longitude": int(nx),
            },
            "physical_range": {
                "min": phys_min,
                "max": phys_max,
                "mean": phys_mean,
            },
            "bounds": {
                "lat_min": float(min(final_lats)),
                "lat_max": float(max(final_lats)),
                "lon_min": float(min(final_lons)),
                "lon_max": float(max(final_lons)),
                "depth_min": float(min(final_depths)),
                "depth_max": float(max(final_depths)),
            },
            "coordinates": {
                "latitudes": final_lats,
                "longitudes": final_lons,
                "depth_levels": final_depths,
            },
            "missing_values": {
                "count": nan_count,
                "total": total_voxels,
                "percent": float(nan_count / total_voxels * 100) if total_voxels > 0 else 0.0,
            },
            "dtype": "float32",
            "stride": stride,
        }

        return normalized, meta

    @staticmethod
    def sample_point(
        ds: xr.Dataset,
        variable_name: str,
        detected_dims: Dict[str, str],
        lat: float,
        lon: float,
        depth: Optional[float] = None,
        time_index: int = 0,
    ) -> Dict[str, Any]:
        """
        Samples an exact point from the dataset using nearest-neighbor / interpolation (Section 40).
        Used by the interactive mouse probe to verify GPU visual values against ground truth scientific data.
        """
        if variable_name not in ds.data_vars:
            raise KeyError(f"Variable '{variable_name}' not found.")

        da = ds[variable_name]
        lat_dim = detected_dims["latitude"]
        lon_dim = detected_dims["longitude"]
        depth_dim = detected_dims.get("depth")
        time_dim = detected_dims.get("time")

        if time_dim and time_dim in da.dims:
            safe_time = max(0, min(time_index, da.sizes[time_dim] - 1))
            da = da.isel({time_dim: safe_time})

        sel_dict = {
            lat_dim: lat,
            lon_dim: lon,
        }
        if depth_dim and depth_dim in da.dims and depth is not None:
            sel_dict[depth_dim] = depth

        nearest = da.sel(sel_dict, method="nearest")
        val = float(nearest.values) if np.isfinite(nearest.values) else None

        actual_lat = float(nearest.coords[lat_dim].values)
        actual_lon = float(nearest.coords[lon_dim].values)
        actual_depth = float(nearest.coords[depth_dim].values) if depth_dim and depth_dim in nearest.coords else 0.0

        return {
            "requested": {"latitude": lat, "longitude": lon, "depth": depth},
            "matched": {"latitude": actual_lat, "longitude": actual_lon, "depth": actual_depth},
            "variable": variable_name,
            "value": val,
            "units": da.attrs.get("units", ""),
            "is_valid": val is not None,
        }
