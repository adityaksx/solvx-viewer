import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("solvx.ocean_api")
from ..models.requests import RegionRequest, PointQuery
from ..services.ocean_data_service import (
    get_ocean_catalog,
    get_ocean_time,
    get_ocean_current_grid,
    get_current_field,
    get_point_profile,
    get_point_timeseries,
    get_ocean_point,
    get_region_array,
    get_ocean_depths,
    get_ocean_slice,
    get_ocean_vertical_slice
)

router = APIRouter(prefix='/api/ocean', tags=['Ocean Data'])

@router.get('/catalog')
def ocean_catalog():
    """Returns available scientific variables and their physical attributes."""
    from ..services.data_collector import COLLECTOR
    return COLLECTOR.get_variables_catalog()

@router.get('/depths')
def ocean_depths(variable: Optional[str] = None):
    """Returns available vertical depth levels for a variable or active model dataset."""
    return get_ocean_depths(variable=variable)

@router.get('/slice')
def ocean_slice(
    variable: str = Query('temperature'),
    depth: float = Query(0.0),
    time: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    stride: int = Query(1, ge=1, le=20)
):
    """Extracts a 2D horizontal field slice at a specific depth level."""
    return get_ocean_slice(
        variable=variable,
        depth=depth,
        time=time,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        stride=stride
    )

@router.get('/vertical-slice')
def ocean_vertical_slice(
    variable: str = Query('temperature'),
    time: Optional[str] = None,
    start_lat: Optional[float] = None,
    start_lon: Optional[float] = None,
    end_lat: Optional[float] = None,
    end_lon: Optional[float] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    num_points: int = Query(100, ge=2, le=500)
):
    """Extracts a 2D vertical cross-section along a geographic transect."""
    return get_ocean_vertical_slice(
        variable=variable,
        time=time,
        start_lat=start_lat,
        start_lon=start_lon,
        end_lat=end_lat,
        end_lon=end_lon,
        latitude=latitude,
        longitude=longitude,
        num_points=num_points
    )

@router.get('/time')
def ocean_time():
    """Returns available temporal coordinate steps."""
    return get_ocean_time()

@router.get('/current-grid')
def ocean_current_grid(
    time: Optional[str] = None,
    depth: Optional[float] = None,
    stride: int = Query(3, ge=1, le=20),
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
):
    """Returns horizontal ocean current velocity vectors (u, v) across the grid."""
    return get_ocean_current_grid(
        time=time,
        depth=depth,
        stride=stride,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon
    )

@router.get('/current-field')
def ocean_current_field(
    dataset: Optional[str] = None,
    variable: str = 'currents',
    time: Optional[str] = None,
    depth: Optional[float] = None,
    bbox: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    stride: int = Query(3, ge=1, le=20)
):
    """Universal endpoint for 2D/3D current vector fields meeting requirement specifications."""
    return get_current_field(
        dataset=dataset,
        variable=variable,
        time=time,
        depth=depth,
        bbox=bbox,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        stride=stride
    )

