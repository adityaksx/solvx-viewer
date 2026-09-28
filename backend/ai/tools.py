"""
SolvX — AI Scientific Tool Definitions & Interfaces
===================================================
Defines JSON-schema compliant tool specifications and python dispatchers
for the 15 scientific and oceanographic tools in SolvX.
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from .tool_registry import (
    get_dataset_metadata,
    resolve_region,
    resolve_variable,
    query_point_value,
    query_region_statistics,
    query_time_series,
    query_depth_profile,
    query_argo_profiles,
    compare_model_observations,
    detect_anomalies,
    find_observation_gaps,
    get_data_provenance
)
from ..services.data_collector import COLLECTOR


# =============================================================================
# Additional Scientific Tool Implementations
# =============================================================================

def query_ocean_data(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None,
    depth: Optional[float] = None,
    time: Optional[str] = None,
    provider: str = 'auto'
) -> Dict[str, Any]:
    """Queries unified multi-provider ocean dataset for a region."""
    b = bbox or {}
    try:
        res = COLLECTOR.get_ocean_data(
            provider=provider,
            variable=variable,
            min_lat=b.get('min_lat'),
            max_lat=b.get('max_lat'),
            min_lon=b.get('min_lon'),
            max_lon=b.get('max_lon'),
            depth=depth,
            time=time
        )
        return {
            "status": "success",
            "provider": res.get("provider", provider),
            "variable": res.get("variable", variable),
            "units": res.get("units", ""),
            "stats": res.get("stats", {})
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def calculate_rmse(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """Computes Root Mean Square Error (RMSE) between model and in-situ Argo observations."""
    comp = compare_model_observations(variable=variable, bbox=bbox)
    return {
        "status": "success",
        "variable": variable,
        "rmse": comp.get("overall_rmse", 0.0),
        "floats_compared": comp.get("floats_compared", 0),
        "units": "°C" if "temp" in variable else ("PSU" if "sal" in variable else "m/s")
    }


def calculate_bias(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """Computes mean bias (Model - Obs) across collocated depth layers."""
    comp = compare_model_observations(variable=variable, bbox=bbox)
    return {
        "status": "success",
        "variable": variable,
        "mean_bias": comp.get("overall_bias", 0.0),
        "floats_compared": comp.get("floats_compared", 0),
        "units": "°C" if "temp" in variable else ("PSU" if "sal" in variable else "m/s")
    }


def calculate_uncertainty(
    variable: str = 'temperature',
    bbox: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """Estimates observation gap uncertainty and spatial interpolation confidence."""
    gaps = find_observation_gaps(bbox=bbox, variable=variable)
    comp = compare_model_observations(variable=variable, bbox=bbox)
    
    gap_pct = gaps.get("gap_percentage", 80.0)
    rmse = comp.get("overall_rmse", 1.0)
    
    # Combined uncertainty index (0.0 = high confidence, 1.0 = high uncertainty)
    uncertainty_score = round(min(1.0, (gap_pct / 100.0) * 0.7 + min(rmse / 5.0, 1.0) * 0.3), 3)
    confidence_level = "High" if uncertainty_score < 0.3 else ("Medium" if uncertainty_score < 0.7 else "Low")
    
    return {
        "status": "success",
        "variable": variable,
        "uncertainty_score": uncertainty_score,
        "confidence_level": confidence_level,
        "gap_percentage": gap_pct,
        "model_rmse": rmse
    }


# =============================================================================
# Tool Schema Catalog (For Model Function Calling / Tool Selection)
# =============================================================================

SOLVX_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_dataset_metadata",
            "description": "Retrieves available datasets, ocean variables, and temporal range in the active SolvX instance.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_region",
            "description": "Validates coordinates or resolves named oceanographic regions (e.g. 'Bay of Bengal', 'Arabian Sea').",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Preset region name"},
                    "bbox": {"type": "object", "description": "Bounding box with min_lat, max_lat, min_lon, max_lon"},
                    "lat": {"type": "number", "description": "Specific latitude"},
                    "lon": {"type": "number", "description": "Specific longitude"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_variable",
            "description": "Maps natural language variable names or abbreviations to controlled physical/BGC variable IDs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "var_name": {"type": "string", "description": "Variable query name, e.g. 'temperature', 'salinity', 'chlorophyll'"}
                },
                "required": ["var_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_ocean_data",
            "description": "Queries unified multi-provider ocean dataset for a region and depth horizon.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Ocean variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"},
                    "depth": {"type": "number", "description": "Depth in meters"},
                    "time": {"type": "string", "description": "ISO timestamp"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_point_value",
            "description": "Queries exact numeric ocean value at a specific latitude, longitude, and depth.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "description": "Latitude [-90, 90]"},
                    "lon": {"type": "number", "description": "Longitude [-180, 180]"},
                    "variable": {"type": "string", "description": "Variable ID"},
                    "depth": {"type": "number", "description": "Depth in meters"}
                },
                "required": ["lat", "lon"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_region_statistics",
            "description": "Computes spatial summary statistics (mean, min, max, std, percentiles) for a regional domain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"},
                    "depth": {"type": "number", "description": "Depth in meters"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_time_series",
            "description": "Computes temporal progression and trends over historical multi-year records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "description": "Latitude"},
                    "lon": {"type": "number", "description": "Longitude"},
                    "variable": {"type": "string", "description": "Variable ID"},
                    "start_time": {"type": "string", "description": "Start date/time"},
                    "end_time": {"type": "string", "description": "End date/time"}
                },
                "required": ["lat", "lon"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_depth_profile",
            "description": "Retrieves vertical sounding profile (values vs depth levels from surface to abyss).",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "description": "Latitude"},
                    "lon": {"type": "number", "description": "Longitude"},
                    "variable": {"type": "string", "description": "Variable ID"}
                },
                "required": ["lat", "lon"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_argo_profiles",
            "description": "Retrieves in-situ WMO Argo float profiles within geographic/temporal bounds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_model_observations",
            "description": "Collocates and benchmarks numerical ocean model against in-situ Argo observations (computes RMSE and bias).",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_rmse",
            "description": "Computes Root Mean Square Error between model predictions and direct in-situ Argo soundings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_bias",
            "description": "Computes mean bias (Model - Observation) across collocated soundings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "detect_anomalies",
            "description": "Identifies extreme spatial/temporal outliers based on climatological rolling baselines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"},
                    "threshold_sigma": {"type": "number", "description": "Statistical standard deviation threshold"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_uncertainty",
            "description": "Estimates observation gap uncertainty and spatial interpolation confidence in the domain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_observation_gaps",
            "description": "Analyzes geographic and temporal gaps where in-situ sounding coverage is sparse.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_data_provenance",
            "description": "Generates auditable scientific data lineage records for cited datasets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string", "description": "Variable ID"},
                    "bbox": {"type": "object", "description": "Bounding box coordinates"}
                },
                "required": ["variable"]
            }
        }
    }
]

# Dispatcher mapping
TOOL_DISPATCHER = {
    "get_dataset_metadata": get_dataset_metadata,
    "resolve_region": resolve_region,
    "resolve_variable": resolve_variable,
    "query_ocean_data": query_ocean_data,
    "query_point_value": query_point_value,
    "query_region_statistics": query_region_statistics,
    "query_time_series": query_time_series,
    "query_depth_profile": query_depth_profile,
    "query_argo_profiles": query_argo_profiles,
    "compare_model_observations": compare_model_observations,
    "calculate_rmse": calculate_rmse,
    "calculate_bias": calculate_bias,
    "detect_anomalies": detect_anomalies,
    "calculate_uncertainty": calculate_uncertainty,
    "find_observation_gaps": find_observation_gaps,
    "get_data_provenance": get_data_provenance,
}
