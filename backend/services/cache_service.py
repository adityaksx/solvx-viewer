import time
import threading
import hashlib
import json
from contextlib import contextmanager
from typing import Any, Optional, Callable, Dict, List
from pathlib import Path
from collections import OrderedDict
import xarray as xr
from ..config import CACHE_MAX_SIZE, CACHE_TTL

# Retain NETCDF_LOCK for backward compatibility, but operations internally use fine-grained locking
NETCDF_LOCK = threading.RLock()

class ThreadSafeLRUCache:
    """High-performance thread-safe LRU cache with TTL and stampede protection."""

    def __init__(self, max_size: int = CACHE_MAX_SIZE, default_ttl: int = CACHE_TTL):
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock = threading.Lock()
        self._key_locks: Dict[str, threading.Lock] = {}
        self._key_locks_guard = threading.Lock()
        self._max_size = max_size
        self._default_ttl = default_ttl

    def _get_key_lock(self, key: str) -> threading.Lock:
        with self._key_locks_guard:
            if key not in self._key_locks:
                self._key_locks[key] = threading.Lock()
            return self._key_locks[key]

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                return None
            val, expiry = self._cache[key]
            if expiry is not None and time.time() > expiry:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return val

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        expiry = time.time() + (ttl if ttl is not None else self._default_ttl) if (ttl or self._default_ttl) else None
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = (value, expiry)
            if len(self._cache) > self._max_size:
                self._cache.popitem(last=False)

    def get_or_compute(self, key: str, compute_fn: Callable[[], Any], ttl: Optional[int] = None) -> Any:
        """Stampede-proof cache getter: ensures compute_fn is only executed once for concurrent callers."""
        val = self.get(key)
        if val is not None:
            return val

        key_lock = self._get_key_lock(key)
        with key_lock:
            # Recheck under lock
            val = self.get(key)
            if val is not None:
                return val
            computed = compute_fn()
            self.set(key, computed, ttl=ttl)
            return computed

    def clear(self):
        with self._lock:
            self._cache.clear()
        with self._key_locks_guard:
            self._key_locks.clear()

GLOBAL_CACHE = ThreadSafeLRUCache()

def make_cache_key(prefix: str, params: dict) -> str:
    """Generates deterministic SHA-256 cache key from request parameters."""
    serialized = json.dumps(params, sort_keys=True, default=str)
    hashed = hashlib.sha256(serialized.encode('utf-8')).hexdigest()[:16]
    return f"{prefix}_{hashed}"

# ==============================================================================
# Thread-Safe NetCDF Dataset Registry (Process-wide NETCDF_LOCK for HDF5 C-lib)
# ==============================================================================

_DATASET_REGISTRY_LOCK = threading.Lock()
OPEN_DATASETS: Dict[str, xr.Dataset] = {}

def get_cached_dataset(path: Path) -> xr.Dataset:
    """Returns cached open xr.Dataset instance under global NETCDF_LOCK to protect C-level HDF5 structures."""
    key = str(path.resolve())
    with NETCDF_LOCK:
        if key in OPEN_DATASETS:
            return OPEN_DATASETS[key]
        ds = xr.open_dataset(path)
        OPEN_DATASETS[key] = ds
        return ds

@contextmanager
def safe_open_dataset(path: Path):
    """Context manager yielding open dataset wrapped in NETCDF_LOCK to guarantee thread-safe HDF5/NetCDF C access."""
    with NETCDF_LOCK:
        yield get_cached_dataset(path)

# ==============================================================================
# Dataset Metadata Index (Phase 1.3)
# ==============================================================================

class DatasetMetadataIndex:
    """Lightweight metadata index to prevent repeated NetCDF inspection at query time."""

    def __init__(self):
        self._index: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def get_metadata(self, path: Path) -> Dict[str, Any]:
        key = str(path.resolve())
        with self._lock:
            if key in self._index:
                return self._index[key]

        with NETCDF_LOCK:
            ds = get_cached_dataset(path)
            from ..processing.normalization import variable_catalog, sanitize

            coords_meta = {}
            for n, c in ds.coords.items():
                vals = c.values
                step = max(1, vals.size // 5000)
                coords_meta[n] = {
                    'size': int(vals.size),
                    'min': sanitize(vals.min()) if vals.size else None,
                    'max': sanitize(vals.max()) if vals.size else None,
                    'values': sanitize(vals.tolist() if n == 'time' or vals.size <= 5000 else vals[::step].tolist()),
                    'units': c.attrs.get('units')
                }

            meta = {
                'file': path.name,
                'variables': variable_catalog(ds),
                'dimensions': {k: int(v) for k, v in ds.sizes.items()},
                'coordinates': coords_meta
            }

        with self._lock:
            self._index[key] = meta
        return meta

    def invalidate(self, path: Optional[Path] = None):
        with self._lock:
            if path:
                self._index.pop(str(path.resolve()), None)
            else:
                self._index.clear()

DATASET_METADATA_INDEX = DatasetMetadataIndex()
