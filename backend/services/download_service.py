"""
SolvX Download Service
======================
Manages local dataset inventory discovery, cache status checking,
and orchestrates multi-layer downloads (Land, Coastline, EEZ, Seabed, and Copernicus Ocean Variables)
with permanent disk storage.
"""

import os
import glob
import json
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import xarray as xr

from ..config import DATA_DIR, BASE_DIR, DEFAULT_BBOX
from .data_collector import COLLECTOR
from .geography_service import get_geography_data
from .bathymetry_service import get_bathymetry_data
from .cache_service import NETCDF_LOCK

logger = logging.getLogger('solvx.download_service')

EXTERNAL_DIR = DATA_DIR / 'external'
OCEAN_DIR = EXTERNAL_DIR / 'ocean'
GEOG_DIR = EXTERNAL_DIR / 'geography'
BATHY_DIR = EXTERNAL_DIR / 'bathymetry'
MODEL_DIR = DATA_DIR / 'model'

for d in (OCEAN_DIR, GEOG_DIR, BATHY_DIR):
    os.makedirs(d, exist_ok=True)


def format_bytes(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


_INVENTORY_CACHE = {'time': 0, 'data': None}


def get_download_inventory(force_refresh: bool = False) -> Dict[str, Any]:
    """Scans local disk to return an inventory of all downloaded ocean datasets, geography, and bathymetry."""
    import time
    now = time.time()
    if not force_refresh and _INVENTORY_CACHE['data'] is not None and (now - _INVENTORY_CACHE['time']) < 15:
        return _INVENTORY_CACHE['data']

    ocean_items = []
    total_bytes = 0

    # 1. Scan Copernicus NetCDF files in data/external/ocean/
    cmems_files = glob.glob(str(OCEAN_DIR / "cmems_*.nc"))
    cmems_files.sort(key=os.path.getmtime, reverse=True)

    for fpath in cmems_files:
        try:
            stat = os.stat(fpath)
            fsize = stat.st_size
            mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            fname = os.path.basename(fpath)
            total_bytes += fsize

            var_name = "ocean_variable"
            bbox = None
            time_range = None

            # Parse standardized naming: cmems_{var}_{min_lat}_{max_lat}_{min_lon}_{max_lon}_{start_date}_{end_date}.nc
            parts = fname[:-3].split('_')
            if len(parts) >= 8 and parts[0] == 'cmems':
                var_name = "_".join(parts[1:-6])
                try:
                    min_lat = float(parts[-6])
                    max_lat = float(parts[-5])
                    min_lon = float(parts[-4])
                    max_lon = float(parts[-3])
                    s_date = parts[-2]
                    e_date = parts[-1]
                    bbox = {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon}
                    time_range = {
                        'start': f"{s_date[:4]}-{s_date[4:6]}-{s_date[6:8]}",
                        'end': f"{e_date[:4]}-{e_date[4:6]}-{e_date[6:8]}"
                    }
                except Exception:
                    pass

            # If not in standardized name format, read basic metadata quickly
            if not bbox:
                try:
                    with NETCDF_LOCK:
                        with xr.open_dataset(fpath) as ds:
                            data_vars = [k for k in ds.data_vars if not k.endswith('_bnds')]
                            var_name = data_vars[0] if data_vars else 'ocean_data'
                            if 'latitude' in ds.coords and 'longitude' in ds.coords:
                                bbox = {
                                    'min_lat': round(float(ds.latitude.min()), 2),
                                    'max_lat': round(float(ds.latitude.max()), 2),
                                    'min_lon': round(float(ds.longitude.min()), 2),
                                    'max_lon': round(float(ds.longitude.max()), 2),
                                }
                            if 'time' in ds.coords and ds.time.size > 0:
                                t_min = str(ds.time.values.min())[:10]
                                t_max = str(ds.time.values.max())[:10]
                                time_range = {'start': t_min, 'end': t_max}
                except Exception:
                    pass

            ocean_items.append({
                'filename': fname,
                'path': str(fpath),
                'variable': var_name,
                'bbox': bbox,
                'time_range': time_range,
                'size_bytes': fsize,
                'size_formatted': format_bytes(fsize),
                'modified_at': mtime,
                'status': 'READY'
            })
        except Exception as err:
            logger.debug("Failed inspecting cached file %s: %s", fpath, err)

    # 2. Local High-Resolution NetCDF Models in data/model/
    model_items = []
    if MODEL_DIR.exists():
        for fpath in glob.glob(str(MODEL_DIR / "*.nc")):
            try:
                stat = os.stat(fpath)
                fsize = stat.st_size
                total_bytes += fsize
                fname = os.path.basename(fpath)
                model_items.append({
                    'filename': fname,
                    'path': str(fpath),
                    'variable': 'Bay of Bengal High-Res Model',
                    'bbox': DEFAULT_BBOX,
                    'time_range': {'start': '2024-01-01', 'end': '2026-12-31'},
                    'size_bytes': fsize,
                    'size_formatted': format_bytes(fsize),
                    'status': 'PERMANENT_LOCAL_ARCHIVE'
                })
            except Exception:
                pass

    # 3. Geography & Bathymetry saved cache
    geog_items = []
    for fpath in glob.glob(str(GEOG_DIR / "*.json")):
        try:
            stat = os.stat(fpath)
            fsize = stat.st_size
            total_bytes += fsize
            geog_items.append({
                'filename': os.path.basename(fpath),
                'path': str(fpath),
                'type': 'Land, Coastline & EEZ Geometry',
                'size_bytes': fsize,
                'size_formatted': format_bytes(fsize)
            })
        except Exception:
            pass

    bathy_items = []
    for fpath in glob.glob(str(BATHY_DIR / "*.json")):
        try:
            stat = os.stat(fpath)
            fsize = stat.st_size
            total_bytes += fsize
            bathy_items.append({
                'filename': os.path.basename(fpath),
                'path': str(fpath),
                'type': 'GEBCO Seabed Bathymetry Grid',
                'size_bytes': fsize,
                'size_formatted': format_bytes(fsize)
            })
        except Exception:
            pass

    res = {
        'summary': {
            'total_files': len(ocean_items) + len(model_items) + len(geog_items) + len(bathy_items),
            'total_size_bytes': total_bytes,
            'total_size_formatted': format_bytes(total_bytes),
            'ocean_files_count': len(ocean_items),
            'model_files_count': len(model_items),
            'geography_files_count': len(geog_items),
            'bathymetry_files_count': len(bathy_items)
        },
        'ocean_downloads': ocean_items,
        'local_models': model_items,
        'geography_downloads': geog_items,
        'bathymetry_downloads': bathy_items
    }
    _INVENTORY_CACHE['time'] = time.time()
    _INVENTORY_CACHE['data'] = res
    return res


def check_download_status(
    bbox: Dict[str, float],
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    layers: Optional[List[str]] = None,
    variables: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Checks whether the requested bbox, timeline, and layers are already stored locally."""
    min_lat = float(bbox.get('min_lat', DEFAULT_BBOX['min_lat']))
    max_lat = float(bbox.get('max_lat', DEFAULT_BBOX['max_lat']))
    min_lon = float(bbox.get('min_lon', DEFAULT_BBOX['min_lon']))
    max_lon = float(bbox.get('max_lon', DEFAULT_BBOX['max_lon']))

    target_layers = layers or ['land', 'coastline', 'eez', 'seabed', 'ocean']
    target_vars = variables or ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']

    in_bay_of_bengal = (
        min_lat >= 15.5 and max_lat <= 24.0 and
        min_lon >= 83.5 and max_lon <= 93.5
    )

    layer_statuses = {}
    missing_count = 0

    # 1. Geography: Land, Coastline, EEZ
    geog_cached = in_bay_of_bengal
    geog_path = GEOG_DIR / f"geom_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}.json"
    if geog_path.exists() and geog_path.stat().st_size > 0:
        geog_cached = True

    for l in ['land', 'coastline', 'eez']:
        if l in target_layers:
            layer_statuses[l] = {
                'cached': geog_cached,
                'source': 'local_archive' if in_bay_of_bengal else ('cached_disk' if geog_cached else 'vector_extract'),
                'label': l.capitalize()
            }
            if not geog_cached:
                missing_count += 1

    # 2. Seabed Bathymetry (GEBCO)
    bathy_cached = in_bay_of_bengal
    bathy_path = BATHY_DIR / f"bathy_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}.json"
    if bathy_path.exists() and bathy_path.stat().st_size > 0:
        bathy_cached = True

    if 'seabed' in target_layers or 'bathymetry' in target_layers:
        layer_statuses['seabed'] = {
            'cached': bathy_cached,
            'source': 'local_archive' if in_bay_of_bengal else ('cached_disk' if bathy_cached else 'gebco_grid'),
            'label': 'GEBCO Seabed'
        }
        if not bathy_cached:
            missing_count += 1

    # 3. Ocean Variables
    ocean_var_statuses = {}
    if 'ocean' in target_layers or any(v in target_vars for v in ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']):
        if in_bay_of_bengal:
            for v in target_vars:
                ocean_var_statuses[v] = {
                    'cached': True,
                    'source': 'local_archive',
                    'label': v.replace('_', ' ').title()
                }
        else:
            for v in target_vars:
                cached = COLLECTOR.copernicus.is_variable_cached(
                    variable=v,
                    min_lat=min_lat,
                    max_lat=max_lat,
                    min_lon=min_lon,
                    max_lon=max_lon,
                    time=end_time or start_time,
                    start_time=start_time,
                    end_time=end_time
                )
                ocean_var_statuses[v] = {
                    'cached': cached,
                    'source': 'copernicus_cache' if cached else 'copernicus_remote',
                    'label': v.replace('_', ' ').title()
                }
                if not cached:
                    missing_count += 1

    all_cached = (missing_count == 0)
    est_seconds = 0 if all_cached else max(5, missing_count * 4)

    return {
        'all_cached': all_cached,
        'missing_count': missing_count,
        'estimated_seconds': est_seconds,
        'layers': layer_statuses,
        'ocean_variables': ocean_var_statuses,
        'bbox': {'min_lat': min_lat, 'max_lat': max_lat, 'min_lon': min_lon, 'max_lon': max_lon}
    }


def execute_download(
    bbox: Dict[str, float],
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    layers: Optional[List[str]] = None,
    variables: Optional[List[str]] = None,
    resolution: str = 'medium'
) -> Dict[str, Any]:
    """Executes download and permanent disk storage of selected geographic, seabed, and ocean variables."""
    min_lat = float(bbox.get('min_lat', DEFAULT_BBOX['min_lat']))
    max_lat = float(bbox.get('max_lat', DEFAULT_BBOX['max_lat']))
    min_lon = float(bbox.get('min_lon', DEFAULT_BBOX['min_lon']))
    max_lon = float(bbox.get('max_lon', DEFAULT_BBOX['max_lon']))

    target_layers = layers or ['land', 'coastline', 'eez', 'seabed', 'ocean']
    target_vars = variables or ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']

    results = {}
    saved_files = []

    # 1. Land, Coastline, EEZ Geometry
    if any(l in target_layers for l in ['land', 'coastline', 'eez', 'geography']):
        try:
            geog_data = get_geography_data(min_lon, max_lon, min_lat, max_lat)
            geog_file = GEOG_DIR / f"geom_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}.json"
            with open(geog_file, 'w', encoding='utf-8') as f:
                json.dump(geog_data, f)
            saved_files.append(str(geog_file))
            results['geography'] = {'status': 'saved', 'path': str(geog_file), 'size': format_bytes(geog_file.stat().st_size)}
        except Exception as e:
            logger.error("Failed downloading geography: %s", e)
            results['geography'] = {'status': 'error', 'error': str(e)}

    # 2. Seabed Bathymetry (GEBCO)
    if any(l in target_layers for l in ['seabed', 'bathymetry']):
        try:
            bathy_data = get_bathymetry_data(min_lon, max_lon, min_lat, max_lat, resolution=resolution)
            bathy_file = BATHY_DIR / f"bathy_{min_lat:.2f}_{max_lat:.2f}_{min_lon:.2f}_{max_lon:.2f}.json"
            with open(bathy_file, 'w', encoding='utf-8') as f:
                json.dump(bathy_data, f)
            saved_files.append(str(bathy_file))
            results['seabed'] = {'status': 'saved', 'path': str(bathy_file), 'size': format_bytes(bathy_file.stat().st_size)}
        except Exception as e:
            logger.error("Failed downloading seabed bathymetry: %s", e)
            results['seabed'] = {'status': 'error', 'error': str(e)}

    # 3. Ocean Variables (Single-Pass Multi-Day Batch NetCDF Downloads)
    if 'ocean' in target_layers or any(v in target_vars for v in ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height']):
        results['ocean_variables'] = {}
        for var in target_vars:
            try:
                res = COLLECTOR.get_ocean_data(
                    provider='auto',
                    variable=var,
                    min_lat=min_lat,
                    max_lat=max_lat,
                    min_lon=min_lon,
                    max_lon=max_lon,
                    start_time=start_time,
                    end_time=end_time
                )
                cached_nc = COLLECTOR.copernicus.find_cached_file(var, min_lat, max_lat, min_lon, max_lon, start_time=start_time, end_time=end_time)
                if cached_nc:
                    saved_files.append(cached_nc)
                    results['ocean_variables'][var] = {
                        'status': 'saved',
                        'file': os.path.basename(cached_nc),
                        'path': cached_nc,
                        'size': format_bytes(os.path.getsize(cached_nc))
                    }
                else:
                    results['ocean_variables'][var] = {'status': 'completed', 'source': res.get('provider')}
            except Exception as e:
                logger.error("Failed downloading ocean variable '%s': %s", var, e)
                results['ocean_variables'][var] = {'status': 'error', 'error': str(e)}

    # Construct viewer launch URL
    viewer_url = f"/?min_lat={min_lat}&max_lat={max_lat}&min_lon={min_lon}&max_lon={max_lon}"
    if start_time:
        viewer_url += f"&time={start_time}"

    _INVENTORY_CACHE['data'] = None

    return {
        'success': True,
        'message': f"Successfully downloaded and saved {len(saved_files)} dataset file(s) to local storage.",
        'saved_files_count': len(saved_files),
        'saved_files': saved_files,
        'details': results,
        'viewer_url': viewer_url
    }
