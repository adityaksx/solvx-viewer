"""
SolvX — GPU Hardware Abstraction & Safety Service
=================================================
Manages optional CUDA GPU acceleration via CuPy, enforcing VRAM budgeting,
safe element-size thresholds (PCIe overhead prevention), and seamless CPU fallback.
"""

import os
import logging
from typing import Optional, Dict, Any, Tuple, Callable

logger = logging.getLogger("solvx.gpu_service")

# Minimum array element count before GPU offload becomes profitable
GPU_MIN_ELEMENTS = int(os.environ.get("SOLVX_GPU_MIN_ELEMENTS", "50000"))

# Maximum VRAM allocation cap in bytes (default 4.0 GB to avoid starving display/OS)
MAX_VRAM_BYTES = int(os.environ.get("SOLVX_MAX_VRAM_BYTES", str(4 * 1024 * 1024 * 1024)))

# Headroom required before scheduling work on GPU (1.0 GB)
MIN_HEADROOM_BYTES = int(os.environ.get("SOLVX_MIN_HEADROOM_BYTES", str(1024 * 1024 * 1024)))

_GPU_INITIALIZED = False
_GPU_AVAILABLE = False
_DEVICE_NAME = "None"
_CUPY = None


def init_gpu() -> bool:
    """Probes for CuPy and NVIDIA CUDA runtime availability and configures memory pools."""
    global _GPU_INITIALIZED, _GPU_AVAILABLE, _DEVICE_NAME, _CUPY
    if _GPU_INITIALIZED:
        return _GPU_AVAILABLE

    _GPU_INITIALIZED = True
    try:
        import cupy as cp
        device_count = cp.cuda.runtime.getDeviceCount()
        if device_count > 0:
            dev = cp.cuda.Device(0)
            _DEVICE_NAME = cp.cuda.runtime.getDeviceProperties(0)['name'].decode('utf-8', errors='ignore')
            # Set memory pool limit to prevent VRAM exhaustion
            pool = cp.cuda.MemoryPool()
            pool.set_limit(size=MAX_VRAM_BYTES)
            cp.cuda.set_allocator(pool.malloc)
            _CUPY = cp
            _GPU_AVAILABLE = True
            logger.info("GPU acceleration ENABLED: %s (Max pool: %d MB)", _DEVICE_NAME, MAX_VRAM_BYTES // (1024 * 1024))
        else:
            _GPU_AVAILABLE = False
            logger.info("GPU acceleration unavailable: No CUDA devices detected.")
    except (ImportError, Exception) as e:
        _GPU_AVAILABLE = False
        logger.info("GPU acceleration disabled (running CPU fallback): %s", e)

    return _GPU_AVAILABLE


def is_gpu_available() -> bool:
    if not _GPU_INITIALIZED:
        init_gpu()
    return _GPU_AVAILABLE


def get_gpu_info() -> Dict[str, Any]:
    """Returns runtime telemetry for GPU device and memory allocation."""
    if not is_gpu_available() or _CUPY is None:
        return {
            "available": False,
            "device": "CPU Fallback",
            "free_vram_mb": 0,
            "total_vram_mb": 0,
            "min_elements_threshold": GPU_MIN_ELEMENTS
        }
    try:
        free_bytes, total_bytes = _CUPY.cuda.runtime.memGetInfo()
        return {
            "available": True,
            "device": _DEVICE_NAME,
            "free_vram_mb": round(free_bytes / (1024 * 1024), 1),
            "total_vram_mb": round(total_bytes / (1024 * 1024), 1),
            "min_elements_threshold": GPU_MIN_ELEMENTS
        }
    except Exception as e:
        return {
            "available": False,
            "device": _DEVICE_NAME,
            "error": str(e),
            "min_elements_threshold": GPU_MIN_ELEMENTS
        }


def should_use_gpu(array_size: int) -> bool:
    """
    Decides whether an operation warrants GPU execution based on array size and VRAM headroom.
    Small arrays (< 50,000 items) are kept on CPU to avoid PCIe host-device transfer latency.
    """
    if not is_gpu_available() or _CUPY is None:
        return False

    if array_size < GPU_MIN_ELEMENTS:
        return False

    try:
        free_bytes, _ = _CUPY.cuda.runtime.memGetInfo()
        if free_bytes < MIN_HEADROOM_BYTES:
            logger.warning("GPU VRAM low (%d MB free). Bypassing GPU offload.", free_bytes // (1024 * 1024))
            return False
    except Exception:
        return False

    return True


def to_gpu(arr):
    """Safely converts a NumPy or array-like object to CuPy array."""
    if not is_gpu_available() or _CUPY is None:
        return arr
    if isinstance(arr, _CUPY.ndarray):
        return arr
    return _CUPY.asarray(arr)


def to_cpu(arr):
    """Safely converts a CuPy or NumPy array to NumPy array on CPU."""
    if _CUPY is not None and isinstance(arr, _CUPY.ndarray):
        return _CUPY.asnumpy(arr)
    return arr


def safe_gpu_exec(
    gpu_fn: Callable[..., Any],
    fallback_fn: Callable[..., Any],
    *args,
    **kwargs
) -> Tuple[Any, str]:
    """
    Executes gpu_fn. If an exception or OOM occurs, catches it, clears VRAM cache,
    and transparently invokes fallback_fn on CPU.
    Returns (result, backend_used).
    """
    if is_gpu_available() and _CUPY is not None:
        try:
            res = gpu_fn(*args, **kwargs)
            return res, "cuda"
        except _CUPY.cuda.memory.OutOfMemoryError as oom:
            logger.warning("GPU OOM encountered. Evicting memory pool and falling back to CPU: %s", oom)
            try:
                _CUPY.get_default_memory_pool().free_all_blocks()
            except Exception:
                pass
        except Exception as e:
            logger.warning("GPU execution failed. Falling back to CPU: %s", e)

    return fallback_fn(*args, **kwargs), "cpu"
