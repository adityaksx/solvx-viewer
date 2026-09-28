"""
SolvX — Performance Profiling Service
====================================
Provides low-overhead execution timing breakdown (io_ms, compute_ms, cache_ms)
and generates standard Server-Timing headers for API responses.
"""

import time
import contextvars
from contextlib import contextmanager
from typing import Dict, Any, Optional

# Context variable for request-scoped stage timings
_CURRENT_PROFILE = contextvars.ContextVar("current_profile", default=None)


class ProfileContext:
    """Collects millisecond timings for discrete execution stages within a request."""

    def __init__(self, name: str = "request"):
        self.name = name
        self.timings: Dict[str, float] = {}
        self.metadata: Dict[str, Any] = {
            "backend": "cpu"
        }
        self.start_time = time.perf_counter()

    def record(self, stage: str, duration_ms: float) -> None:
        self.timings[stage] = round(self.timings.get(stage, 0.0) + duration_ms, 2)

    def set_backend(self, backend: str) -> None:
        self.metadata["backend"] = backend

    def set_meta(self, key: str, value: Any) -> None:
        self.metadata[key] = value

    @contextmanager
    def time_stage(self, stage: str):
        t0 = time.perf_counter()
        try:
            yield self
        finally:
            dt = (time.perf_counter() - t0) * 1000.0
            self.record(stage, dt)

    @property
    def total_elapsed_ms(self) -> float:
        return round((time.perf_counter() - self.start_time) * 1000.0, 2)

    def to_server_timing_header(self) -> str:
        """Formats timings as W3C Server-Timing header entries."""
        parts = [f"total;dur={self.total_elapsed_ms};desc=\"Total Duration\""]
        for stage, dur in self.timings.items():
            parts.append(f"{stage};dur={dur}")
        parts.append(f"backend;desc=\"{self.metadata.get('backend', 'cpu')}\"")
        return ", ".join(parts)


@contextmanager
def profile_scope(name: str = "request"):
    """Context manager setting active ProfileContext for the current execution thread/task."""
    ctx = ProfileContext(name=name)
    token = _CURRENT_PROFILE.set(ctx)
    try:
        yield ctx
    finally:
        _CURRENT_PROFILE.reset(token)


def get_current_profile() -> Optional[ProfileContext]:
    """Retrieves the active ProfileContext, if any."""
    return _CURRENT_PROFILE.get()


@contextmanager
def stage_timer(stage: str):
    """Convenience context manager to record a stage timing in the current active profile."""
    ctx = _CURRENT_PROFILE.get()
    if ctx is not None:
        with ctx.time_stage(stage):
            yield ctx
    else:
        yield None
