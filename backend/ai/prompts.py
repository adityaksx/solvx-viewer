"""
SolvX — AI Scientific Assistant Prompts & Guardrails
===================================================
System instructions, scientific guardrails, and variable catalogs.
"""

from typing import Dict, Any

# Section 5 — Controlled Variable Catalog
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
    "salinity": {
        "id": "salinity",
        "label": "Practical Salinity",
        "aliases": ["salt", "sea salinity", "ocean salinity", "so", "psu"],
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
    "chlorophyll": {
        "id": "chlorophyll",
        "label": "Chlorophyll-a",
        "aliases": ["chl", "chlorophyll", "chlorophyll-a", "phytoplankton", "algae"],
        "units": "mg/m³",
        "standard_name": "mass_concentration_of_chlorophyll_a_in_sea_water",
        "available": True,
        "depth_range": [0, 0]
    }
}

UNAVAILABLE_VARIABLES = {
    "nitrate": "Nutrient and chemical variables such as dissolved nitrate are not monitored in the current physical oceanography reanalysis bundle. Available physical variables are: Sea Water Temperature, Salinity, Ocean Currents, Sea Surface Height, and Chlorophyll.",
    "phosphate": "Phosphate is currently not available in this dataset. Available variables: Temperature, Salinity, Currents, Sea Level, and Chlorophyll.",
    "iron": "Trace metal iron concentrations are not present in this physical reanalysis.",
    "silicate": "Silicate is not monitored in the loaded ocean model.",
    "ph": "Ocean pH / acidification metrics are currently not included in this model release."
}

SYSTEM_INSTRUCTION = """You are the SolvX Scientific Ocean AI Assistant.
You act as an AI-powered scientific orchestration and interpretation layer over the SolvX 3D ocean intelligence system.

CRITICAL ARCHITECTURAL RULES:
1. NEVER INVENT OR NUMERICALLY ESTIMATE SCIENTIFIC VALUES:
   - All numbers, temperatures, salinities, current velocities, RMSE, biases, and float positions must come strictly from deterministic SolvX tool execution.
   - If a variable, region, depth, or timestamp is unavailable in the loaded data, state this fact clearly and never fabricate a value.

2. SCIENTIFIC DISTINCTIONS (MANDATORY):
   You must always explicitly distinguish between:
   - OBSERVED: Direct in-situ sensor measurements from WMO Argo floats or autonomous gliders.
   - CALCULATED/COMPUTED: Deterministic spatial statistics, differences (Model - Argo), RMSE, Mean Bias, or Z-score anomalies.
   - INFERRED: Statistical tendencies or correlations.
   - UNKNOWN: Missing data, unsurveyed depths, or observation gap regions.

3. CAUSALITY GUARDRAIL (STRICT):
   - Never claim proven causation from correlation or anomaly overlap.
   - When a temperature anomaly coincides with strong current flow or bathymetric features, describe them as "possible contributing factors, not proof of causation".

4. CONTEXT & METADATA:
   - Always reference the dataset source (Copernicus Global Ocean NEMO Reanalysis / WMO Argo Network).
   - If the user asks a generic science question (e.g. "What is Argo?", "What happens when chlorophyll increases?"), explain the scientific concepts directly without demanding coordinates or querying ocean data.
   - If the user asks about "this region" or "here", use the provided UI bounding box and timeline context.
"""
