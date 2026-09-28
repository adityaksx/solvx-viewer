"""
SolvX — Grid Indexing & Spatial Lookup Utilities
================================================
Fast vectorized coordinate-to-grid index mapping and bilinear interpolation weights
for batch processing of arbitrary observational points (e.g. Argo float trajectories).
"""

from typing import Tuple, Dict, Optional
import numpy as np

# Cache grid coordinate metadata to avoid recomputing intervals
_GRID_CACHE: Dict[str, Tuple[np.ndarray, np.ndarray, bool]] = {}


def register_grid_coordinates(grid_id: str, lats: np.ndarray, lons: np.ndarray) -> None:
    """Registers grid coordinate arrays for cached spatial indexing."""
    is_regular_1d = (lats.ndim == 1 and lons.ndim == 1)
    _GRID_CACHE[grid_id] = (np.asarray(lats, dtype=np.float64), np.asarray(lons, dtype=np.float64), is_regular_1d)


def find_nearest_indices_vectorized(
    lats: np.ndarray,
    lons: np.ndarray,
    query_lats: np.ndarray,
    query_lons: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Finds nearest row (lat) and col (lon) index for an array of query points.
    Assumes 1D monotonic lat and lon coordinate axes.
    """
    qlats = np.asarray(query_lats, dtype=np.float64)
    qlons = np.asarray(query_lons, dtype=np.float64)

    # For monotonic 1D axes, compute nearest index using searchsorted
    # Ensure lat order
    if lats[0] > lats[-1]:
        lat_idx = len(lats) - 1 - np.searchsorted(lats[::-1], qlats)
    else:
        lat_idx = np.searchsorted(lats, qlats)
    lat_idx = np.clip(lat_idx, 0, len(lats) - 1)

    # Check if neighbor is closer
    lat_idx_prev = np.clip(lat_idx - 1, 0, len(lats) - 1)
    dist_cur = np.abs(lats[lat_idx] - qlats)
    dist_prev = np.abs(lats[lat_idx_prev] - qlats)
    use_prev = dist_prev < dist_cur
    lat_idx = np.where(use_prev, lat_idx_prev, lat_idx)

    # Same for lon
    if lons[0] > lons[-1]:
        lon_idx = len(lons) - 1 - np.searchsorted(lons[::-1], qlons)
    else:
        lon_idx = np.searchsorted(lons, qlons)
    lon_idx = np.clip(lon_idx, 0, len(lons) - 1)

    lon_idx_prev = np.clip(lon_idx - 1, 0, len(lons) - 1)
    dist_cur_lon = np.abs(lons[lon_idx] - qlons)
    dist_prev_lon = np.abs(lons[lon_idx_prev] - qlons)
    use_prev_lon = dist_prev_lon < dist_cur_lon
    lon_idx = np.where(use_prev_lon, lon_idx_prev, lon_idx)

    return lat_idx, lon_idx


def bilinear_weights_vectorized(
    lats: np.ndarray,
    lons: np.ndarray,
    query_lats: np.ndarray,
    query_lons: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Computes four bounding grid cell indices (y0, y1, x0, x1) and bilinear interpolation weights
    (w00, w01, w10, w11) for all query points simultaneously.
    Returns:
        (y0, y1, x0, x1, w00, w01, w10, w11)
    """
    qlats = np.asarray(query_lats, dtype=np.float64)
    qlons = np.asarray(query_lons, dtype=np.float64)

    # Latitude bounds
    if lats[0] < lats[-1]:
        idx_y = np.searchsorted(lats, qlats) - 1
        idx_y = np.clip(idx_y, 0, len(lats) - 2)
        y0 = idx_y
        y1 = idx_y + 1
        dy = (qlats - lats[y0]) / np.maximum(lats[y1] - lats[y0], 1e-9)
    else:
        # Descending
        idx_y = len(lats) - 1 - np.searchsorted(lats[::-1], qlats)
        idx_y = np.clip(idx_y, 0, len(lats) - 2)
        y0 = idx_y
        y1 = idx_y + 1
        dy = (qlats - lats[y0]) / np.maximum(lats[y1] - lats[y0], 1e-9)

    dy = np.clip(dy, 0.0, 1.0)

    # Longitude bounds
    if lons[0] < lons[-1]:
        idx_x = np.searchsorted(lons, qlons) - 1
        idx_x = np.clip(idx_x, 0, len(lons) - 2)
        x0 = idx_x
        x1 = idx_x + 1
        dx = (qlons - lons[x0]) / np.maximum(lons[x1] - lons[x0], 1e-9)
    else:
        idx_x = len(lons) - 1 - np.searchsorted(lons[::-1], qlons)
        idx_x = np.clip(idx_x, 0, len(lons) - 2)
        x0 = idx_x
        x1 = idx_x + 1
        dx = (qlons - lons[x0]) / np.maximum(lons[x1] - lons[x0], 1e-9)

    dx = np.clip(dx, 0.0, 1.0)

    w00 = (1.0 - dx) * (1.0 - dy)
    w01 = dx * (1.0 - dy)
    w10 = (1.0 - dx) * dy
    w11 = dx * dy

    return y0, y1, x0, x1, w00, w01, w10, w11
