"""
SolvX External Ocean Cache Manager
==================================
Manages persistent external ocean datasets in `data/external/ocean/` and their
authoritative index in `data/external/ocean/manifest.json`.

Provides O(1) in-memory spatial, temporal, and variable containment lookups,
automatic indexing of newly acquired NetCDF chunks, and single-flight lock
management for deduplicating concurrent downloads.
"""

import os
import json
import time
import glob
import logging
import threading
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone

import pandas as pd
import numpy as np

from ..config import EXTERNAL_OCEAN_DIR, EXTERNAL_OCEAN_MANIFEST
from .cache_service import safe_open_dataset, NETCDF_LOCK

logger = logging.getLogger("solvx.external_cache")

# Map of logical variable names to aliases
VARIABLE_ALIASES = {
    'temperature': ['ocean_temperature', 'temperature', 'thetao', 'temp', 'sst'],
    'ocean_temperature': ['ocean_temperature', 'temperature', 'thetao', 'temp', 'sst'],
    'salinity': ['salinity', 'so', 'salt'],
    'currents': ['currents', 'uo', 'vo', 'cur', 'uv'],
    'current_u': ['current_u', 'uo', 'u'],
    'current_v': ['current_v', 'vo', 'v'],
    'sea_surface_height': ['sea_surface_height', 'zos', 'ssh', 'sla', 'sea_level'],
    'sea_level': ['sea_surface_height', 'zos', 'ssh', 'sla', 'sea_level'],
    'chlorophyll': ['chlorophyll', 'chl', 'chlor_a'],
    'dissolved_oxygen': ['dissolved_oxygen', 'o2'],
    'ph': ['ph'],
    'nitrate': ['nitrate', 'no3'],
    'phosphate': ['phosphate', 'po4']
}


def _normalize_var(var: str) -> str:
    v = var.lower().strip()
    for canonical, aliases in VARIABLE_ALIASES.items():
        if v in aliases:
            return canonical
    return v


def _to_naive_utc(ts: Any) -> Optional[pd.Timestamp]:
    if ts is None:
        return None
    try:
        p = pd.to_datetime(ts)
        if hasattr(p, 'tz') and p.tz is not None:
            p = p.tz_convert('UTC').tz_localize(None)
        return p
    except Exception:
        return None


