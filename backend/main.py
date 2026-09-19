from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .api import region, geography, bathymetry, ocean, observations, data, download, ml
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
from .services.cache_service import safe_open_dataset
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

# Register modular API routers
app.include_router(data.router)
app.include_router(download.router)
app.include_router(region.router)
app.include_router(geography.router)
app.include_router(bathymetry.router)
app.include_router(ocean.router)
app.include_router(ml.router)
app.include_router(observations.router)

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
            'docs': '/docs'
        }
    }

@app.get('/health')
def health():
    return {'status': 'healthy', 'version': app.version}

@app.get('/api/config')
def get_client_config():
    from .config import MAPTILER_API_KEY, LOCAL_DATA_MODE, DEFAULT_BBOX, PRESET_REGIONS
    return {
        'maptiler_api_key': MAPTILER_API_KEY,
        'local_data_mode': LOCAL_DATA_MODE,
        'default_bbox': DEFAULT_BBOX,
        'preset_regions': PRESET_REGIONS
    }

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
def legacy_ocean_point(latitude: float, longitude: float, time: Optional[str] = None):
    return get_ocean_point(latitude=latitude, longitude=longitude, time=time)

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
            with safe_open_dataset(f) as ds:
                out.append({'file': f.name, 'variables': variable_catalog(ds), 'dimensions': {k: int(v) for k, v in ds.sizes.items()}})
        except Exception as e:
            out.append({'file': f.name, 'error': str(e)})
    return {'count': len(out), 'datasets': out}

@app.get('/variables/{filename}')
def legacy_variables(filename: str):
    with safe_open_dataset(find_file(filename)) as ds:
        return {'file': filename, 'variables': variable_catalog(ds)}

@app.get('/metadata/{filename}')
def legacy_metadata(filename: str):
    with safe_open_dataset(find_file(filename)) as ds:
        coords = {}
        for n, c in ds.coords.items():
            vals = c.values
            step = max(1, vals.size // 5000)
            coords[n] = {
                'size': int(vals.size),
                'min': sanitize(vals.min()) if vals.size else None,
                'max': sanitize(vals.max()) if vals.size else None,
                'values': sanitize(vals.tolist() if n == 'time' or vals.size <= 5000 else vals[::step].tolist()),
                'units': c.attrs.get('units')
            }
        return {'file': filename, 'variables': variable_catalog(ds), 'coordinates': coords}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('backend.main:app', host='127.0.0.1', port=8000, reload=False)
