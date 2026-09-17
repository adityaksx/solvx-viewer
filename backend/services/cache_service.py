import threading
import hashlib
import json
from contextlib import contextmanager
from typing import Any, Optional
from pathlib import Path
import xarray as xr
from ..config import CACHE_MAX_SIZE

NETCDF_LOCK = threading.RLock()
OPEN_DATASETS: dict[str, xr.Dataset] = {}

class MemoryCache:
    def __init__(self, max_size: int = CACHE_MAX_SIZE):
        self._cache: dict[str, Any] = {}
        self._keys: list[str] = []
        self._lock = threading.Lock()
        self._max_size = max_size

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._cache.get(key)

    def set(self, key: str, value: Any):
        with self._lock:
            if key not in self._cache:
                if len(self._keys) >= self._max_size:
                    old_key = self._keys.pop(0)
                    self._cache.pop(old_key, None)
                self._keys.append(key)
            self._cache[key] = value

    def clear(self):
        with self._lock:
            self._cache.clear()
            self._keys.clear()

GLOBAL_CACHE = MemoryCache()

def make_cache_key(prefix: str, params: dict) -> str:
    serialized = json.dumps(params, sort_keys=True, default=str)
    hashed = hashlib.sha256(serialized.encode('utf-8')).hexdigest()[:16]
    return f"{prefix}_{hashed}"

def get_cached_dataset(path: Path) -> xr.Dataset:
    key = str(path.resolve())
    with NETCDF_LOCK:
        if key not in OPEN_DATASETS:
            OPEN_DATASETS[key] = xr.open_dataset(path)
        return OPEN_DATASETS[key]

@contextmanager
def safe_open_dataset(path: Path):
    with NETCDF_LOCK:
        yield get_cached_dataset(path)
