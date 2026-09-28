"""
SolvX — Canonical Request Key Utilities
=======================================
Normalizes request parameters (bounding boxes, ISO timestamps, depth values)
to prevent cache key fragmentation due to minute floating point jitter.
"""

import hashlib
import json
from typing import Optional, Dict, Any


def canonical_bbox(
    min_lon: Optional[float],
    max_lon: Optional[float],
    min_lat: Optional[float],
    max_lat: Optional[float],
    precision: int = 4
) -> Optional[tuple]:
    """Rounds bounding box coordinates to canonical decimal precision."""
    if None in (min_lon, max_lon, min_lat, max_lat):
        return None
    return (
        round(float(min_lon), precision),
        round(float(max_lon), precision),
        round(float(min_lat), precision),
        round(float(max_lat), precision),
    )


def canonical_request_hash(prefix: str, params: Dict[str, Any]) -> str:
    """Produces deterministic SHA-256 cache key with sorted, normalized parameters."""
    normalized = {}
    for k, v in params.items():
        if v is None:
            continue
        if isinstance(v, float):
            normalized[k] = round(v, 4)
        else:
            normalized[k] = v

    encoded = json.dumps(normalized, sort_keys=True, default=str).encode('utf-8')
    return f"{prefix}_{hashlib.sha256(encoded).hexdigest()[:16]}"
