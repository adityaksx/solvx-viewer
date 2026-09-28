"""
SolvX — Bounded Multi-Core Parallel Execution Service
=====================================================
Manages bounded CPU thread pools and sets library concurrency limits
(OpenBLAS, MKL, OMP) to prevent core oversubscription and memory exhaustion
on 6-core / 12-thread / 16 GB host hardware.
"""

import os
import multiprocessing
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Iterable, List, TypeVar, Any

# Ensure underlying BLAS/LAPACK threads are bounded to avoid thread explosion
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "2")

# Cap thread pool workers (optimal for Ryzen 5 7640HS with 6 physical cores)
_DEFAULT_MAX_WORKERS = min(6, max(2, (os.cpu_count() or 4) // 2))
_BOUNDED_EXECUTOR: ThreadPoolExecutor = None

T = TypeVar("T")
R = TypeVar("R")


def get_bounded_executor(max_workers: int = _DEFAULT_MAX_WORKERS) -> ThreadPoolExecutor:
    """Returns singleton bounded ThreadPoolExecutor."""
    global _BOUNDED_EXECUTOR
    if _BOUNDED_EXECUTOR is None:
        _BOUNDED_EXECUTOR = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="solvx-worker"
        )
    return _BOUNDED_EXECUTOR


def parallel_map(
    fn: Callable[[T], R],
    items: Iterable[T],
    max_workers: int = _DEFAULT_MAX_WORKERS,
    chunk_size: int = 1
) -> List[R]:
    """
    Executes fn over items in parallel across bounded worker threads.
    Preserves item ordering.
    """
    items_list = list(items)
    if not items_list:
        return []
    if len(items_list) == 1:
        return [fn(items_list[0])]

    executor = get_bounded_executor(max_workers=max_workers)
    return list(executor.map(fn, items_list, chunksize=chunk_size))
