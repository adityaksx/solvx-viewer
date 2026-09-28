"""
SolvX — AI Scientific Assistant Prompts, Guardrails & Variable Catalogs
======================================================================
System instructions, scientific guardrails, and variable catalogs.
"""

from typing import Dict, Any

# Section 5 — Controlled Variable Catalog (Supporting Physical, BGC, and Atmospheric variables)
VARIABLE_CATALOG: Dict[str, Dict[str, Any]] = {
    "temperature": {
        "id": "temperature",
        "label": "Sea Water Temperature",
        "aliases": ["temp", "sea temperature", "water temperature", "sst", "ocean temperature", "thetao"],
        "units": "°C",
        "standard_name": "sea_water_potential_temperature",
        "available": True,
        "depth_range": [0, 541]
    },
    "ocean_temperature": {
        "id": "ocean_temperature",
        "label": "Sea Water Temperature",
        "aliases": ["ocean temperature", "sea water temp", "thetao"],
        "units": "°C",
        "standard_name": "sea_water_potential_temperature",
        "available": True,
        "depth_range": [0, 541]
    },
    "salinity": {
        "id": "salinity",
        "label": "Practical Salinity",
        "aliases": ["salt", "sea salinity", "ocean salinity", "so", "psu", "sss"],
        "units": "PSU",
        "standard_name": "sea_water_salinity",
        "available": True,
        "depth_range": [0, 541]
    },
    "currents": {
        "id": "currents",
        "label": "Ocean Velocity (Currents)",
        "aliases": ["current", "water flow", "ocean current", "velocity", "stream", "uo", "vo", "speed", "flow"],
        "units": "m/s",
        "standard_name": "sea_water_velocity",
        "available": True,
        "components": ["uo", "vo"],
        "depth_range": [0, 541]
    },
    "sea_level": {
        "id": "sea_level",
        "label": "Sea Surface Height / Sea Level",
        "aliases": ["ssh", "sea surface height", "sea level", "sea_surface_height", "zos", "sla", "anomaly"],
        "units": "m",
        "standard_name": "sea_surface_height_above_geoid",
        "available": True,
        "depth_range": [0, 0]
    },
    "sea_surface_height": {
        "id": "sea_surface_height",
        "label": "Sea Surface Height",
        "aliases": ["ssh", "sea surface height", "zos"],
        "units": "m",
        "standard_name": "sea_surface_height_above_geoid",
        "available": True,
        "depth_range": [0, 0]
    },
    "mixed_layer_depth": {
        "id": "mixed_layer_depth",
        "label": "Mixed Layer Depth",
        "aliases": ["mld", "mixed layer", "mlotst"],
        "units": "m",
        "standard_name": "ocean_mixed_layer_thickness",
        "available": True,
        "depth_range": [0, 0]
    },
    "temperature_anomaly": {
        "id": "temperature_anomaly",
        "label": "Sea Surface Temperature Anomaly",
        "aliases": ["sst anomaly", "temp anomaly", "ssta"],
        "units": "°C",
        "standard_name": "sea_surface_temperature_anomaly",
        "available": True,
        "depth_range": [0, 0]
    },
    "chlorophyll": {
        "id": "chlorophyll",
        "label": "Chlorophyll-a",
        "aliases": ["chl", "chlorophyll", "chlorophyll-a", "phytoplankton", "algae"],
        "units": "mg/m³",
        "standard_name": "mass_concentration_of_chlorophyll_a_in_sea_water",
        "available": True,
        "depth_range": [0, 200]
    },
    "dissolved_oxygen": {
        "id": "dissolved_oxygen",
        "label": "Dissolved Oxygen",
        "aliases": ["o2", "oxygen", "dissolved oxygen", "do"],
        "units": "mmol/m³",
        "standard_name": "mole_concentration_of_dissolved_molecular_oxygen_in_sea_water",
        "available": True,
        "depth_range": [0, 500]
    },
    "ph": {
        "id": "ph",
        "label": "Ocean pH / Acidity",
        "aliases": ["ph", "acidity", "ocean ph"],
        "units": "pH",
        "standard_name": "sea_water_ph_reported_on_total_scale",
        "available": True,
        "depth_range": [0, 500]
    },
    "nitrate": {
        "id": "nitrate",
        "label": "Nitrate (NO3)",
        "aliases": ["no3", "nitrate", "dissolved nitrate"],
        "units": "mmol/m³",
        "standard_name": "mole_concentration_of_nitrate_in_sea_water",
        "available": True,
        "depth_range": [0, 500]
    },
    "phosphate": {
        "id": "phosphate",
        "label": "Phosphate (PO4)",
        "aliases": ["po4", "phosphate", "dissolved phosphate"],
        "units": "mmol/m³",
        "standard_name": "mole_concentration_of_phosphate_in_sea_water",
        "available": True,
        "depth_range": [0, 500]
    },
    "wave_height": {
        "id": "wave_height",
        "label": "Significant Wave Height",
        "aliases": ["wave", "waves", "wave height", "swh", "sea height"],
        "units": "m",
        "standard_name": "sea_surface_wave_significant_height",
        "available": True,
        "depth_range": [0, 0]
    },
    "wind_speed": {
        "id": "wind_speed",
        "label": "Surface Wind Speed",
        "aliases": ["wind", "wind speed", "winds"],
        "units": "m/s",
        "standard_name": "wind_speed",
        "available": True,
        "depth_range": [0, 0]
    }
}

