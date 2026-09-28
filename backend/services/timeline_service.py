"""
SolvX Dynamic Timeline Service
==============================
Provides dynamic temporal discovery and historical vs. forecast classification
anchored to real UTC system time.

Defaults to the last 1 calendar year relative to current UTC time.
Strictly honors user-provided custom date ranges without clamping.
Eliminates all hardcoded dates and artificial forecast heuristics.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List, Tuple

from .external_cache_service import EXTERNAL_CACHE

logger = logging.getLogger("solvx.timeline_service")


def _parse_iso_utc(ts_str: Optional[str]) -> Optional[datetime]:
    if not ts_str or not isinstance(ts_str, str) or not ts_str.strip():
        return None
    try:
        clean = ts_str.strip().replace('Z', '+00:00')
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def get_default_one_year_range(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """Returns [now - 1 calendar year, now] in UTC."""
    now_utc = now or datetime.now(timezone.utc)
    try:
        start_utc = now_utc.replace(year=now_utc.year - 1)
    except ValueError:
        # Handle leap year Feb 29
        start_utc = now_utc - timedelta(days=365)
    return start_utc, now_utc


def get_variable_timeline(
    variable: str = 'temperature',
    provider: str = 'auto',
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    depth: Optional[float] = None,
    start: Optional[str] = None,
    end: Optional[str] = None
) -> Dict[str, Any]:
    """
    Discovers available timestamps for a variable and region.
    Anchored to real UTC time:
      - Default window: [now_utc - 1 year, now_utc]
      - Custom window: honors [start, end] exactly
      - Historical vs Forecast: ts <= now_utc vs ts > now_utc
    """
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.strftime('%Y-%m-%dT%H:%M:%SZ')

    # 1. Determine timeline window bounds
    parsed_start = _parse_iso_utc(start)
    parsed_end = _parse_iso_utc(end)

    if parsed_start and parsed_end:
        if parsed_start > parsed_end:
            parsed_start, parsed_end = parsed_end, parsed_start
        start_dt = parsed_start
        end_dt = parsed_end
    elif parsed_start:
        start_dt = parsed_start
        end_dt = max(start_dt + timedelta(days=30), now_utc)
    elif parsed_end:
        end_dt = parsed_end
        try:
            start_dt = end_dt.replace(year=end_dt.year - 1)
        except ValueError:
            start_dt = end_dt - timedelta(days=365)
    else:
        # Default: exactly 1 calendar year relative to current UTC time
        start_dt, end_dt = get_default_one_year_range(now_utc)

    start_iso = start_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    end_iso = end_dt.strftime('%Y-%m-%dT%H:%M:%SZ')

    # 2. Extract available timestamps from external cache index
    cached_ts = EXTERNAL_CACHE.get_available_timestamps(
        variable=variable,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        start_time=start_iso,
        end_time=end_iso
    )

    timestamps = []
    if cached_ts and len(cached_ts) >= 1:
        timestamps = cached_ts
    else:
        # Generate daily UTC grid timestamps across requested window
        curr = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        limit = end_dt.replace(hour=23, minute=59, second=59, microsecond=0)
        while curr <= limit:
            timestamps.append(curr.strftime('%Y-%m-%dT00:00:00Z'))
            curr += timedelta(days=1)

    # 3. Categorize into Historical and Forecast based on UTC current time
    historical_ts = [t for t in timestamps if t <= now_iso]
    forecast_ts = [t for t in timestamps if t > now_iso]

    historical = {
        'from': historical_ts[0] if historical_ts else None,
        'to': historical_ts[-1] if historical_ts else None
    }
    forecast = {
        'from': forecast_ts[0] if forecast_ts else None,
        'to': forecast_ts[-1] if forecast_ts else None
    }

    # Resolution options
    is_ssh = variable in ('sea_surface_height', 'sea_level', 'zos', 'ssh')
    default_res = 'hourly' if is_ssh else 'daily'
    resolutions = ['hourly', 'daily', 'monthly'] if is_ssh else ['daily', 'monthly']
    span_days = (end_dt - start_dt).days
    if span_days <= 14 and 'hourly' not in resolutions:
        resolutions = ['hourly', 'daily', 'monthly']

    return {
        'provider': provider if provider != 'auto' else 'Copernicus / External',
        'variable': variable,
        'dataset': 'solvx_dynamic_ocean',
        'available_from': timestamps[0] if timestamps else None,
        'available_to': timestamps[-1] if timestamps else None,
        'default_resolution': default_res,
        'resolutions': resolutions,
        'historical': historical,
        'forecast': forecast,
        'available_timestamps': timestamps,
        'depth_levels': [0.5, 5.0, 10.0, 25.0, 50.0, 100.0, 200.0, 500.0]
    }