@router.get('/point')
def ocean_point(
    latitude: float = Query(...),
    longitude: float = Query(...),
    time: Optional[str] = None,
    depth: Optional[float] = None,
    variable: Optional[str] = None,
    dataset: Optional[str] = None
):
    """Point query for all physical oceanographic and atmospheric variables at a given location and depth."""
    import numpy as np
    from ..services.cache_service import GLOBAL_CACHE, make_cache_key

    cache_key = make_cache_key('ocean_point', {'lat': round(latitude, 4), 'lon': round(longitude, 4), 'time': time, 'depth': depth, 'var': variable})

    def _compute_point():
        from ..services.ocean_data_service import get_ocean_point
        base_res = get_ocean_point(latitude=latitude, longitude=longitude, time=time, depth=depth)
        val_map = {v['id']: v.get('value') for v in base_res.get('values', [])}

        u_val = None
        v_val = None
        cur_val = val_map.get('currents')
        if isinstance(cur_val, dict):
            u_val = cur_val.get('uo') or cur_val.get('u')
            v_val = cur_val.get('vo') or cur_val.get('v')

        atmos_data = {}
        try:
            from ..adapters.open_meteo_adapter import OpenMeteoAdapter
            oma = OpenMeteoAdapter()
            atmos_data = oma.fetch_atmospheric_point(latitude, longitude, time, time)
        except Exception as e:
            logger.info("Atmospheric data fetch skipped or failed at (%.2f, %.2f): %s", latitude, longitude, e)

        ocean_temp = val_map.get('temperature')
        salinity = val_map.get('salinity')
        ssh = val_map.get('sea_level') or val_map.get('sea_surface_height')

        cur_speed = float(np.hypot(u_val, v_val)) if (u_val is not None and v_val is not None) else None
        cur_dir = float((np.degrees(np.arctan2(u_val, v_val)) + 360) % 360) if (u_val is not None and v_val is not None) else None

        active_var_name = variable or 'ocean_temperature'
        active_var_val = None
        active_var_unit = ''
        if active_var_name in ('temperature', 'ocean_temperature'):
            active_var_val = ocean_temp
            active_var_unit = '°C'
        elif active_var_name in ('salinity', 'so'):
            active_var_val = salinity
            active_var_unit = 'PSU'
        elif active_var_name in ('currents', 'current_speed'):
            active_var_val = cur_speed
            active_var_unit = 'm/s'
        elif active_var_name in ('sea_surface_height', 'sea_level'):
            active_var_val = ssh
            active_var_unit = 'm'

        # Observation collocation matching
        try:
            from ..services.observation_service import ARGO_OBSERVATIONS, get_glider_observations
            all_obs = list(ARGO_OBSERVATIONS)
            try:
                gliders = get_glider_observations(
                    min_lat=latitude - 2.0, max_lat=latitude + 2.0,
                    min_lon=longitude - 2.0, max_lon=longitude + 2.0
                )
                all_obs.extend(gliders)
            except Exception:
                pass

            best_match = None
            min_dist = 999999.0

            for obs in all_obs:
                obs_lat = obs.get('latitude')
                obs_lon = obs.get('longitude')
                if obs_lat is None or obs_lon is None:
                    continue
                # Haversine formula
                R = 6371.0 # Earth radius km
                phi1, phi2 = np.radians(latitude), np.radians(obs_lat)
                dphi = np.radians(obs_lat - latitude)
                dlambda = np.radians(obs_lon - longitude)
                a = np.sin(dphi / 2.0)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0)**2
                c = 2.0 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))
                dist = R * c

                if dist < min_dist:
                    min_dist = dist
                    best_match = obs

            if best_match is not None and min_dist <= 100.0:
                obs_depth_val = depth or 0.0
                obs_temp = None
                prof = best_match.get('profile', [])
                if prof:
                    nearest_p = min(prof, key=lambda p: abs(p.get('depth', 0.0) - obs_depth_val))
                    obs_temp = nearest_p.get('temp') or nearest_p.get('temperature')

                time_diff_hours = None
                obs_time_str = best_match.get('timestamp') or best_match.get('date')
                if obs_time_str and (time or base_res.get('time')):
                    try:
                        import dateutil.parser
                        t1 = dateutil.parser.isoparse(str(time or base_res.get('time'))[:19])
                        t2 = dateutil.parser.isoparse(str(obs_time_str)[:19])
                        time_diff_hours = round(abs((t1 - t2).total_seconds()) / 3600.0, 1)
                    except Exception:
                        pass

                model_temp_val = ocean_temp
                diff_val = round(model_temp_val - obs_temp, 2) if (model_temp_val is not None and obs_temp is not None) else None
                abs_err = round(abs(diff_val), 2) if diff_val is not None else None

                base_res["nearest_observation"] = {
                    "id": str(best_match.get('id') or best_match.get('wmo') or 'OBS'),
                    "platform": best_match.get('platform') or ('Glider' if best_match.get('type') == 'glider' else 'Argo Float'),
                    "type": best_match.get('type', 'argo'),
                    "distance_km": round(min_dist, 2),
                    "time_diff_hours": time_diff_hours,
                    "timestamp": obs_time_str,
                    "latitude": round(best_match.get('latitude'), 4),
                    "longitude": round(best_match.get('longitude'), 4),
                    "model_value": model_temp_val,
                    "observed_value": obs_temp,
                    "difference": diff_val,
                    "absolute_error": abs_err,
                    "variable": "ocean_temperature",
                    "unit": "°C",
                    "matching_criteria": f"Nearest observation: Distance: {min_dist:.1f} km" + (f", Time diff: {time_diff_hours:.1f} hours" if time_diff_hours is not None else "")
                }
            else:
                base_res["nearest_observation"] = None
                base_res["observation_match_message"] = "No Argo/Glider observation satisfies the current matching criteria."
        except Exception as e:
            logger.info("Observation matching failed: %s", e)
            base_res["nearest_observation"] = None
            base_res["observation_match_message"] = "No Argo/Glider observation satisfies the current matching criteria."

        base_res.update({
            "location": {
                "latitude": latitude,
                "longitude": longitude
            },
            "time": time or base_res.get("time"),
            "depth": depth,
            "selected_variable": active_var_name,
            "selected_variable_value": active_var_val,
            "selected_variable_unit": active_var_unit,
            "available_depths": base_res.get("available_depths", []),
            "profile": base_res.get("profile", []),
            "variables": {
                "ocean_temperature": ocean_temp,
                "salinity": salinity,
                "current_u": u_val,
                "current_v": v_val,
                "current_speed": cur_speed,
                "current_direction": cur_dir,
                "sea_surface_height": ssh,
                "air_temperature": atmos_data.get("air_temperature"),
                "relative_humidity": atmos_data.get("relative_humidity"),
                "wind_speed": atmos_data.get("wind_speed"),
                "wind_direction": atmos_data.get("wind_direction"),
                "sea_level_pressure": atmos_data.get("sea_level_pressure")
            },
            "units": {
                "ocean_temperature": "°C",
                "salinity": "PSU",
                "current_u": "m/s",
                "current_v": "m/s",
                "current_speed": "m/s",
                "current_direction": "°",
                "sea_surface_height": "m",
                "air_temperature": "°C",
                "relative_humidity": "%",
                "wind_speed": "m/s",
                "wind_direction": "°",
                "sea_level_pressure": "hPa"
            }
        })
        return base_res

    return GLOBAL_CACHE.get_or_compute(cache_key, _compute_point)

