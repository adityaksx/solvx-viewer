from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .api import region, geography, bathymetry, ocean, observations, data, download, ml, analysis, ai
from .services.ocean_data_service import (
    get_nc_files,
    find_file,
    get_ocean_catalog,
    get_ocean_time,
    get_ocean_current_grid,
    get_ocean_point,
    get_region_array
)
from .services.observation_service import get_observations
from .services.cache_service import safe_open_dataset, DATASET_METADATA_INDEX
from .processing.normalization import variable_catalog, sanitize

app = FastAPI(
    title='SolvX Ocean Data API',
    description='High-performance API for dynamic 3D oceanographic visualization and observation analysis',
    version='3.1.0'
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['GET', 'POST', 'OPTIONS'],
    allow_headers=['*']
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Register modular API routers
app.include_router(data.router)
app.include_router(download.router)
app.include_router(region.router)
app.include_router(geography.router)
app.include_router(bathymetry.router)
app.include_router(ocean.router)
app.include_router(ml.router)
app.include_router(observations.router)
app.include_router(analysis.router)
app.include_router(ai.router)

@app.get('/')
def root():
    return {
        'name': 'SolvX Ocean Data API',
        'status': 'running',
        'version': app.version,
        'endpoints': {
            'data': '/api/data',
            'region': '/api/region',
            'geography': '/api/geography',
            'bathymetry': '/api/bathymetry',
            'ocean': '/api/ocean',
            'observations': '/api/observations',
            'analysis': '/api/analysis',
            'ai': '/api/ai',
            'docs': '/docs'
        }
    }

@app.get('/health')
def health():
    return {'status': 'healthy', 'version': app.version}

@app.get('/api/config')
def get_client_config():
    from .config import LOCAL_DATA_MODE, DEFAULT_BBOX, PRESET_REGIONS, MAPTILER_API_KEY
    return {
        'maptiler_api_key': MAPTILER_API_KEY,
        'local_data_mode': LOCAL_DATA_MODE,
        'default_bbox': DEFAULT_BBOX,
        'preset_regions': PRESET_REGIONS
    }


@app.get('/api/current-field')
def top_level_current_field(
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
    """Direct /api/current-field endpoint fulfilling specification requirements."""
    from .api.ocean import ocean_current_field
    return ocean_current_field(
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


@app.get('/api/point')
def top_level_point(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    time: Optional[str] = None,
    depth: Optional[float] = None,
    variable: Optional[str] = None,
    dataset: Optional[str] = None
):
    """Direct /api/point inspection query endpoint fulfilling specification requirements."""
    target_lat = lat if lat is not None else latitude
    target_lon = lon if lon is not None else longitude
    if target_lat is None or target_lon is None:
        raise HTTPException(status_code=422, detail="Both 'latitude' and 'longitude' (or 'lat' and 'lon') are required.")
    from .api.ocean import ocean_point
    return ocean_point(latitude=target_lat, longitude=target_lon, time=time, depth=depth, variable=variable, dataset=dataset)


@app.get('/api/point/profile')
def top_level_point_profile(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    time: Optional[str] = None,
    variable: str = Query('temperature'),
    dataset: Optional[str] = None
):
    """Direct /api/point/profile vertical sounding query endpoint."""
    target_lat = lat if lat is not None else latitude
    target_lon = lon if lon is not None else longitude
    if target_lat is None or target_lon is None:
        raise HTTPException(status_code=422, detail="Both 'latitude' and 'longitude' (or 'lat' and 'lon') are required.")
    from .api.ocean import ocean_point_profile
    return ocean_point_profile(latitude=target_lat, longitude=target_lon, time=time, variable=variable, dataset=dataset)


@app.get('/api/point/timeseries')
def top_level_point_timeseries(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    depth: Optional[float] = Query(0.0),
    start: Optional[str] = None,
    end: Optional[str] = None,
    variable: str = Query('temperature'),
    dataset: Optional[str] = None
):
    """Direct /api/point/timeseries query endpoint."""
    target_lat = lat if lat is not None else latitude
    target_lon = lon if lon is not None else longitude
    if target_lat is None or target_lon is None:
        raise HTTPException(status_code=422, detail="Both 'latitude' and 'longitude' (or 'lat' and 'lon') are required.")
    from .api.ocean import ocean_point_timeseries
    return ocean_point_timeseries(latitude=target_lat, longitude=target_lon, depth=depth, start=start, end=end, variable=variable, dataset=dataset)


# ==============================================================================
# Backward Compatibility Layer for Legacy Routes
# ==============================================================================

@app.get('/ocean/catalog')
def legacy_ocean_catalog():
    return get_ocean_catalog()

@app.get('/ocean/time')
def legacy_ocean_time():
    return get_ocean_time()

@app.get('/ocean/current-grid')
def legacy_ocean_current_grid(time: Optional[str] = None, depth: Optional[float] = None, stride: int = 3):
    return get_ocean_current_grid(time=time, depth=depth, stride=stride)

@app.get('/ocean/point')
def legacy_ocean_point(latitude: float, longitude: float, time: Optional[str] = None, depth: Optional[float] = None):
    return get_ocean_point(latitude=latitude, longitude=longitude, time=time, depth=depth)

@app.get('/ocean/observations')
def legacy_ocean_observations(min_lon: Optional[float] = None, max_lon: Optional[float] = None, min_lat: Optional[float] = None, max_lat: Optional[float] = None):
    obs = get_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
    return {'count': len(obs), 'observations': obs}

@app.get('/data/region/array')
def legacy_get_region_array(
    file: str,
    variable: str,
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    stride: int = 1
):
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

@app.get('/datasets')
def legacy_datasets():
    out = []
    for f in get_nc_files():
        try:
            meta = DATASET_METADATA_INDEX.get_metadata(f)
            out.append({'file': f.name, 'variables': meta['variables'], 'dimensions': meta['dimensions']})
        except Exception as e:
            out.append({'file': f.name, 'error': str(e)})
    return {'count': len(out), 'datasets': out}

@app.get('/variables/{filename}')
def legacy_variables(filename: str):
    meta = DATASET_METADATA_INDEX.get_metadata(find_file(filename))
    return {'file': filename, 'variables': meta['variables']}

@app.get('/metadata/{filename}')
def legacy_metadata(filename: str):
    meta = DATASET_METADATA_INDEX.get_metadata(find_file(filename))
    return {'file': filename, 'variables': meta['variables'], 'coordinates': meta['coordinates']}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('backend.main:app', host='127.0.0.1', port=8000, reload=False)
