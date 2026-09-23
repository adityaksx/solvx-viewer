import numpy as np
from typing import Dict, Any

def compute_z_score(value: float, mean: float, std: float) -> float:
    if std == 0 or np.isnan(std):
        return 0.0
    return (value - mean) / std

def extract_spatial_features(grid_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Given a dictionary of ocean variables with 2D numpy arrays (or lists),
    computes local means, standard deviations, and spatial gradients.
    """
    features = {}
    
    for var_name, grid in grid_data.items():
        arr = np.array(grid, dtype=float)
        while arr.ndim > 2:
            arr = arr[0]
        if arr.ndim != 2 or arr.shape[0] < 2 or arr.shape[1] < 2:
            continue
            
        valid_mask = ~np.isnan(arr)
        if not np.any(valid_mask):
            continue
            
        global_mean = np.nanmean(arr)
        global_std = np.nanstd(arr)
        
        # Calculate gradients (simple 1st order differences)
        dy, dx = np.gradient(arr)
        gradient_mag = np.sqrt(dx**2 + dy**2)
        
        features[var_name] = {
            'array': arr,
            'mean': global_mean,
            'std': global_std,
            'gradient': gradient_mag
        }
        
    return features

def calculate_anomaly_grid(features: Dict[str, Any]) -> np.ndarray:
    """
    Computes a composite anomaly score (0-100) for each grid cell 
    based on the z-scores of multiple variables.
    """
    # If no features, return empty
    if not features:
        return np.array([])
        
    # Get shape from first available feature
    shape = list(features.values())[0]['array'].shape
    composite_score = np.zeros(shape)
    
    weights = {
        'temperature': 1.2,
        'salinity': 1.0,
        'currents_speed': 1.5,
        'sea_surface_height': 1.8,
        'tropical_cyclone_heat_potential': 2.0
    }
    
    total_weight = 0.0
    
    for var, data in features.items():
        if data['array'].shape != shape:
            continue
        w = weights.get(var, 1.0)
        
        # Z-score computation
        std = data['std']
        if std == 0 or np.isnan(std):
            continue
            
        z_grid = np.abs((data['array'] - data['mean']) / std)
        
        # Add to composite
        # We cap individual z-scores to 4.0 (to prevent extreme outliers dominating entirely)
        capped_z = np.clip(z_grid, 0, 4.0)
        
        composite_score += (capped_z / 4.0) * 100.0 * w
        total_weight += w

    if total_weight > 0:
        composite_score = composite_score / total_weight
        
    composite_score = np.clip(composite_score, 0, 100)
    return composite_score


# ==============================================================================
# Tabular Feature Engineering for Real ML Models (Plan.md Section 6)
# ==============================================================================

from .config import ALL_FEATURES, OCEAN_FEATURES, ATMOSPHERIC_FEATURES, TEMPORAL_FEATURES


def extract_tabular_features(
    ocean_point: Dict[str, Any],
    atmos_point: Optional[Dict[str, Any]] = None,
    temporal_history: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, float]:
    """
    Extracts a dictionary of tabular features (Ocean + Atmospheric + Temporal)
    for a single geographic point and time. Missing inputs are gracefully handled.
    """
    atmos = atmos_point or {}
    history = temporal_history or []

    # 1. Ocean features
    sst = float(ocean_point.get('sst') or ocean_point.get('ocean_temperature') or ocean_point.get('temperature') or 28.5)
    sst_anomaly = float(ocean_point.get('sst_anomaly') or ocean_point.get('temperature_anomaly') or 0.0)
    salinity = float(ocean_point.get('salinity') or 33.5)
    ssh = float(ocean_point.get('sea_surface_height') or ocean_point.get('total_sea_level') or 0.0)

    # Current speed and direction
    u = float(ocean_point.get('current_u') or ocean_point.get('uo') or 0.0)
    v = float(ocean_point.get('current_v') or ocean_point.get('vo') or 0.0)
    c_speed = float(np.sqrt(u**2 + v**2))
    c_dir = float(np.degrees(np.arctan2(v, u)) % 360.0)

    # Thermal gradient (difference between surface and subsurface/100m)
    subsurface_temp = ocean_point.get('subsurface_temp')
    if subsurface_temp is not None:
        thermal_gradient = float(sst - float(subsurface_temp))
    else:
        thermal_gradient = 7.5  # Typical tropical thermocline gradient

    # 2. Atmospheric features
    wind_speed = float(atmos.get('wind_speed') if atmos.get('wind_speed') is not None else 5.0)
    wind_dir = float(atmos.get('wind_direction') if atmos.get('wind_direction') is not None else 210.0)
    pressure = float(atmos.get('sea_level_pressure') if atmos.get('sea_level_pressure') is not None else 1010.0)
    humidity = float(atmos.get('relative_humidity') if atmos.get('relative_humidity') is not None else 75.0)

    # 3. Temporal features (lag differences and rolling stats)
    if len(history) >= 1:
        prev = history[-1]
        prev_sst = float(prev.get('sst', sst))
        prev_pres = float(prev.get('pressure', pressure))
        prev_wind = float(prev.get('wind_speed', wind_speed))

        sst_change_6h = round(sst - prev_sst, 4)
        pressure_change_6h = round(pressure - prev_pres, 4)
        wind_speed_change_6h = round(wind_speed - prev_wind, 4)
    else:
        sst_change_6h = 0.0
        pressure_change_6h = 0.0
        wind_speed_change_6h = 0.0

    if len(history) >= 3:
        sst_hist = [float(h.get('sst', sst)) for h in history[-3:]] + [sst]
        sst_rolling_std = round(float(np.std(sst_hist)), 4)
    else:
        sst_rolling_std = 0.15

    features = {
        'sst': round(sst, 4),
        'sst_anomaly': round(sst_anomaly, 4),
        'salinity': round(salinity, 4),
        'sea_surface_height': round(ssh, 4),
        'current_speed': round(c_speed, 4),
        'current_direction': round(c_dir, 4),
        'thermal_gradient': round(thermal_gradient, 4),
        'wind_speed': round(wind_speed, 4),
        'wind_direction': round(wind_dir, 4),
        'sea_level_pressure': round(pressure, 4),
        'relative_humidity': round(humidity, 4),
        'sst_change_6h': round(sst_change_6h, 4),
        'pressure_change_6h': round(pressure_change_6h, 4),
        'wind_speed_change_6h': round(wind_speed_change_6h, 4),
        'sst_rolling_std_3d': round(sst_rolling_std, 4),
    }

    return features


def vectorize_features(features_dict: Dict[str, float], feature_order: Optional[List[str]] = None) -> np.ndarray:
    """
    Converts a feature dictionary to an array in consistent feature column order.
    """
    order = feature_order or ALL_FEATURES
    return np.array([features_dict.get(k, 0.0) for k in order], dtype=np.float32)


