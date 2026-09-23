"""
SolvX — ML Model Explainability
===============================
Translates mathematical feature importances and local measurement deviations
into human-readable scientific factors for the UI and AI interpretation layer.
(Plan.md Section 10)
"""

from typing import Dict, Any, List, Optional
from .schemas import FeatureExplanation


FEATURE_DESCRIPTIONS = {
    'sst': "Sea surface temperature (°C)",
    'sst_anomaly': "Sea surface temperature deviation from local baseline climatology",
    'salinity': "Upper-ocean salinity (PSU)",
    'sea_surface_height': "Total sea surface dynamic topography (m)",
    'current_speed': "Magnitude of surface velocity (m/s)",
    'current_direction': "Direction of ocean current vector",
    'thermal_gradient': "Vertical thermal difference between surface and thermocline",
    'wind_speed': "Near-surface 10m atmospheric wind speed (m/s)",
    'wind_direction': "Wind vector orientation",
    'sea_level_pressure': "Atmospheric surface pressure (hPa)",
    'relative_humidity': "Near-surface atmospheric relative humidity (%)",
    'sst_change_6h': "6-hour temporal trend in sea surface temperature",
    'pressure_change_6h': "6-hour barometric pressure change",
    'wind_speed_change_6h': "6-hour wind acceleration/deceleration",
    'sst_rolling_std_3d': "3-day ocean thermal variability",
}


def explain_prediction(
    features_dict: Dict[str, float],
    feature_importances: Dict[str, float],
    risk_score: float,
    max_features: int = 5
) -> List[FeatureExplanation]:
    """
    Computes top contributing scientific factors for an inferred risk level.

    Args:
        features_dict: Dictionary of feature values at the inspected point.
        feature_importances: Global feature importance dictionary from model.
        risk_score: Inferred hazard probability (0.0 - 1.0).
        max_features: Maximum number of explanatory factors to return.

    Returns:
        List of FeatureExplanation objects sorted by contribution.
    """
    scored_factors = []

    for name, imp in feature_importances.items():
        val = features_dict.get(name)
        if val is None:
            continue

        direction = "neutral"
        desc = FEATURE_DESCRIPTIONS.get(name, name)

        if name == 'sst_anomaly':
            if val > 1.2:
                direction = "elevates_risk"
                desc = f"Strong surface thermal anomaly (+{val:.2f}°C above baseline) fuels hazard formation"
            elif val < -0.5:
                direction = "reduces_risk"
                desc = f"Below-average surface temperature ({val:.2f}°C) suppresses convective energy"
        elif name == 'sst':
            if val >= 29.0:
                direction = "elevates_risk"
                desc = f"Elevated SST of {val:.1f}°C exceeds the 28.5°C threshold for convective intensification"
            elif val < 27.0:
                direction = "reduces_risk"
                desc = f"Moderate SST ({val:.1f}°C) dampens marine heat energy"
        elif name == 'wind_speed':
            if val >= 10.0:
                direction = "elevates_risk"
                desc = f"High surface wind speed ({val:.1f} m/s) indicates intense atmospheric shear"
            elif val <= 3.0:
                direction = "reduces_risk"
                desc = f"Calm surface winds ({val:.1f} m/s) indicate stable atmospheric state"
        elif name == 'sea_level_pressure':
            if val <= 1005.0:
                direction = "elevates_risk"
                desc = f"Depressed surface pressure ({val:.1f} hPa) indicates active cyclonic trough"
            elif val >= 1014.0:
                direction = "reduces_risk"
                desc = f"High atmospheric pressure ({val:.1f} hPa) indicates anticyclonic stability"
        elif name == 'current_speed':
            if val >= 0.70:
                direction = "elevates_risk"
                desc = f"Energetic surface current ({val:.2f} m/s) suggests active mesoscale eddy / shear"
        elif name == 'sea_surface_height':
            if val >= 0.15:
                direction = "elevates_risk"
                desc = f"Positive sea level anomaly (+{val:.2f} m) indicates anticyclonic downwelling / heat accumulation"
        elif name == 'pressure_change_6h':
            if val <= -2.0:
                direction = "elevates_risk"
                desc = f"Rapid barometric drop ({val:.1f} hPa in 6h) signals approaching depression"

        # Local score combines importance with deviation
        local_weight = imp
        if direction == "elevates_risk":
            local_weight *= 1.5

        scored_factors.append((
            local_weight,
            FeatureExplanation(
                feature=name,
                importance=round(float(imp), 4),
                value=round(float(val), 3),
                direction=direction,
                description=desc
            )
        ))

    # Sort descending by local contribution weight
    scored_factors.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in scored_factors[:max_features]]