@router.get('/point/profile')
def ocean_point_profile(
    latitude: float = Query(...),
    longitude: float = Query(...),
    time: Optional[str] = None,
    variable: str = Query('temperature'),
    dataset: Optional[str] = None
):
    """Returns vertical profile of variable against depth at a geographic location."""
    return get_point_profile(
        latitude=latitude,
        longitude=longitude,
        time=time,
        variable=variable,
        dataset=dataset
    )

@router.get('/point/timeseries')
def ocean_point_timeseries(
    latitude: float = Query(...),
    longitude: float = Query(...),
    depth: Optional[float] = Query(0.0),
    start: Optional[str] = None,
    end: Optional[str] = None,
    variable: str = Query('temperature'),
    dataset: Optional[str] = None
):
    """Returns temporal time series of variable values across time at a geographic point."""
    return get_point_timeseries(
        latitude=latitude,
        longitude=longitude,
        depth=depth,
        start=start,
        end=end,
        variable=variable,
        dataset=dataset
    )

@router.get('/region-array')
def ocean_region_array(
    file: str = Query(...),
    variable: str = Query(...),
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    stride: int = Query(1, ge=1, le=20)
):
    """Retrieves 3D array data for a specific NetCDF variable subset."""
    return get_region_array(
        file=file,
        variable=variable,
        lat_min=lat_min,
        lat_max=lat_max,
        lon_min=lon_min,
        lon_max=lon_max,
        depth_min=depth_min,
        depth_max=depth_max,
        time_start=time_start,
        time_end=time_end,
        stride=stride
    )

@router.post('/query')
def query_region_ocean(req: RegionRequest):
    """Retrieves multidimensional ocean data matching a RegionRequest."""
    from ..services.data_collector import COLLECTOR
    
    start_time = req.time.start if req.time else None
    end_time = req.time.end if req.time else None
    depth_val = req.depth.min if req.depth else None
    
    try:
        bundle = COLLECTOR.get_ocean_bundle(
            min_lat=req.bbox.min_lat,
            max_lat=req.bbox.max_lat,
            min_lon=req.bbox.min_lon,
            max_lon=req.bbox.max_lon,
            depth=depth_val,
            start_time=start_time,
            end_time=end_time,
            variables=req.variables or ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']
        )
        return {
            'bbox': req.bbox.model_dump(),
            'requested_variables': req.variables,
            'status': 'success',
            'data': bundle
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

