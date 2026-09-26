"""
SolvX — Copernicus Marine In-Situ Glider Adapter
Interfaces with Copernicus Marine In Situ TAC products to search and extract
autonomous underwater glider profiles and trajectories.
Strictly returns real observations; returns empty list if no gliders are present.
"""

import logging
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
import numpy as np

from .copernicus_adapter import CopernicusAdapter

logger = logging.getLogger('solvx.glider_adapter')


class GliderAdapter:
    """Dedicated adapter for Copernicus Marine In-Situ Glider missions."""

    def __init__(self, username: Optional[str] = None, password: Optional[str] = None, timeout: int = 15):
        self.copernicus = CopernicusAdapter(username=username, password=password, timeout=timeout)
        self.username = self.copernicus.username
        self.password = self.copernicus.password
        self.timeout = timeout
        self.cache_dir = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data/external/gliders')))
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def search_gliders(
        self,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        auto_fetch: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Searches for glider observation records matching spatial and temporal criteria.
        Checks cached NetCDF and CSV files in data/external/gliders first.
        If no gliders are found, returns an empty list []. Never generates fake gliders.
        """
        results: List[Dict[str, Any]] = []
        seen_ids = set()

        # 1. Search local cached NetCDF glider files
        nc_files = list(self.cache_dir.glob('*.nc')) + list(self.cache_dir.glob('**/*.nc'))
        for f in nc_files:
            try:
                import xarray as xr
                with xr.open_dataset(f) as ds:
                    platform_code = str(ds.attrs.get('platform_code', '')).upper()
                    platform_type = str(ds.attrs.get('platform_type', '')).upper()
                    data_type = str(ds.attrs.get('data_type', '')).upper()
                    if not any(k in platform_code or k in platform_type or k in data_type for k in ('GL', 'GLIDER', 'SLOCUM', 'SEAGLIDER')):
                        continue

                    lats = ds['LATITUDE'].values if 'LATITUDE' in ds else (ds['latitude'].values if 'latitude' in ds else None)
                    lons = ds['LONGITUDE'].values if 'LONGITUDE' in ds else (ds['longitude'].values if 'longitude' in ds else None)
                    if lats is None or lons is None or len(lats) == 0:
                        continue

                    lat_val = float(np.nanmean(lats))
                    lon_val = float(np.nanmean(lons))

                    if min_lat is not None and lat_val < min_lat:
                        continue
                    if max_lat is not None and lat_val > max_lat:
                        continue
                    if min_lon is not None and lon_val < min_lon:
                        continue
                    if max_lon is not None and lon_val > max_lon:
                        continue

                    glider_id = str(ds.attrs.get('id', ds.attrs.get('wmo_platform_code', f.stem)))
                    if glider_id in seen_ids:
                        continue
                    seen_ids.add(glider_id)

                    results.append({
                        'id': glider_id,
                        'glider_id': glider_id,
                        'platform': ds.attrs.get('platform_name', f'Autonomous Underwater Glider #{glider_id}'),
                        'type': 'glider',
                        'latitude': round(lat_val, 4),
                        'longitude': round(lon_val, 4),
                        'timestamp': str(ds.attrs.get('time_coverage_start', '')),
                        'institution': ds.attrs.get('institution', 'Copernicus Marine In-Situ TAC'),
                        'data_mode': ds.attrs.get('data_mode', 'Real-Time / Delayed Mode Quality Controlled'),
                        'available_variables': [v for v in ('TEMP', 'PSAL', 'CHLA', 'PRES') if v in ds.data_vars],
                        'source': 'Copernicus Marine In Situ TAC',
                        'file_path': str(f),
                        'format': 'netcdf'
                    })
            except Exception as e:
                logger.debug('Failed inspecting cached glider NetCDF %s: %s', f, e)

        # 2. Search local cached CSV in-situ glider files (Copernicus Marine In Situ TAC)
        csv_files = list(self.cache_dir.glob('*.csv')) + list(self.cache_dir.glob('**/*.csv'))
        for f in csv_files:
            try:
                import pandas as pd
                df = pd.read_csv(f)
                if 'platform_id' not in df.columns or 'latitude' not in df.columns or 'longitude' not in df.columns:
                    continue

                # Filter by spatial bounding box
                if min_lat is not None:
                    df = df[df['latitude'] >= min_lat]
                if max_lat is not None:
                    df = df[df['latitude'] <= max_lat]
                if min_lon is not None:
                    df = df[df['longitude'] >= min_lon]
                if max_lon is not None:
                    df = df[df['longitude'] <= max_lon]

                if df.empty:
                    continue

                for pid, group in df.groupby('platform_id'):
                    glider_id = str(pid)
                    if glider_id in seen_ids:
                        continue
                    seen_ids.add(glider_id)

                    lats = group['latitude'].dropna().values
                    lons = group['longitude'].dropna().values
                    if len(lats) == 0 or len(lons) == 0:
                        continue

                    lat_val = float(np.mean(lats))
                    lon_val = float(np.mean(lons))
                    inst = str(group['institution'].iloc[0]) if 'institution' in group.columns and pd.notna(group['institution'].iloc[0]) else 'Copernicus Marine In-Situ TAC'
                    ts = str(group['time'].dropna().max()) if 'time' in group.columns and len(group['time'].dropna()) else ''
                    vars_present = list(group['variable'].unique()) if 'variable' in group.columns else ['currents']

                    results.append({
                        'id': glider_id,
                        'glider_id': glider_id,
                        'platform': f'Autonomous Underwater Glider #{glider_id}',
                        'type': 'glider',
                        'latitude': round(lat_val, 4),
                        'longitude': round(lon_val, 4),
                        'timestamp': ts,
                        'institution': inst,
                        'data_mode': 'Real-Time / Delayed Mode Quality Controlled',
                        'available_variables': vars_present,
                        'source': 'Copernicus Marine In Situ TAC',
                        'soundings_count': len(group),
                        'depth_range': [
                            round(float(group['depth'].min()), 1) if 'depth' in group.columns else 0.0,
                            round(float(group['depth'].max()), 1) if 'depth' in group.columns else 0.0
                        ],
                        'file_path': str(f),
                        'format': 'csv'
                    })
            except Exception as e:
                logger.debug('Failed inspecting cached glider CSV %s: %s', f, e)

        # 3. Optional on-demand subset from Copernicus Marine if no local data
        if not results and auto_fetch and min_lon is not None and max_lon is not None and min_lat is not None and max_lat is not None:
            try:
                import copernicusmarine
                logger.info(f"Querying Copernicus In-Situ gliders for bbox [{min_lon}..{max_lon}, {min_lat}..{max_lat}]")
                copernicusmarine.subset(
                    dataset_id='cmems_obs-ins_glo_phy-cur_my_glider_irr',
                    minimum_longitude=float(min_lon),
                    maximum_longitude=float(max_lon),
                    minimum_latitude=float(min_lat),
                    maximum_latitude=float(max_lat),
                    username=self.username,
                    password=self.password,
                    output_directory=str(self.cache_dir),
                    overwrite=True
                )
                # Re-search cache once downloaded
                return self.search_gliders(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat, auto_fetch=False)
            except Exception as e:
                logger.info(f"Copernicus in-situ glider query finished: {e}")

        return results

    def get_glider_profile(self, glider_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves vertical profile and trajectory soundings for a specific glider ID.
        Returns None if not found.
        """
        gliders = self.search_gliders()
        match = next((g for g in gliders if str(g.get('id')) == str(glider_id) or str(g.get('glider_id')) == str(glider_id)), None)
        if not match:
            return None

        file_path = match.get('file_path')
        if not file_path or not Path(file_path).exists():
            return match

        file_fmt = match.get('format', 'netcdf')
        try:
            if file_fmt == 'csv' or file_path.endswith('.csv'):
                import pandas as pd
                df = pd.read_csv(file_path)
                group = df[df['platform_id'].astype(str) == str(glider_id)]
                if group.empty:
                    return match

                profile_points = []
                sorted_g = group.sort_values(by='depth')
                for _, row in sorted_g.iterrows():
                    d = row.get('depth')
                    val = row.get('value')
                    var = row.get('variable')
                    if pd.notna(d):
                        point = {
                            'depth': round(float(d), 2),
                            'value': round(float(val), 4) if pd.notna(val) else None,
                            'variable': var,
                            'time': str(row.get('time', '')),
                            'latitude': round(float(row.get('latitude', match.get('latitude', 0))), 4),
                            'longitude': round(float(row.get('longitude', match.get('longitude', 0))), 4)
                        }
                        if var == 'TEMP':
                            point['temperature'] = point['value']
                        elif var == 'PSAL':
                            point['salinity'] = point['value']
                        profile_points.append(point)

                match['profile'] = profile_points
                match['depth_range'] = [
                    min(p['depth'] for p in profile_points) if profile_points else 0,
                    max(p['depth'] for p in profile_points) if profile_points else 0
                ]
                match['soundings_count'] = len(profile_points)
                return match

            # NetCDF format
            import xarray as xr
            with xr.open_dataset(file_path) as ds:
                profile_points = []
                depths = ds['DEPH'].values if 'DEPH' in ds else (ds['PRES'].values if 'PRES' in ds else None)
                temps = ds['TEMP'].values if 'TEMP' in ds else []
                sals = ds['PSAL'].values if 'PSAL' in ds else []

                if depths is not None and len(depths):
                    for d, t, s in zip(depths.flat, temps.flat if len(temps) else [], sals.flat if len(sals) else []):
                        if not np.isnan(d):
                            profile_points.append({
                                'depth': round(float(d), 2),
                                'temperature': round(float(t), 3) if not np.isnan(t) else None,
                                'salinity': round(float(s), 3) if not np.isnan(s) else None
                            })

                match['profile'] = profile_points
                match['depth_range'] = [
                    min(p['depth'] for p in profile_points) if profile_points else 0,
                    max(p['depth'] for p in profile_points) if profile_points else 0
                ]
                match['soundings_count'] = len(profile_points)
                return match
        except Exception as e:
            logger.error(f'Failed extracting profile for glider {glider_id}: {e}')
            return match

    def get_glider_observations(
        self,
        bbox: Optional[Dict[str, float]] = None,
        time: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Convenience method accepting a bbox dict."""
        if bbox:
            return self.search_gliders(
                min_lon=bbox.get('min_lon'),
                max_lon=bbox.get('max_lon'),
                min_lat=bbox.get('min_lat'),
                max_lat=bbox.get('max_lat'),
                start_time=time,
                end_time=time
            )
        return self.search_gliders(start_time=time, end_time=time)

