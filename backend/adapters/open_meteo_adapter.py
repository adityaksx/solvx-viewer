import os
import logging
import numpy as np
from typing import Optional, Dict, Any, List
import openmeteo_requests
import requests_cache
from retry_requests import retry
import datetime

logger = logging.getLogger('solvx.open_meteo_adapter')

class OpenMeteoAdapter:
    def __init__(self):
        cache_session = requests_cache.CachedSession(
            os.path.join(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data/external/atmosphere')), 'cache'),
            expire_after=3600
        )
        retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
        self.openmeteo = openmeteo_requests.Client(session=retry_session)
        self.url = "https://api.open-meteo.com/v1/forecast"
        
    def _map_variable(self, solx_var: str) -> str:
        mapping = {
            "air_temperature": "temperature_2m",
            "relative_humidity": "relative_humidity_2m",
            "wind_speed": "wind_speed_10m",
            "wind_direction": "wind_direction_10m",
            "sea_level_pressure": "surface_pressure"
        }
        return mapping.get(solx_var, solx_var)

    def fetch_atmospheric_point(self, lat: float, lon: float, start_time: str, end_time: str) -> Dict[str, Any]:
        om_vars = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m", "surface_pressure"]
        
        start_date = start_time[:10] if start_time else datetime.datetime.now().strftime('%Y-%m-%d')
        end_date = end_time[:10] if end_time else start_date
        
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(om_vars),
            "start_date": start_date,
            "end_date": end_date,
            "timezone": "UTC"
        }
        
        try:
            responses = self.openmeteo.weather_api(self.url, params=params)
            response = responses[0]
            hourly = response.Hourly()
            
            target_ts = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00')).timestamp() if start_time else datetime.datetime.now(datetime.timezone.utc).timestamp()
            times = np.arange(hourly.Time(), hourly.TimeEnd(), hourly.Interval())
            idx = (np.abs(times - target_ts)).argmin()
            
            temp = hourly.Variables(0).ValuesAsNumpy()[idx]
            rh = hourly.Variables(1).ValuesAsNumpy()[idx]
            wind_speed = hourly.Variables(2).ValuesAsNumpy()[idx]
            wind_dir = hourly.Variables(3).ValuesAsNumpy()[idx]
            mslp = hourly.Variables(4).ValuesAsNumpy()[idx]
            
            return {
                "timestamp": datetime.datetime.fromtimestamp(times[idx], datetime.timezone.utc).isoformat(),
                "latitude": float(response.Latitude()),
                "longitude": float(response.Longitude()),
                "air_temperature": float(temp) if np.isfinite(temp) else None,
                "relative_humidity": float(rh) if np.isfinite(rh) else None,
                "wind_speed": float(wind_speed) if np.isfinite(wind_speed) else None,
                "wind_direction": float(wind_dir) if np.isfinite(wind_dir) else None,
                "sea_level_pressure": float(mslp) if np.isfinite(mslp) else None
            }
            
        except Exception as e:
            logger.error(f"Open-Meteo point fetch failed: {e}")
            raise RuntimeError(f"Atmospheric data unavailable: {e}")

    def fetch_atmospheric_grid(self, variable: str, min_lat: float, max_lat: float, min_lon: float, max_lon: float, start_time: str, end_time: str) -> Dict[str, Any]:
        om_var = self._map_variable(variable)
        start_date = start_time[:10] if start_time else datetime.datetime.now().strftime('%Y-%m-%d')
        end_date = end_time[:10] if end_time else start_date
        
        grid_size = 10
        lats = np.linspace(min_lat, max_lat, grid_size).tolist()
        lons = np.linspace(min_lon, max_lon, grid_size).tolist()
        
        flat_lats = []
        flat_lons = []
        for lat in lats:
            for lon in lons:
                flat_lats.append(lat)
                flat_lons.append(lon)
                
        params = {
            "latitude": flat_lats,
            "longitude": flat_lons,
            "hourly": om_var,
            "start_date": start_date,
            "end_date": end_date,
            "timezone": "UTC"
        }
        
        try:
            responses = self.openmeteo.weather_api(self.url, params=params)
            
            target_ts = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00')).timestamp() if start_time else datetime.datetime.now(datetime.timezone.utc).timestamp()
            
            grid_vals = []
            idx = 0
            for lat in lats:
                row = []
                for lon in lons:
                    resp = responses[idx]
                    hourly = resp.Hourly()
                    times = np.arange(hourly.Time(), hourly.TimeEnd(), hourly.Interval())
                    t_idx = (np.abs(times - target_ts)).argmin()
                    val = hourly.Variables(0).ValuesAsNumpy()[t_idx]
                    row.append(float(val) if np.isfinite(val) else None)
                    idx += 1
                grid_vals.append(row)
                
            units = {
                "air_temperature": "°C",
                "relative_humidity": "%",
                "wind_speed": "m/s",
                "wind_direction": "°",
                "sea_level_pressure": "hPa"
            }
            
            return {
                "latitude": lats,
                "longitude": lons,
                "values": grid_vals,
                "units": units.get(variable, "")
            }
        except Exception as e:
            logger.error(f"Open-Meteo grid fetch failed: {e}")
            raise RuntimeError(f"Atmospheric data unavailable: {e}")
