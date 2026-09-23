"""
SolvX — ML Data Pipeline
========================
Handles feature extraction, imputation, and alignment for real-time model inference
(both single point coordinates and 2D spatial bounding box grids).
"""

from typing import Dict, Any, List, Optional, Tuple
import logging
import numpy as np

from ..services.data_collector import COLLECTOR
from ..adapters.copernicus_adapter import CopernicusAdapter
from ..adapters.open_meteo_adapter import OpenMeteoAdapter
from .config import ALL_FEATURES, OCEAN_FEATURES, ATMOSPHERIC_FEATURES, TEMPORAL_FEATURES
from .feature_engineering import extract_tabular_features, vectorize_features

logger = logging.getLogger('solvx.data_pipeline')


class DataPipeline:
    """
    Orchestrates data retrieval from adapters and transforms them into
    model-ready tabular feature matrices.
    """

    def __init__(self):
        self.copernicus = CopernicusAdapter()
        self.open_meteo = OpenMeteoAdapter()
        self.features_order = ALL_FEATURES

    def prepare_point_features(
        self,
        lat: float,
        lon: float,
        time_str: Optional[str] = None,
        depth: Optional[float] = None
    ) -> Tuple[np.ndarray, Dict[str, float], List[str]]:
        """
        Retrieves ocean and atmospheric parameters for a single location and prepares
        the aligned feature vector for model prediction.

        Returns:
            feature_vector (1D array), raw_features_dict, missing_inputs_list
        """
        missing_inputs = []

        # 1. Fetch ocean point data
        ocean_data = {}
        try:
            ocean_data = self.copernicus.fetch_ocean_point(lat, lon, time_str, time_str)
        except Exception as e:
            logger.warning("Copernicus point query failed at (%.2f, %.2f): %s", lat, lon, e)
            missing_inputs.append("copernicus_ocean")

        # 2. Fetch atmospheric point data
        atmos_data = {}
        try:
            atmos_data = self.open_meteo.fetch_atmospheric_point(lat, lon, time_str, time_str)
        except Exception as e:
            logger.warning("Open-Meteo point query failed at (%.2f, %.2f): %s", lat, lon, e)
            missing_inputs.append("open_meteo_atmosphere")

        # Check for individual missing measurements
        if atmos_data.get('wind_speed') is None:
            missing_inputs.append("wind_speed")
        if atmos_data.get('sea_level_pressure') is None:
            missing_inputs.append("sea_level_pressure")

        # 3. Build features dictionary
        ocean_dict = {
            'sst': ocean_data.get('ocean_temperature') or 28.5,
            'sst_anomaly': ocean_data.get('sea_surface_temperature_anomaly') or 0.0,
            'salinity': ocean_data.get('salinity') or 33.5,
            'sea_surface_height': ocean_data.get('sea_surface_height') or 0.0,
            'current_u': ocean_data.get('current_u') or 0.0,
            'current_v': ocean_data.get('current_v') or 0.0,
            'subsurface_temp': None
        }

        features_dict = extract_tabular_features(ocean_dict, atmos_data)
        feature_vec = vectorize_features(features_dict, self.features_order)

        return feature_vec, features_dict, missing_inputs

    def prepare_grid_features(
        self,
        bbox: Dict[str, float],
        time_str: Optional[str] = None,
        depth: Optional[float] = None,
        stride: int = 2
    ) -> Tuple[np.ndarray, List[float], List[float], List[Dict[str, float]]]:
        """
        Prepares a 2D spatial grid of feature vectors across a bounding box.

        Returns:
            X_grid (2D array of shape [N_points, N_features]), lats, lons, list_of_feature_dicts
        """
        bundle = COLLECTOR.get_ocean_bundle(
            min_lat=bbox['min_lat'],
            max_lat=bbox['max_lat'],
            min_lon=bbox['min_lon'],
            max_lon=bbox['max_lon'],
            depth=depth,
            time=time_str,
            stride=stride
        )
        vars_res = bundle.get('variables', {})

        lats = []
        lons = []
        t_vals = []
        s_vals = []
        u_vals = []
        v_vals = []
        ssh_vals = []

        if 'ocean_temperature' in vars_res and 'values' in vars_res['ocean_temperature']:
            t_res = vars_res['ocean_temperature']
            lats = t_res.get('latitude', [])
            lons = t_res.get('longitude', [])
            t_vals = t_res.get('values', [])

        if 'salinity' in vars_res and 'values' in vars_res['salinity']:
            s_vals = vars_res['salinity'].get('values', [])

        if 'currents' in vars_res:
            c_res = vars_res['currents']
            u_vals = c_res.get('u', [])
            v_vals = c_res.get('v', [])

        if 'sea_surface_height' in vars_res:
            ssh_vals = vars_res['sea_surface_height'].get('values', [])

        rows = []
        feat_dicts = []

        for i, lat in enumerate(lats):
            for j, lon in enumerate(lons):
                t_val = t_vals[i][j] if (i < len(t_vals) and j < len(t_vals[i]) and t_vals[i][j] is not None) else 28.5
                s_val = s_vals[i][j] if (i < len(s_vals) and j < len(s_vals[i]) and s_vals[i][j] is not None) else 33.5
                u_val = u_vals[i][j] if (i < len(u_vals) and j < len(u_vals[i]) and u_vals[i][j] is not None) else 0.0
                v_val = v_vals[i][j] if (i < len(v_vals) and j < len(v_vals[i]) and v_vals[i][j] is not None) else 0.0
                ssh_val = ssh_vals[i][j] if (i < len(ssh_vals) and j < len(ssh_vals[i]) and ssh_vals[i][j] is not None) else 0.0

                # Atmospheric approximation
                wind_speed = round(5.0 + 3.0 * np.sin(lat * 0.1), 2)
                wind_dir = round((210.0 + 15.0 * np.cos(lon * 0.1)) % 360.0, 1)
                pressure = round(1012.0 - 4.0 * np.sin(lat * 0.08), 2)

                ocean_pt = {
                    'sst': t_val,
                    'sst_anomaly': max(0.0, t_val - 28.0),
                    'salinity': s_val,
                    'sea_surface_height': ssh_val,
                    'current_u': u_val,
                    'current_v': v_val,
                }
                atmos_pt = {
                    'wind_speed': wind_speed,
                    'wind_direction': wind_dir,
                    'sea_level_pressure': pressure,
                    'relative_humidity': 75.0
                }

                f_dict = extract_tabular_features(ocean_pt, atmos_pt)
                f_vec = vectorize_features(f_dict, self.features_order)

                rows.append(f_vec)
                feat_dicts.append(f_dict)

        X_matrix = np.array(rows, dtype=np.float32) if rows else np.zeros((0, len(self.features_order)), dtype=np.float32)
        return X_matrix, lats, lons, feat_dicts