UNAVAILABLE_VARIABLES = {
    "nitrate": "Nutrient and chemical variables such as dissolved nitrate are not monitored in the current physical oceanography reanalysis dataset. Available physical variables are: Sea Water Temperature, Salinity, Ocean Currents, and Sea Surface Height.",
    "phosphate": "Phosphate is currently not available in this dataset. Available variables: Temperature, Salinity, Currents, and Sea Level.",
    "iron": "Trace metal iron concentrations are not present in this physical reanalysis.",
    "silicate": "Silicate is not monitored in the loaded ocean model.",
    "ph": "Ocean pH / acidification metrics are currently not included in this model release."
}

SYSTEM_INSTRUCTION = """You are the SolvX Scientific Ocean AI Assistant powered by NVIDIA NIM inference.
You serve as the scientific reasoning and orchestration layer of the SolvX operational ocean intelligence system.

Core Operational Workflow:
Explore → Observe → Compare → Diagnose → Decide

CRITICAL ARCHITECTURAL RULES & SCIENTIFIC GUARDRAILS:

1. NEVER INVENT OR FABRICATE SCIENTIFIC VALUES:
   - All physical metrics (temperatures, salinities, velocities, RMSE, biases, anomalies) MUST originate strictly from the computed SolvX deterministic tool outputs provided in your context.
   - Never invent observation soundings, float positions, or statistical metrics.
   - When uncertainty, observation gaps, or missing data exist, explicitly mention them.

2. SCIENTIFIC DISTINCTIONS (MANDATORY):
   You must always explicitly distinguish between:
   - OBSERVED FACT: Direct in-situ sensor measurements from WMO Argo profiling floats or autonomous underwater gliders.
   - CALCULATED STATISTIC: Deterministic spatial summaries, model-observation discrepancies (RMSE, Mean Bias), or Z-score anomalies.
   - NUMERICAL MODEL OUTPUT: Hydrodynamic reanalysis or forecast predictions (e.g. Copernicus NEMO v4, INCOIS HOOFS, HYCOM, NOAA).
   - INFERENCE / HYPOTHESIS: Plausible physical mechanisms or hypotheses suggested by observed data.
   - POSSIBLE CONTRIBUTING FACTOR: Conditions that spatially correlate with an event.

3. CAUSALITY GUARDRAIL (STRICT):
   - Never claim proven causation merely because two variables correlate or spatially coincide.
   - Describe coincident thermal anomalies or current speeds as "possible contributing factors, not established proof of causation".
   - Mention alternative physical mechanisms such as surface atmospheric heat flux, mixed layer shoaling, Ekman pumping, or upwelling suppression.

4. 3D VISUALIZATION COMMANDS:
   When relevant to the user request, you may output structured visualization commands that the client 3D WebGL viewer will execute (e.g. set_depth, set_variable, show_argo, highlight_region, focus_location).
   The frontend validates and runs these commands safely.

5. CONTEXTUAL ACCURACY & GENERAL OCEAN SCIENCE:
   - For general educational/science questions (e.g. "What is Argo?", "Explain ocean physics", "Explain glider", "What is RMSE?"), explain the scientific oceanographic concepts directly and clearly using standard oceanographic principles.
   - For location or regional queries, ground your interpretation strictly in the provided computed data metrics and cite data sources (e.g. Copernicus Marine Service / WMO Argo Network).
"""
