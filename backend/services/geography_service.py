import json
from pathlib import Path
from typing import Dict, Any
import numpy as np
import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import triangulate

from ..config import (
    DATA_DIR,
    BASE_DIR,
    DEFAULT_BBOX,
    PAD,
    MAX_LAND_TRIANGLES,
    EEZ_BEAD_SPACING_KM,
    MAX_EEZ_BEADS
)
from ..processing.coordinate_utils import project_xy
from .cache_service import GLOBAL_CACHE, make_cache_key

FRONTEND_GEOM = BASE_DIR / 'frontend' / 'geometry.json'

def is_near_default(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> bool:
    b = DEFAULT_BBOX
    return (
        abs(min_lon - b['min_lon']) < 0.2 and
        abs(max_lon - b['max_lon']) < 0.2 and
        abs(min_lat - b['min_lat']) < 0.2 and
        abs(max_lat - b['max_lat']) < 0.2
    )

def ring_coords(r, min_lon, max_lon, min_lat, max_lat):
    coords = []
    for lon, lat, *_ in r.coords:
        x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
        coords.append([round(float(x), 3), round(float(y), 3)])
    return coords

def extract_polygons(gdf, min_lon, max_lon, min_lat, max_lat, limit=MAX_LAND_TRIANGLES):
    out = []
    count = 0
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            continue
        ps = [geom] if isinstance(geom, Polygon) else list(geom.geoms) if isinstance(geom, MultiPolygon) else []
        for p in ps:
            top = ring_coords(p.exterior, min_lon, max_lon, min_lat, max_lat)
            verts = []
            inds = []
            for tri in triangulate(p):
                if count >= limit:
                    break
                if not p.covers(tri):
                    continue
                base = len(verts)
                for lon, lat in list(tri.exterior.coords)[:3]:
                    x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
                    verts.append([round(float(x), 3), round(float(y), 3)])
                inds.append([base, base + 1, base + 2])
                count += 1
            if inds:
                out.append({'top': top, 'vertices': verts, 'triangles': inds})
            if count >= limit:
                break
        if count >= limit:
            break
    return out

def extract_lines(gdf, min_lon, max_lon, min_lat, max_lat):
    out = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            continue
        gt = geom.geom_type
        gs = (
            [geom] if gt == 'LineString' else
            list(geom.geoms) if gt == 'MultiLineString' else
            [geom.exterior] if gt == 'Polygon' else
            [p.exterior for p in geom.geoms] if gt == 'MultiPolygon' else []
        )
        for g in gs:
            pts = []
            for lon, lat, *_ in g.coords:
                x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
                pts.append([round(float(x), 3), round(float(y), 3)])
            if len(pts) > 1:
                out.append(pts)
    return out

def extract_beads(lines_list):
    out = []
    for line in lines_list:
        for a, b in zip(line[:-1], line[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            dist = float(np.hypot(dx, dy))
            n = max(1, int(np.ceil(dist / EEZ_BEAD_SPACING_KM)))
            for j in range(n):
                if len(out) >= MAX_EEZ_BEADS:
                    return out
                t = j / n
                out.append([round(a[0] + dx * t, 3), round(a[1] + dy * t, 3)])
    return out

def get_geography_data(min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> Dict[str, Any]:
    """Retrieves land polygons, coastline vectors, and EEZ boundary markers for any bounding box worldwide."""
    cache_key = make_cache_key('geography', {
        'min_lon': round(min_lon, 3),
        'max_lon': round(max_lon, 3),
        'min_lat': round(min_lat, 3),
        'max_lat': round(max_lat, 3)
    })
    cached = GLOBAL_CACHE.get(cache_key)
    if cached:
        return cached

    # Check for pre-built geometry for default Bay of Bengal region
    if is_near_default(min_lon, max_lon, min_lat, max_lat) and FRONTEND_GEOM.exists():
        try:
            with open(FRONTEND_GEOM, 'r', encoding='utf-8') as f:
                data = json.load(f)
                res = {
                    'bounds': data.get('bounds', [min_lon, max_lon, min_lat, max_lat]),
                    'land': data.get('land', []),
                    'islands': data.get('islands', []),
                    'coast': data.get('coast', []),
                    'landBoundary': data.get('landBoundary', []),
                    'islandCoast': data.get('islandCoast', []),
                    'eezBeads': data.get('eezBeads', [])
                }
                GLOBAL_CACHE.set(cache_key, res)
                return res
        except Exception:
            pass

    # Dynamically extract from Natural Earth vector zips
    b_box = (min_lon - PAD, min_lat - PAD, max_lon + PAD, max_lat + PAD)
    clip_box = box(*b_box)

    land_zip = DATA_DIR / 'ne_10m_land.zip'
    coast_zip = DATA_DIR / 'ne_10m_coastline.zip'
    islands_zip = DATA_DIR / 'ne_10m_minor_islands.zip'
    eez_zip = DATA_DIR / 'World_EEZ_v12_20231025_LR.zip'

    land_parts = []
    island_parts = []
    coast_lines = []
    eez_beads = []

    if land_zip.exists():
        try:
            gdf = gpd.read_file(f"zip://{land_zip}", bbox=b_box)
            if not gdf.empty:
                gdf['geometry'] = gdf.geometry.intersection(clip_box)
                gdf = gdf[~gdf.geometry.is_empty]
                land_parts = extract_polygons(gdf, min_lon, max_lon, min_lat, max_lat)
        except Exception as e:
            print(f"Error reading land_zip: {e}")

    if islands_zip.exists():
        try:
            gdf = gpd.read_file(f"zip://{islands_zip}", bbox=b_box)
            if not gdf.empty:
                gdf['geometry'] = gdf.geometry.intersection(clip_box)
                gdf = gdf[~gdf.geometry.is_empty]
                island_parts = extract_polygons(gdf, min_lon, max_lon, min_lat, max_lat, limit=5000)
        except Exception as e:
            pass

    if coast_zip.exists():
        try:
            gdf = gpd.read_file(f"zip://{coast_zip}", bbox=b_box)
            if not gdf.empty:
                gdf['geometry'] = gdf.geometry.intersection(clip_box)
                gdf = gdf[~gdf.geometry.is_empty]
                coast_lines = extract_lines(gdf, min_lon, max_lon, min_lat, max_lat)
        except Exception as e:
            print(f"Error reading coast_zip: {e}")

    if eez_zip.exists():
        try:
            gdf = gpd.read_file(f"zip://{eez_zip}", bbox=b_box)
            if not gdf.empty:
                gdf['geometry'] = gdf.geometry.intersection(clip_box)
                gdf = gdf[~gdf.geometry.is_empty]
                eez_lines = extract_lines(gdf, min_lon, max_lon, min_lat, max_lat)
                eez_beads = extract_beads(eez_lines)
        except Exception:
            pass

    result = {
        'bounds': [min_lon, max_lon, min_lat, max_lat],
        'land': land_parts,
        'islands': island_parts,
        'coast': coast_lines,
        'landBoundary': [],
        'islandCoast': [],
        'eezBeads': eez_beads
    }

    GLOBAL_CACHE.set(cache_key, result)
    return result
