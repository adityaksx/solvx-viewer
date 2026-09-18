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
        
    # Apply a slight non-linear scaling to emphasize higher anomalies
    composite_score = np.power(composite_score / 100.0, 1.2) * 100.0
    composite_score = np.clip(composite_score, 0, 100)
    
    return composite_score
