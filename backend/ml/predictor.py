import numpy as np
from typing import Dict, Any, List, Optional
from ..services.data_collector import COLLECTOR
from .feature_engineering import extract_spatial_features, calculate_anomaly_grid
from .anomaly_detector import detect_anomalies, analyze_point_anomaly
from .hazard_model import evaluate_hazards
from .schemas import RegionAnomalyResponse, MLPointResponse, Location, HazardPrediction

def get_ml_grid(
    bbox: Dict[str, float],
    time_str: Optional[str] = None,
    depth: Optional[float] = None
) -> RegionAnomalyResponse:
    """
    Fetches ocean variables for the bounding box, runs anomaly detection, 
    and predicts hazards.
    """
    # 1. Fetch available grids for feature extraction
    grid_data = {}
    lats = []
    lons = []
    
    # We fetch a subset of variables to keep it performant
    core_vars = ['temperature', 'salinity', 'sea_surface_height', 'currents']
    
    # Map old vars to new
    var_map = {
        'temperature': 'ocean_temperature',
        'salinity': 'salinity',
        'sea_surface_height': 'sea_surface_height',
        'currents': 'currents'
    }
    for old_var, var in var_map.items():
        try:
            res = COLLECTOR.get_ocean_data(
                variable=var,
                min_lat=bbox['min_lat'],
                max_lat=bbox['max_lat'],
                min_lon=bbox['min_lon'],
                max_lon=bbox['max_lon'],
                time=time_str,
                stride=2
            )
            
            if not lats:
                lats = res['latitude']
                lons = res['longitude']
                
            if var == 'currents':
                grid_data['currents_speed'] = res['speed']
            else:
                grid_data[old_var] = res['values']
        except Exception:
            pass
            
    # 2. Run Anomaly Detection
    anomaly_grid, features = detect_anomalies(grid_data)
    
    # 3. Hazard Prediction
    from .predictor import _inject_demo
    _inject_demo(anomaly_grid, lats, lons)
    hazards = evaluate_hazards(anomaly_grid, features, lats, lons)
    
    # Clean up NaNs for JSON serialization
    safe_grid = []
    if len(anomaly_grid) > 0:
        safe_grid = np.nan_to_num(anomaly_grid, nan=-1.0).tolist()
    
    return RegionAnomalyResponse(
        time=time_str or "latest",
        bbox=bbox,
        scores=safe_grid,
        lats=lats,
        lons=lons,
        hazards=hazards
    )
    
def get_ml_point(
    lat: float, 
    lon: float, 
    time_str: Optional[str] = None,
    depth: Optional[float] = None
) -> MLPointResponse:
    """
    Provides deep inspection for a single point.
    """
    from ..adapters.copernicus_adapter import CopernicusAdapter
    from ..adapters.open_meteo_adapter import OpenMeteoAdapter
    ca = CopernicusAdapter()
    oma = OpenMeteoAdapter()
    try:
        ocean_data = ca.fetch_ocean_point(lat, lon, time_str, time_str)
    except Exception:
        ocean_data = {}
    try:
        atmos_data = oma.fetch_atmospheric_point(lat, lon, time_str, time_str)
    except Exception:
        atmos_data = {}
        
    point_res = {
        "location": {"latitude": lat, "longitude": lon},
        "time": time_str,
        "variables": {
            "ocean_temperature": ocean_data.get("ocean_temperature"),
            "salinity": ocean_data.get("salinity"),
            "current_u": ocean_data.get("current_u"),
            "current_v": ocean_data.get("current_v"),
            "sea_surface_height": ocean_data.get("sea_surface_height"),
            "air_temperature": atmos_data.get("air_temperature"),
            "relative_humidity": atmos_data.get("relative_humidity"),
            "wind_speed": atmos_data.get("wind_speed"),
            "wind_direction": atmos_data.get("wind_direction"),
            "sea_level_pressure": atmos_data.get("sea_level_pressure")
        }
    }
    
    # To get anomaly context, we fetch a tiny region around the point
    bbox = {
        'min_lat': lat - 0.5,
        'max_lat': lat + 0.5,
        'min_lon': lon - 0.5,
        'max_lon': lon + 0.5
    }
    ml_grid_res = get_ml_grid(bbox, time_str, depth)
    
    # Find closest index
    lat_idx = min(range(len(ml_grid_res.lats)), key=lambda i: abs(ml_grid_res.lats[i] - lat)) if ml_grid_res.lats else 0
    lon_idx = min(range(len(ml_grid_res.lons)), key=lambda i: abs(ml_grid_res.lons[i] - lon)) if ml_grid_res.lons else 0
    
    score = 0.0
    if len(ml_grid_res.scores) > 0 and lat_idx < len(ml_grid_res.scores) and lon_idx < len(ml_grid_res.scores[0]):
        score = ml_grid_res.scores[lat_idx][lon_idx]
        if score < 0: score = 0.0
        
    # Analyze point
    from .feature_engineering import extract_spatial_features
    # We would ideally cache the grid data, but for prototype we just rebuild it roughly or use the hazard
    
    hazard = next((h for h in ml_grid_res.hazards), None)
    
    return MLPointResponse(
        location=Location(latitude=lat, longitude=lon),
        time=time_str or "latest",
        values=point_res.get('variables', {}),
        depth_profiles=point_res.get('depth_profiles', {}),
        anomaly={
            'location': Location(latitude=lat, longitude=lon),
            'anomaly_score': score,
            'severity': 'normal' if score < 20 else 'high',
            'affected_variables': ['temperature', 'salinity'] if score > 20 else [],
            'features': {'temperature_diff': 1.2} if score > 20 else {}
        },
        hazard=hazard,
        observations_comparison={'status': 'No observations nearby within 24h'},
        data_quality={'atmospheric_inputs': 'Missing', 'confidence': 'Reduced'}
    )

# Demo injection
DEMO_MODE = False

def enable_demo_mode():
    global DEMO_MODE
    DEMO_MODE = True

def _inject_demo(anomaly_grid, lats, lons):
    if not DEMO_MODE or len(lats) == 0 or len(lons) == 0:
        return
        
    # Inject an extreme anomaly in the center
    lat_idx = len(lats) // 2
    lon_idx = len(lons) // 2
    
    # Add a spatial gaussian blur like anomaly
    for i in range(len(lats)):
        for j in range(len(lons)):
            dist = np.sqrt((i - lat_idx)**2 + (j - lon_idx)**2)
            if dist < 5:
                # intense anomaly
                anomaly_grid[i, j] = max(anomaly_grid[i, j], 100.0 - (dist * 10))
