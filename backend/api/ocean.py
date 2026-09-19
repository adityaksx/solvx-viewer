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
def ocean_point(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    time: Optional[str] = None
):
    """Inspects all physical ocean variables at a specific geographic point."""
    from ..adapters.copernicus_adapter import CopernicusAdapter
    from ..adapters.open_meteo_adapter import OpenMeteoAdapter
    
    ca = CopernicusAdapter()
    oma = OpenMeteoAdapter()
    
    # We use time for both start and end to get nearest
    start_time = time
    end_time = time
    
    try:
        ocean_data = ca.fetch_ocean_point(latitude, longitude, start_time, end_time)
    except Exception as e:
        ocean_data = {}

    # Supplement with local model data if live values are missing
    try:
        local_point = get_ocean_point(latitude, longitude, time)
        for item in local_point.get('variables', []):
            vid = item.get('id')
            val = item.get('value')
            if val is not None:
                if vid == 'temperature' and ocean_data.get('ocean_temperature') is None:
                    ocean_data['ocean_temperature'] = val
                elif vid == 'salinity' and ocean_data.get('salinity') is None:
                    ocean_data['salinity'] = val
                elif vid in ('sea_level', 'sea_surface_height') and ocean_data.get('sea_surface_height') is None:
                    ocean_data['sea_surface_height'] = val
                elif vid == 'currents' and (ocean_data.get('current_u') is None or ocean_data.get('current_v') is None):
                    ocean_data['current_u'] = item.get('u', 0.0)
                    ocean_data['current_v'] = item.get('v', 0.0)
    except Exception as e:
        pass
        
    try:
        atmos_data = oma.fetch_atmospheric_point(latitude, longitude, start_time, end_time)
    except Exception as e:
        atmos_data = {}
        
    return {
        "location": {
            "latitude": latitude,
            "longitude": longitude
        },
        "time": ocean_data.get("timestamp") or atmos_data.get("timestamp") or time,
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
    }

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

