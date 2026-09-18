import os
import logging
import urllib.request
import json
import numpy as np
from typing import Optional, Dict, Any, List
import datetime

logger = logging.getLogger('solvx.open_meteo_adapter')

ATMOSPHERE_VARIABLES = {
    "air_temperature": {"endpoint": "weather", "param": "temperature_2m", "units": "°C"},
    "relative_humidity": {"endpoint": "weather", "param": "relative_humidity_2m", "units": "%"},
    "wind_speed": {"endpoint": "weather", "param": "wind_speed_10m", "units": "m/s"},
    "wind_direction": {"endpoint": "weather", "param": "wind_direction_10m", "units": "°"},
    "wind_stress": {"endpoint": "weather", "param": "wind_speed_10m", "units": "N/m²"},
    "sea_level_pressure": {"endpoint": "weather", "param": "surface_pressure", "units": "hPa"},
    "wave_height": {"endpoint": "marine", "param": "wave_height", "units": "m"},
    "wave_direction": {"endpoint": "marine", "param": "wave_direction", "units": "°"}
}


class OpenMeteoAdapter:
    """Official Open-Meteo Weather & Marine adapter for surface and atmospheric dynamics."""

    def __init__(self):
        self.weather_url = "https://api.open-meteo.com/v1/forecast"
        self.marine_url = "https://marine-api.open-meteo.com/v1/marine"

    def get_supported_variables(self) -> List[str]:
        return list(ATMOSPHERE_VARIABLES.keys())

    def fetch_ocean_variable(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        depth: Optional[float] = None,
        time: Optional[str] = None,
        stride: int = 1
    ) -> Dict[str, Any]:
        """Fetches a 2D spatial surface grid for atmosphere / wave variables from Open-Meteo."""
        if variable not in ATMOSPHERE_VARIABLES:
            raise ValueError(f"Variable '{variable}' not supported by OpenMeteoAdapter")

        cfg = ATMOSPHERE_VARIABLES[variable]
        units = cfg["units"]
        endpoint_type = cfg["endpoint"]
        param = cfg["param"]

        # Date range
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        if time:
            t_clean = time.replace('Z', '+00:00') if 'Z' in time else time
            try:
                dt = datetime.datetime.fromisoformat(t_clean)
                start_date = dt.strftime('%Y-%m-%d')
            except Exception:
                start_date = now_dt.strftime('%Y-%m-%d')
        else:
            start_date = now_dt.strftime('%Y-%m-%d')

        # Grid coordinates (10x10 resolution)
        grid_dim = 12
        lats = np.linspace(min_lat, max_lat, grid_dim).tolist()
        lons = np.linspace(min_lon, max_lon, grid_dim).tolist()

        flat_lats = []
        flat_lons = []
        for lt in lats:
            for ln in lons:
                flat_lats.append(round(lt, 3))
                flat_lons.append(round(ln, 3))

        url_base = self.marine_url if endpoint_type == "marine" else self.weather_url
        query_url = (
            f"{url_base}?latitude={','.join(map(str, flat_lats))}"
            f"&longitude={','.join(map(str, flat_lons))}"
            f"&hourly={param}"
            f"&start_date={start_date}&end_date={start_date}"
            f"&timezone=UTC"
        )

        try:
            req = urllib.request.Request(query_url, headers={'User-Agent': 'SolvX-Ocean-Explorer/4.0'})
            with urllib.request.urlopen(req, timeout=12) as response:
                payload = json.loads(response.read().decode())

            # Response can be a list (multi-location) or a dict (single location)
            if isinstance(payload, dict):
                locations_data = [payload]
            else:
                locations_data = payload

            # Extract middle timestamp or nearest
            grid_vals = []
            idx = 0
            for _ in lats:
                row = []
                for _ in lons:
                    if idx < len(locations_data):
                        hourly = locations_data[idx].get("hourly", {})
                        vals = hourly.get(param, [])
                        val = None
                        if vals and len(vals) > 0:
                            # Take 12:00 or current hour
                            target_h = min(12, len(vals) - 1)
                            raw_val = vals[target_h]
                            if raw_val is not None:
                                if variable == "wind_stress":
                                    # tau = C_d * rho * U^2, C_d ~ 0.0013, rho ~ 1.225
                                    val = round(0.0013 * 1.225 * (float(raw_val) ** 2), 4)
                                else:
                                    val = round(float(raw_val), 2)
                        row.append(val)
                    else:
                        row.append(None)
                    idx += 1
                grid_vals.append(row)

            # Compute min/max
            flat_valid = [v for r in grid_vals for v in r if v is not None]
            val_min = min(flat_valid) if flat_valid else 0.0
            val_max = max(flat_valid) if flat_valid else 1.0

            return {
                'provider': 'OPEN-METEO',
                'variable': variable,
                'dataset': f"open_meteo_{endpoint_type}",
                'latitude': lats,
                'longitude': lons,
                'values': grid_vals,
                'units': units,
                'min_val': val_min,
                'max_val': val_max,
                'metadata': {
                    'data_type': 'LIVE_API',
                    'retrieved_at': now_dt.isoformat(),
                    'time': start_date,
                    'endpoint': url_base
                }
            }

        except Exception as e:
            logger.error("Open-Meteo grid fetch failed for %s: %s", variable, e)
            raise RuntimeError(f"Atmospheric/marine data unavailable from Open-Meteo: {e}")

    def fetch_atmospheric_point(self, lat: float, lon: float, start_time: Optional[str] = None, end_time: Optional[str] = None) -> Dict[str, Any]:
        """Queries current point conditions from Open-Meteo weather and marine endpoints."""
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        date_str = start_time[:10] if start_time else now_dt.strftime('%Y-%m-%d')

        # 1. Weather
        w_url = (
            f"{self.weather_url}?latitude={lat:.3f}&longitude={lon:.3f}"
            f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure"
            f"&start_date={date_str}&end_date={date_str}&timezone=UTC"
        )
        # 2. Marine (Wave)
        m_url = (
            f"{self.marine_url}?latitude={lat:.3f}&longitude={lon:.3f}"
            f"&hourly=wave_height,wave_direction"
            f"&start_date={date_str}&end_date={date_str}&timezone=UTC"
        )

        res = {
            "timestamp": f"{date_str}T12:00:00Z",
            "latitude": lat,
            "longitude": lon,
            "air_temperature": None,
            "relative_humidity": None,
            "wind_speed": None,
            "wind_direction": None,
            "sea_level_pressure": None,
            "wave_height": None,
            "wave_direction": None
        }

        try:
            req = urllib.request.Request(w_url, headers={'User-Agent': 'SolvX/4.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                w_data = json.loads(resp.read().decode())
                h = w_data.get("hourly", {})
                idx = min(12, len(h.get("temperature_2m", [])) - 1)
                if idx >= 0:
                    res["air_temperature"] = h["temperature_2m"][idx]
                    res["relative_humidity"] = h["relative_humidity_2m"][idx]
                    res["wind_speed"] = h["wind_speed_10m"][idx]
                    res["wind_direction"] = h["wind_direction_10m"][idx]
                    res["sea_level_pressure"] = h["surface_pressure"][idx]
        except Exception as e:
            logger.debug("Open-Meteo weather point query failed: %s", e)

        try:
            req = urllib.request.Request(m_url, headers={'User-Agent': 'SolvX/4.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                m_data = json.loads(resp.read().decode())
                mh = m_data.get("hourly", {})
                idx = min(12, len(mh.get("wave_height", [])) - 1)
                if idx >= 0:
                    res["wave_height"] = mh["wave_height"][idx]
                    res["wave_direction"] = mh["wave_direction"][idx]
        except Exception as e:
            logger.debug("Open-Meteo marine point query failed: %s", e)

        return res
