import os
import json
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, List

from ..config import (
    INCOIS_BASE_URL,
    REQUEST_TIMEOUT,
    LOCAL_DATA_MODE
)
from ..models.requests import SolvXObservationsResponse, SolvXObservationItem

logger = logging.getLogger('solvx.observation')


class ObservationAdapter:
    """In-Situ Observation Adapter for INCOIS / Argo Float Sounding Profiles."""

    def __init__(self, base_url: str = INCOIS_BASE_URL, timeout: int = REQUEST_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout

    def fetch_observations(
        self,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None
    ) -> Dict[str, Any]:
        """Fetches in-situ float sounding profiles in the region."""
        if LOCAL_DATA_MODE:
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

        return self._fetch_from_api(min_lat, max_lat, min_lon, max_lon)

    def compare_observation(self, obs_id: str, variable: str = 'temperature') -> Dict[str, Any]:
        """Compares float vertical sounding against collocated ocean model output."""
        from ..services.observation_service import get_observation_comparison
        return get_observation_comparison(obs_id)

    def _fetch_from_local_source(
        self,
        min_lat: Optional[float],
        max_lat: Optional[float],
        min_lon: Optional[float],
        max_lon: Optional[float]
    ) -> Dict[str, Any]:
        """Retrieves calibrated Argo float sounding records from local observation service."""
        from ..services.observation_service import get_observations

        obs = get_observations(min_lon=min_lon, max_lon=max_lon, min_lat=min_lat, max_lat=max_lat)
        return {
            'source': 'INCOIS / Indian Ocean Argo Float Program (Local Calibrated Records)',
            'count': len(obs),
            'observations': obs,
            'metadata': {
                'program': 'Argo In-Situ Ocean Profiling',
                'description': 'Real CTD sounding profiles (Temperature, Salinity, Pressure)'
            }
        }

    def _fetch_from_api(
        self,
        min_lat: Optional[float],
        max_lat: Optional[float],
        min_lon: Optional[float],
        max_lon: Optional[float]
    ) -> Dict[str, Any]:
        """Queries INCOIS tabledap Argo float service via HTTP."""
        try:
            # INCOIS ERDDAP tabledap syntax for Argo
            dataset_id = 'incois_argo_profiles'
            params = ['wmo', 'latitude', 'longitude', 'time', 'platform', 'cycle_number', 'depth', 'temperature', 'salinity']
            query_vars = ','.join(params)
            
            constraints = []
            if min_lat is not None and max_lat is not None:
                constraints.append(f"latitude>={min_lat}&latitude<={max_lat}")
            if min_lon is not None and max_lon is not None:
                constraints.append(f"longitude>={min_lon}&longitude<={max_lon}")

            query_str = f"{query_vars}&{'&'.join(constraints)}" if constraints else query_vars
            url = f"{self.base_url}/tabledap/{dataset_id}.json?{query_str}"

            req = urllib.request.Request(url, headers={'User-Agent': 'SolvX-Ocean-Explorer/3.0'})
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if 'table' in data and 'rows' in data['table']:
                    return self._parse_tabledap_argo(data)

            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)
        except Exception as e:
            logger.warning("Observation API fetch failed: %s. Using local calibrated Argo dataset.", e)
            return self._fetch_from_local_source(min_lat, max_lat, min_lon, max_lon)

    def _parse_tabledap_argo(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Groups tabular ERDDAP CTD records by WMO / Float cycle into vertical profiles."""
        table = data['table']
        cols = {name: idx for idx, name in enumerate(table['columnNames'])}
        rows = table['rows']

        floats: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            wmo = r[cols['wmo']]
            lat = r[cols['latitude']]
            lon = r[cols['longitude']]
            date_str = r[cols['time']]
            platform = r.get(cols.get('platform', 0), 'Argo Float')
            cycle = r.get(cols.get('cycle_number', 0), 1)
            depth = r[cols['depth']]
            temp = r[cols['temperature']]
            sal = r[cols['salinity']]

            key = f"{wmo}_{cycle}"
            if key not in floats:
                floats[key] = {
                    'id': str(wmo),
                    'wmo': int(wmo),
                    'latitude': round(float(lat), 3),
                    'longitude': round(float(lon), 3),
                    'date': str(date_str),
                    'platform': str(platform),
                    'cycles': int(cycle),
                    'profile': []
                }
            floats[key]['profile'].append({
                'depth': round(float(depth), 1),
                'temp': round(float(temp), 2) if temp is not None else None,
                'sal': round(float(sal), 2) if sal is not None else None
            })

        obs_list = list(floats.values())
        return {
            'source': 'INCOIS Live Argo ERDDAP Service',
            'count': len(obs_list),
            'observations': obs_list,
            'metadata': {
                'dataset_id': 'incois_argo_profiles',
                'description': 'Real-time in-situ CTD vertical profiles'
            }
        }
