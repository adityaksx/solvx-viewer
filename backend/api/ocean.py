from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ..models.requests import RegionRequest, PointQuery
from ..services.ocean_data_service import (
    get_ocean_catalog,
    get_ocean_time,
    get_ocean_current_grid,
    get_ocean_point,
    get_region_array
)

router = APIRouter(prefix='/api/ocean', tags=['Ocean Data'])

@router.get('/catalog')
def ocean_catalog():
    """Returns available scientific variables and their physical attributes."""
    from ..services.data_collector import COLLECTOR
    return COLLECTOR.get_variables_catalog()

@router.get('/time')
def ocean_time():
    """Returns available temporal coordinate steps."""
    return get_ocean_time()

@router.get('/current-grid')
def ocean_current_grid(
    time: Optional[str] = None,
    depth: Optional[float] = None,
    stride: int = Query(3, ge=1, le=20)
):
    """Returns horizontal ocean current velocity vectors (u, v) across the grid."""
    return get_ocean_current_grid(time=time, depth=depth, stride=stride)

@router.get('/point')
def ocean_point(latitude: float = Query(...), longitude: float = Query(...), time: Optional[str] = None):
    """Point query for all physical oceanographic and atmospheric variables at a given location."""
    from ..services.cache_service import GLOBAL_CACHE, make_cache_key

    cache_key = make_cache_key('ocean_point', {'lat': round(latitude, 4), 'lon': round(longitude, 4), 'time': time})

    def _compute_point():
        from ..services.ocean_data_service import get_ocean_point
        base_res = get_ocean_point(latitude=latitude, longitude=longitude, time=time)
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
        except Exception:
            pass

        ocean_temp = val_map.get('temperature')
        salinity = val_map.get('salinity')
        ssh = val_map.get('sea_level') or val_map.get('sea_surface_height')

        base_res.update({
            "location": {
                "latitude": latitude,
                "longitude": longitude
            },
            "time": time or base_res.get("time"),
            "variables": {
                "ocean_temperature": ocean_temp,
                "salinity": salinity,
                "current_u": u_val,
                "current_v": v_val,
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

