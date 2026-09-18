ML_ANOMALY_THRESHOLDS = {
    'low': 20.0,
    'moderate': 40.0,
    'high': 60.0,
    'extreme': 80.0
}

HAZARD_RISK_THRESHOLDS = {
    'Normal': 0.0,
    'Watch': 20.0,
    'Elevated': 40.0,
    'High': 60.0,
    'Severe': 80.0
}

# The variables we actually have access to from adapters
AVAILABLE_VARIABLES = [
    'temperature', 'salinity', 'currents', 'sea_surface_height',
    'sea_level_anomaly', 'mixed_layer_depth', 'tropical_cyclone_heat_potential'
]

ATMOSPHERIC_WARNING = "Atmospheric inputs unavailable — cyclone intensity prediction confidence reduced."
NO_SEISMIC_WARNING = "Tsunami prediction unavailable — required seismic/sea-level inputs are not present."

