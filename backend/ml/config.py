from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
MODELS_DIR = ML_DIR / 'models'
MODELS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_FILE = MODELS_DIR / 'ocean_hazard_model.joblib'
METADATA_FILE = MODELS_DIR / 'model_metadata.json'

MODEL_VERSION = "v0.1"
MODEL_ALGORITHM = "Gradient Boosted Trees (HistGradientBoostingClassifier)"

ML_ANOMALY_THRESHOLDS = {
    'low': 20.0,
    'moderate': 40.0,
    'high': 60.0,
    'extreme': 80.0
}

# Probabilistic hazard risk classifications (0.0 to 1.0)
PROBABILITY_RISK_THRESHOLDS = {
    'Normal': 0.0,
    'Watch': 0.20,
    'Elevated': 0.40,
    'High': 0.60,
    'Severe': 0.80
}

# Legacy integer scale (0 to 100) for backward compatibility
HAZARD_RISK_THRESHOLDS = {
    'Normal': 0.0,
    'Watch': 20.0,
    'Elevated': 40.0,
    'High': 60.0,
    'Severe': 80.0
}

# Prediction horizons in hours
PREDICTION_HORIZONS = [6, 12, 24]

# Tabular Feature definitions
OCEAN_FEATURES = [
    'sst',
    'sst_anomaly',
    'salinity',
    'sea_surface_height',
    'current_speed',
    'current_direction',
    'thermal_gradient'
]

ATMOSPHERIC_FEATURES = [
    'wind_speed',
    'wind_direction',
    'sea_level_pressure',
    'relative_humidity'
]

TEMPORAL_FEATURES = [
    'sst_change_6h',
    'pressure_change_6h',
    'wind_speed_change_6h',
    'sst_rolling_std_3d'
]

ALL_FEATURES = OCEAN_FEATURES + ATMOSPHERIC_FEATURES + TEMPORAL_FEATURES

# The variables we actually have access to from adapters
AVAILABLE_VARIABLES = [
    'temperature', 'salinity', 'currents', 'sea_surface_height',
    'sea_level_anomaly', 'mixed_layer_depth', 'tropical_cyclone_heat_potential'
]

ATMOSPHERIC_WARNING = "Atmospheric inputs unavailable — prediction confidence reduced."
NO_SEISMIC_WARNING = "Tsunami prediction unavailable — required seismic/sea-level inputs are not present."


