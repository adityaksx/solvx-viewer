"""
SolvX — ML Uncertainty Estimation
=================================
Quantifies scientific uncertainty grounded in empirical factors:
- Proximity to nearest in-situ Argo profiling float
- Completeness of input measurement streams (ocean vs atmospheric)
- Model predictive entropy (distance from decision boundary)
- Empirical test calibration (Brier score)
(Plan.md Section 12)
"""

from typing import List, Dict, Any, Optional
import numpy as np
from ..services.observation_service import get_argo_observations
from .schemas import UncertaintyDetail


def compute_haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two coordinates in kilometers."""
    R = 6371.0  # Earth radius in km
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)

    a = np.sin(dphi / 2.0)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0)**2
    c = 2.0 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))
    return float(R * c)


def compute_uncertainty(
    lat: float,
    lon: float,
    probabilities: List[float],
    missing_inputs: Optional[List[str]] = None,
    test_brier_score: float = 0.08
) -> UncertaintyDetail:
    """
    Computes rigorous uncertainty and confidence scores for a prediction.

    Args:
        lat: Target latitude
        lon: Target longitude
        probabilities: Predicted probabilities across horizons [p_6h, p_12h, p_24h]
        missing_inputs: List of missing inputs (e.g., 'wind_speed', 'sea_level_pressure')
        test_brier_score: Empirical Brier score from model evaluation

    Returns:
        UncertaintyDetail schema instance
    """
    missing = missing_inputs or []

    # 1. Observation proximity factor
    active_floats = get_argo_observations()
    min_dist_km = 9999.0

    if active_floats:
        for f in active_floats:
            f_lat = f.get('latitude')
            f_lon = f.get('longitude')
            if f_lat is not None and f_lon is not None:
                dist = compute_haversine_distance_km(lat, lon, float(f_lat), float(f_lon))
                if dist < min_dist_km:
                    min_dist_km = dist

    # Observation coverage classification
    if min_dist_km <= 75.0:
        obs_coverage = "dense"
        dist_penalty = 0.0
    elif min_dist_km <= 200.0:
        obs_coverage = "adequate"
        dist_penalty = 0.08
    elif min_dist_km <= 450.0:
        obs_coverage = "sparse"
        dist_penalty = 0.18
    else:
        obs_coverage = "none"
        dist_penalty = 0.28

    # 2. Input completeness factor
    n_missing = len(missing)
    if n_missing == 0:
        data_quality = "high"
        input_penalty = 0.0
    elif n_missing <= 2:
        data_quality = "moderate"
        input_penalty = 0.12
    else:
        data_quality = "degraded"
        input_penalty = 0.25

    # 3. Model boundary entropy penalty
    # When probabilities are near 0.5, classification entropy is highest
    entropy_penalties = [1.0 - 2.0 * abs(p - 0.5) for p in probabilities]
    mean_boundary_ambiguity = float(np.mean(entropy_penalties)) if entropy_penalties else 0.5
    ambiguity_penalty = 0.15 * mean_boundary_ambiguity

    # 4. Calibration penalty based on empirical test Brier score
    calib_penalty = min(0.15, test_brier_score)

    # Base confidence is 1.0 minus all grounded penalties
    raw_confidence = 1.0 - (dist_penalty + input_penalty + ambiguity_penalty + calib_penalty)
    confidence = float(np.clip(round(raw_confidence, 2), 0.10, 0.95))

    # Overall uncertainty label
    if confidence >= 0.75:
        uncertainty_level = "low"
    elif confidence >= 0.50:
        uncertainty_level = "moderate"
    else:
        uncertainty_level = "high"

    return UncertaintyDetail(
        confidence=confidence,
        uncertainty=uncertainty_level,
        observation_coverage=obs_coverage,
        data_quality=data_quality,
        distance_to_argo_km=round(min_dist_km, 1) if min_dist_km < 9000 else None,
        missing_inputs=missing
    )