class ExternalCacheManager:
    """Thread-safe index and cache manager for external oceanographic NetCDF files."""

    def __init__(self, cache_dir: Optional[Path] = None, manifest_path: Optional[Path] = None):
        self.cache_dir = Path(cache_dir or EXTERNAL_OCEAN_DIR)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = Path(manifest_path or EXTERNAL_OCEAN_MANIFEST)
        self._lock = threading.RLock()
        self._in_flight_locks: Dict[str, threading.Lock] = {}
        self._in_flight_meta_lock = threading.Lock()
        self.manifest: Dict[str, Any] = {"version": 1, "updated_at": None, "files": {}}
        self._load_manifest()

    def _load_manifest(self) -> None:
        with self._lock:
            if self.manifest_path.exists():
                try:
                    with open(self.manifest_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if isinstance(data, dict) and "files" in data:
                            self.manifest = data
                            logger.info("[ExternalCache] Loaded %d indexed files from manifest", len(self.manifest.get("files", {})))
                            return
                except Exception as e:
                    logger.warning("[ExternalCache] Failed loading manifest.json: %s; rebuilding index", e)
            
            # Rebuild index from disk
            self._rebuild_index_from_disk()

    def _save_manifest(self) -> None:
        with self._lock:
            self.manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
            tmp_path = self.manifest_path.with_suffix('.tmp')
            try:
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    json.dump(self.manifest, f, indent=2)
                os.replace(tmp_path, self.manifest_path)
            except Exception as e:
                logger.error("[ExternalCache] Failed saving manifest: %s", e)
                if tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass

    def _rebuild_index_from_disk(self) -> None:
        """Indexes existing NetCDF files in cache_dir into the manifest."""
        logger.info("[ExternalCache] Scanning %s to build manifest index...", self.cache_dir)
        nc_files = list(self.cache_dir.glob("*.nc"))
        indexed = {}

        for nc in nc_files:
            if nc.name.startswith("tmp_") or nc.stat().st_size == 0:
                continue
            meta = self._inspect_file_metadata(nc)
            if meta:
                indexed[nc.name] = meta

        self.manifest = {
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "files": indexed
        }
        self._save_manifest()
        logger.info("[ExternalCache] Rebuilt manifest index with %d files", len(indexed))

    def _inspect_file_metadata(self, nc_path: Path) -> Optional[Dict[str, Any]]:
        """Inspects NetCDF headers safely to extract spatial, temporal, and variable metadata."""
        try:
            stat = nc_path.stat()
            size_bytes = stat.st_size
            mtime = stat.st_mtime
            
            with NETCDF_LOCK:
                with safe_open_dataset(nc_path) as ds:
                    vars_in_ds = list(ds.data_vars.keys())
                    
                    # Lat / Lon
                    lat_name = next((c for c in ('latitude', 'lat', 'lat_u', 'lat_v') if c in ds.coords), None)
                    lon_name = next((c for c in ('longitude', 'lon', 'lon_u', 'lon_v') if c in ds.coords), None)
                    
                    if not lat_name or not lon_name:
                        return None
                        
                    lats = ds.coords[lat_name].values
                    lons = ds.coords[lon_name].values
                    min_lat = float(np.min(lats))
                    max_lat = float(np.max(lats))
                    min_lon = float(np.min(lons))
                    max_lon = float(np.max(lons))
                    
                    # Time
                    timestamps = []
                    time_start, time_end = None, None
                    if 'time' in ds.coords:
                        t_vals = ds.coords['time'].values
                        for t in t_vals:
                            p = _to_naive_utc(t)
                            if p is not None:
                                timestamps.append(p.strftime('%Y-%m-%dT%H:%M:%SZ'))
                        if timestamps:
                            timestamps.sort()
                            time_start = timestamps[0]
                            time_end = timestamps[-1]

                    # Depth
                    depth_levels = []
                    depth_dim = next((d for d in ('depth', 'deptht', 'lev', 'level', 'z') if d in ds.coords), None)
                    if depth_dim:
                        d_vals = ds.coords[depth_dim].values
                        depth_levels = [round(float(d), 2) for d in d_vals]

                    # Deduce canonical variable & provider
                    name = nc_path.name.lower()
                    provider = "copernicus" if name.startswith("cmems") else ("incois" if "incois" in name else "external")
                    
                    detected_var = "ocean_temperature"
                    for v_canonical, aliases in VARIABLE_ALIASES.items():
                        if any(a in name for a in aliases) or any(a in vars_in_ds for a in aliases):
                            detected_var = v_canonical
                            break

                    return {
                        "provider": provider,
                        "variable": detected_var,
                        "variables": vars_in_ds,
                        "bbox": [min_lat, max_lat, min_lon, max_lon],
                        "time_range": {"start": time_start, "end": time_end},
                        "timestamps": timestamps,
                        "depth_levels": depth_levels,
                        "size_bytes": size_bytes,
                        "mtime": mtime
                    }
        except Exception as e:
            logger.debug("[ExternalCache] Error inspecting %s: %s", nc_path.name, e)
            return None

    def register_file(
        self,
        filepath: str,
        provider: str,
        variable: str,
        bbox: Optional[List[float]] = None,
        time_range: Optional[Dict[str, Optional[str]]] = None,
        timestamps: Optional[List[str]] = None,
        depth_levels: Optional[List[float]] = None
    ) -> None:
        """Registers a newly acquired or generated NetCDF chunk in the manifest."""
        p = Path(filepath)
        if not p.exists() or p.stat().st_size == 0:
            return

        with self._lock:
            meta = self._inspect_file_metadata(p)
            if not meta:
                meta = {
                    "provider": provider,
                    "variable": _normalize_var(variable),
                    "variables": [variable],
                    "bbox": bbox or [0.0, 0.0, 0.0, 0.0],
                    "time_range": time_range or {"start": None, "end": None},
                    "timestamps": sorted(list(set(timestamps or []))),
                    "depth_levels": depth_levels or [],
                    "size_bytes": p.stat().st_size,
                    "mtime": p.stat().st_mtime
                }
            self.manifest["files"][p.name] = meta
            self._save_manifest()
            logger.info("[ExternalCache] Registered %s (%s, %s) in manifest", p.name, provider, variable)

    def find_cached_chunk(
        self,
        variable: str,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
        time: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        depth: Optional[float] = None,
        tolerance_deg: float = 0.08
    ) -> Optional[str]:
        """
        Finds a cached NetCDF file that spatially, temporally, and logically covers the request.
        Fast in-memory index evaluation (sub-millisecond).
        """
        norm_req_var = _normalize_var(variable)
        t_req = _to_naive_utc(time)
        t_start = _to_naive_utc(start_time)
        t_end = _to_naive_utc(end_time)

        with self._lock:
            for fname, meta in self.manifest.get("files", {}).items():
                # 1. Variable check
                meta_var = _normalize_var(meta.get("variable", ""))
                vars_in_file = [v.lower() for v in meta.get("variables", [])]
                if meta_var != norm_req_var and not any(_normalize_var(v) == norm_req_var for v in vars_in_file):
                    continue

                # 2. Spatial coverage check
                bbox = meta.get("bbox")
                if not bbox or len(bbox) != 4:
                    continue
                f_min_lat, f_max_lat, f_min_lon, f_max_lon = bbox
                if (min_lat < f_min_lat - tolerance_deg or
                    max_lat > f_max_lat + tolerance_deg or
                    min_lon < f_min_lon - tolerance_deg or
                    max_lon > f_max_lon + tolerance_deg):
                    continue

                # 3. Depth check (if 3D variable and depth specified)
                depth_levels = meta.get("depth_levels", [])
                if depth is not None and depth_levels:
                    min_d = min(depth_levels)
                    max_d = max(depth_levels)
                    if depth < min_d - 2.0 or depth > max_d + 10.0:
                        continue

                # 4. Temporal check
                f_start = _to_naive_utc(meta.get("time_range", {}).get("start"))
                f_end = _to_naive_utc(meta.get("time_range", {}).get("end"))

                if t_req is not None:
                    if f_start and f_end:
                        if not (f_start <= t_req <= f_end):
                            continue
                    elif meta.get("timestamps"):
                        # Exact date string check
                        t_req_str = t_req.strftime('%Y-%m-%d')
                        if not any(t_req_str in ts for ts in meta["timestamps"]):
                            continue

                if t_start is not None and t_end is not None:
                    if f_start and f_end:
                        if f_start > t_start or f_end < t_end:
                            continue

                # Verify file still exists on disk
                fpath = self.cache_dir / fname
                if fpath.exists() and fpath.stat().st_size > 0:
                    return str(fpath)

        return None

    def get_available_timestamps(
        self,
        variable: str,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None
    ) -> List[str]:
        """Extracts unique sorted timestamps available in the external cache for a variable & region in O(1) time."""
        norm_var = _normalize_var(variable)
        s_clean = start_time.strip().replace('+00:00', 'Z') if start_time else None
        e_clean = end_time.strip().replace('+00:00', 'Z') if end_time else None

        collected = set()
        with self._lock:
            for fname, meta in self.manifest.get("files", {}).items():
                meta_var = _normalize_var(meta.get("variable", ""))
                vars_in_file = [v.lower() for v in meta.get("variables", [])]
                if meta_var != norm_var and not any(_normalize_var(v) == norm_var for v in vars_in_file):
                    continue

                # Coarse time range filtering
                tr = meta.get("time_range", {})
                f_start = tr.get("start")
                f_end = tr.get("end")
                if f_start and f_end:
                    if s_clean and f_end < s_clean:
                        continue
                    if e_clean and f_start > e_clean:
                        continue

                # Spatial overlap check
                if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
                    bbox = meta.get("bbox")
                    if bbox and len(bbox) == 4:
                        f_min_lat, f_max_lat, f_min_lon, f_max_lon = bbox
                        if (max_lat < f_min_lat or min_lat > f_max_lat or
                            max_lon < f_min_lon or min_lon > f_max_lon):
                            continue

                for ts in meta.get("timestamps", []):
                    if s_clean and ts < s_clean:
                        continue
                    if e_clean and ts > e_clean:
                        continue
                    collected.add(ts)

        return sorted(list(collected))

    def get_single_flight_lock(self, request_key: str) -> threading.Lock:
        """Returns or creates a mutex dedicated to a unique request key for single-flight deduplication."""
        with self._in_flight_meta_lock:
            if request_key not in self._in_flight_locks:
                self._in_flight_locks[request_key] = threading.Lock()
            return self._in_flight_locks[request_key]

    def release_single_flight_lock(self, request_key: str) -> None:
        """Cleans up a single-flight mutex once processing completes."""
        with self._in_flight_meta_lock:
            self._in_flight_locks.pop(request_key, None)


# Global singleton instance
EXTERNAL_CACHE = ExternalCacheManager()
