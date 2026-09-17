import numpy as np

KM_PER_DEG_LAT = 111.32

def validate_coords(lat: float, lon: float):
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"Invalid latitude {lat}: must be between -90 and 90")
    if not (-180.0 <= lon <= 180.0):
        raise ValueError(f"Invalid longitude {lon}: must be between -180 and 180")

def normalize_lon(lon: float) -> float:
    """Normalize longitude to [-180, 180]."""
    while lon > 180.0:
        lon -= 360.0
    while lon < -180.0:
        lon += 360.0
    return lon

def get_region_projection(min_lon: float, max_lon: float, min_lat: float, max_lat: float):
    """Calculates scaling factors and centers for a regional Cartesian projection."""
    mid_lat = (min_lat + max_lat) / 2.0
    mid_lon = (min_lon + max_lon) / 2.0
    klat = KM_PER_DEG_LAT
    klon = KM_PER_DEG_LAT * np.cos(np.deg2rad(mid_lat))
    return mid_lon, mid_lat, klon, klat

def project_xy(lon, lat, min_lon: float, max_lon: float, min_lat: float, max_lat: float):
    """Converts geographic (lon, lat) to local Cartesian (Easting, Northing) in kilometers."""
    mid_lon, mid_lat, klon, klat = get_region_projection(min_lon, max_lon, min_lat, max_lat)
    x = (np.asarray(lon) - mid_lon) * klon
    y = (np.asarray(lat) - mid_lat) * klat
    return x, y

def unproject_xy(x, y, min_lon: float, max_lon: float, min_lat: float, max_lat: float):
    """Converts local Cartesian (Easting, Northing) in kilometers back to geographic (lon, lat)."""
    mid_lon, mid_lat, klon, klat = get_region_projection(min_lon, max_lon, min_lat, max_lat)
    lon = (np.asarray(x) / (klon if abs(klon) > 1e-6 else 1.0)) + mid_lon
    lat = (np.asarray(y) / klat) + mid_lat
    return lon, lat
