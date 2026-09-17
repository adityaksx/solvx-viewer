import os
import json
import logging
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any, List
import geopandas as gpd
from shapely.geometry import box, LineString, MultiLineString, Polygon, MultiPolygon

from ..config import DATA_DIR, EEZ_DATA_PATH, EEZ_BEAD_SPACING_KM, MAX_EEZ_BEADS, LOCAL_DATA_MODE, REQUEST_TIMEOUT
from ..processing.coordinate_utils import project_xy

logger = logging.getLogger('solvx.eez')


class EEZAdapter:
    """Official Marine Regions / VLIZ World EEZ v12 Boundary Adapter."""

    def __init__(self, timeout: int = REQUEST_TIMEOUT):
        self.timeout = timeout
        self.wfs_base = "https://geo.vliz.be/geoserver/MarineRegions/ows"

    def fetch_eez(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Fetches EEZ boundaries within the requested bounding box."""
        if LOCAL_DATA_MODE:
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

        return self._fetch_from_api(min_lat, max_lat, min_lon, max_lon)

    def _fetch_from_local_source(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Reads clipped EEZ features from local Marine Regions World_EEZ_v12_20231025_LR.zip."""
        eez_zip = EEZ_DATA_PATH
        if not eez_zip.exists():
            eez_zip = DATA_DIR / 'World_EEZ_v12_20231025_LR.zip'

        if not eez_zip.exists():
            return {
                'type': 'FeatureCollection',
                'source': 'Marine Regions / VLIZ (Not Found)',
                'features': [],
                'lines3d': [],
                'eezBeads': []
            }

        pad = 0.05
        b_box = (min_lon - pad, min_lat - pad, max_lon + pad, max_lat + pad)
        clip_box = box(*b_box)

        try:
            shp_path = f"zip://{eez_zip}!World_EEZ_v12_20231025_LR/eez_v12_lowres.shp"
            gdf = gpd.read_file(shp_path, bbox=b_box)

            if gdf.empty:
                return {
                    'type': 'FeatureCollection',
                    'source': 'Marine Regions / VLIZ World EEZ v12 (Low Resolution)',
                    'features': [],
                    'lines3d': [],
                    'eezBeads': []
                }

            gdf['geometry'] = gdf.geometry.intersection(clip_box)
            gdf = gdf[~gdf.geometry.is_empty]

            features = []
            lines_3d = []
            beads = []

            for _, row in gdf.iterrows():
                geom = row.geometry
                props = {
                    'name': str(row.get('GEONAME', 'Exclusive Economic Zone')),
                    'sovereign': str(row.get('SOVEREIGN1', '')),
                    'pol_type': str(row.get('POL_TYPE', '200NM')),
                    'mrgid': int(row.get('MRGID', 0)) if row.get('MRGID') else None
                }

                # Extract GeoJSON feature
                try:
                    feat_geom = json.loads(geom.to_json()) if hasattr(geom, 'to_json') else None
                except Exception:
                    feat_geom = None

                features.append({
                    'type': 'Feature',
                    'properties': props,
                    'geometry': feat_geom
                })

                # Extract 3D boundary line coordinates
                boundary_lines = self._extract_boundary_lines(geom, min_lon, max_lon, min_lat, max_lat)
                lines_3d.extend(boundary_lines)

            # Generate 3D EEZ marker beads
            beads = self._generate_beads(lines_3d)

            return {
                'type': 'FeatureCollection',
                'source': 'Marine Regions / VLIZ World EEZ v12 (Low Resolution)',
                'features': features,
                'lines3d': lines_3d,
                'eezBeads': beads,
                'metadata': {
                    'provider': 'Flanders Marine Institute (VLIZ)',
                    'dataset': 'Maritime Boundaries Geodatabase: Maritime Boundaries and Exclusive Economic Zones (200NM), version 12',
                    'citation': 'Flanders Marine Institute (2023). Maritime Boundaries Geodatabase: Maritime Boundaries and Exclusive Economic Zones (200NM), version 12. Available online at https://www.marineregions.org/'
                }
            }
        except Exception as e:
            logger.error("Failed to read local EEZ shapefile: %s", e)
            return {
                'type': 'FeatureCollection',
                'source': 'Marine Regions / VLIZ (Error)',
                'features': [],
                'lines3d': [],
                'eezBeads': []
            }

    def _fetch_from_api(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> Dict[str, Any]:
        """Queries Marine Regions WFS GeoServer for live GeoJSON."""
        try:
            params = {
                'service': 'WFS',
                'version': '1.0.0',
                'request': 'GetFeature',
                'typeName': 'MarineRegions:eez_v12_lowres',
                'outputFormat': 'application/json',
                'bbox': f"{min_lon},{min_lat},{max_lon},{max_lat}"
            }
            url = f"{self.wfs_base}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0'})

            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if 'features' in data:
                    data['source'] = 'Marine Regions / VLIZ WFS Service'
                    return data

            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)
        except Exception as e:
            logger.warning("Marine Regions WFS fetch failed: %s. Falling back to local dataset.", e)
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

    def _extract_boundary_lines(self, geom, min_lon: float, max_lon: float, min_lat: float, max_lat: float) -> List[List[List[float]]]:
        """Extracts projected 3D line coordinates from polygon boundary."""
        lines = []
        if isinstance(geom, Polygon):
            polys = [geom]
        elif isinstance(geom, MultiPolygon):
            polys = list(geom.geoms)
        elif isinstance(geom, LineString):
            polys = []
            pts = []
            for lon, lat, *_ in geom.coords:
                x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
                pts.append([round(float(x), 3), round(float(y), 3)])
            if len(pts) > 1:
                lines.append(pts)
        elif isinstance(geom, MultiLineString):
            polys = []
            for line in geom.geoms:
                pts = []
                for lon, lat, *_ in line.coords:
                    x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
                    pts.append([round(float(x), 3), round(float(y), 3)])
                if len(pts) > 1:
                    lines.append(pts)
        else:
            polys = []

        for p in polys:
            pts = []
            for lon, lat, *_ in p.exterior.coords:
                x, y = project_xy(lon, lat, min_lon, max_lon, min_lat, max_lat)
                pts.append([round(float(x), 3), round(float(y), 3)])
            if len(pts) > 1:
                lines.append(pts)

        return lines

    def _generate_beads(self, lines_list: List[List[List[float]]]) -> List[List[float]]:
        """Generates bead coordinates spaced along EEZ line strings."""
        out = []
        for line in lines_list:
            for a, b in zip(line[:-1], line[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                dist = float((dx**2 + dy**2)**0.5)
                n = max(1, int(dist // EEZ_BEAD_SPACING_KM) + 1)
                for j in range(n):
                    if len(out) >= MAX_EEZ_BEADS:
                        return out
                    t = j / n
                    out.append([round(a[0] + dx * t, 3), round(a[1] + dy * t, 3)])
        return out
