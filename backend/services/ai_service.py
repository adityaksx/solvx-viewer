"""
SolvX — Scientific AI Assistant Service
=======================================
Implements Stage 6 AI capabilities:
1. Explaining structured oceanographic analysis results (Model vs Argo, coverage,
   gaps, anomalies) in natural language without inventing measurements.
2. Converting natural language user requests into validated 3D visualization commands
   (FOCUS_REGION, SET_DEPTH, SET_VARIABLE, SHOW_LAYER, VERTICAL_SLICE).

Follows plan.md Section 16 & 17:
- AI is added AFTER deterministic analysis.
- AI never calculates raw scientific values directly.
- AI only consumes structured analysis output.
- All visualization commands pass through strict Pydantic validation before execution.
"""

import json
import re
from typing import Dict, Any, Optional, Tuple, List
from google import genai
from google.genai import types

from ..config import GEMINI_API_KEY, GEMINI_MODEL
from ..models.ai import (
    VisualizationCommand,
    AIQueryResponse,
    NLCommandResponse,
    AIStatusResponse
)
from .analysis_service import (
    generate_analysis_summary,
    detect_anomalies,
    extract_abnormal_regions
)


def get_ai_status() -> AIStatusResponse:
    """Returns the operational status of the Gemini AI assistant."""
    has_key = bool(GEMINI_API_KEY and GEMINI_API_KEY.strip())
    return AIStatusResponse(
        available=has_key,
        model=GEMINI_MODEL,
        message="AI Assistant operational with Gemini" if has_key else (
            "GEMINI_API_KEY environment variable is not set. "
            "Configure GEMINI_API_KEY in your environment to enable AI-driven explanations."
        )
    )


def build_analysis_context(
    variable: str = 'temperature',
    method: str = 'zscore',
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Builds a concise, structured analysis context from deterministic services.
    Raw NetCDF grid arrays are NEVER passed to the AI; only validated scientific metrics.
    """
    summary = generate_analysis_summary(
        min_lon=min_lon, max_lon=max_lon,
        min_lat=min_lat, max_lat=max_lat,
        variable=variable
    )
    anomalies_res = detect_anomalies(
        variable=variable,
        method=method,
        threshold_sigma=2.0,
        threshold_abs=2.0,
        min_lon=min_lon, max_lon=max_lon,
        min_lat=min_lat, max_lat=max_lat
    )
    regions_res = extract_abnormal_regions(
        variable=variable,
        method=method,
        threshold_sigma=2.0,
        threshold_abs=2.0,
        min_lon=min_lon, max_lon=max_lon,
        min_lat=min_lat, max_lat=max_lat
    )

    # Pick top 5 anomalies for concise context
    top_anomalies = [
        {
            "float_id": a.float_id,
            "depth_m": a.depth,
            "lat": a.latitude,
            "lon": a.longitude,
            "observed": a.value,
            "baseline": a.baseline,
            "diff": a.difference,
            "severity": a.severity,
            "method": a.detection_method
        }
        for a in (anomalies_res.anomalies[:5] if anomalies_res.anomalies else [])
    ]

    abnormal_zones = [
        {
            "id": r.id,
            "name": r.name,
            "depth_range_m": r.depth_range_m,
            "severity": r.severity,
            "mean_diff": r.anomaly_magnitude_mean,
            "center_lat": r.focus_command.lat,
            "center_lon": r.focus_command.lon,
            "center_depth": r.focus_command.depth
        }
        for r in regions_res.regions
    ]

    return {
        "variable": variable,
        "method": method,
        "model_accuracy": summary.model_accuracy,
        "observation_coverage": {
            "spatial_coverage_pct": summary.observation_coverage.get("spatial_coverage_pct"),
            "total_observations": summary.observation_coverage.get("total_observations"),
            "density_summary": summary.observation_coverage.get("density_summary"),
        },
        "data_gaps": {
            "gap_percentage": summary.data_gaps.get("gap_percentage"),
            "empty_cells_count": summary.data_gaps.get("empty_cells_count"),
            "critical_gaps": summary.data_gaps.get("critical_gaps", []),
        },
        "anomaly_count": anomalies_res.anomaly_count,
        "top_anomalies": top_anomalies,
        "abnormal_regions": abnormal_zones
    }


def _rule_based_fallback_command(text: str, default_var: str = 'temperature') -> Optional[VisualizationCommand]:
    """Deterministic regex pattern matcher for common oceanographic viewer actions."""
    t = text.lower()

    # 1. Depth setting: e.g. "set depth 100m", "go to 250 m depth", "depth: 50"
    m_depth = re.search(r'(?:depth|level)\s*(?:of|at|to|=)?\s*(\d+(?:\.\d+)?)\s*(?:m|meters)?', t)
    if not m_depth:
        m_depth = re.search(r'(\d+(?:\.\d+)?)\s*(?:m|meters)\s+depth', t)

    # 2. Variable setting: "show salinity", "variable temperature"
    var = None
    if 'salin' in t or 'so' in t:
        var = 'salinity'
    elif 'temp' in t or 'theta' in t:
        var = 'temperature'

    # 3. Coordinate focus: "focus on 18.5, 88.2" or "lat 19 lon 89"
    m_coords = re.search(r'(-?\d+\.?\d*)\s*[,/ ]\s*(-?\d+\.?\d*)', t)
    lat, lon = None, None
    if m_coords:
        v1, v2 = float(m_coords.group(1)), float(m_coords.group(2))
        if 10 <= v1 <= 30 and 70 <= v2 <= 100:
            lat, lon = v1, v2
        elif 10 <= v2 <= 30 and 70 <= v1 <= 100:
            lat, lon = v2, v1

    # 4. Layer toggle: "show currents", "show anomaly", "show bathymetry"
    layer = None
    if 'current' in t or 'vector' in t:
        layer = 'currents'
    elif 'anomal' in t:
        layer = 'anomaly'

    if lat is not None and lon is not None:
        depth = float(m_depth.group(1)) if m_depth else 0.0
        return VisualizationCommand(
            action="FOCUS_REGION",
            lat=lat,
            lon=lon,
            depth=depth,
            variable=var or default_var,
            layer=layer or "anomaly"
        )
    elif m_depth:
        depth = float(m_depth.group(1))
        return VisualizationCommand(
            action="SET_DEPTH",
            depth=depth,
            variable=var or default_var
        )
    elif var:
        return VisualizationCommand(
            action="SET_VARIABLE",
            variable=var
        )
    elif layer:
        return VisualizationCommand(
            action="SHOW_LAYER",
            layer=layer
        )

    return None


def explain_analysis(
    question: str,
    variable: str = 'temperature',
    method: str = 'zscore',
    client_context: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None,
) -> AIQueryResponse:
    """
    Produces a scientifically grounded AI explanation of current ocean analysis.
    Uses google-genai to synthesize insights from structured metrics.
    """
    key = api_key or GEMINI_API_KEY
    if not key or not key.strip():
        # Deterministic fallback when API key is unconfigured
        ctx = client_context or build_analysis_context(variable=variable, method=method)
        mod_acc = ctx.get("model_accuracy", {})
        rmse = mod_acc.get("overall_rmse", 0.0)
        bias = mod_acc.get("overall_bias", 0.0)
        top_disc = mod_acc.get("top_discrepancy")

        explanation_parts = [
            f"Analysis for {variable.capitalize()} indicates an overall model RMSE of {rmse:.3f} °C (mean bias {bias:+.3f} °C) "
            f"across {mod_acc.get('floats_compared', 0)} in-situ Argo profiling floats."
        ]
        if top_disc:
            explanation_parts.append(
                f" The largest model-observation discrepancy occurs at Float {top_disc.get('float_id')} "
                f"(lat {top_disc.get('latitude'):.2f}°, lon {top_disc.get('longitude'):.2f}°) with an RMSE of {top_disc.get('rmse', 0):.3f}."
            )
        gaps = ctx.get("data_gaps", {})
        if gaps.get("gap_percentage"):
            explanation_parts.append(
                f" Approximately {gaps.get('gap_percentage'):.1f}% of the basin currently lacks in-situ float coverage."
            )

        cmd = None
        if top_disc:
            cmd = VisualizationCommand(
                action="FOCUS_REGION",
                lat=top_disc.get("latitude", 18.0),
                lon=top_disc.get("longitude", 88.0),
                depth=0.0,
                variable=variable,
                layer="anomaly"
            )

        return AIQueryResponse(
            question=question,
            explanation=" ".join(explanation_parts),
            confidence="deterministic-fallback",
            data_sources=["Copernicus Global Ocean Analysis (NEMO)", "WMO Argo Float Array"],
            command=cmd,
            disclaimer="Grounded in computed oceanographic analysis. (Set GEMINI_API_KEY for conversational AI analysis)."
        )

    # Call Gemini API
    client = genai.Client(api_key=key)
    ctx = client_context or build_analysis_context(variable=variable, method=method)

    system_instruction = (
        "You are the SolvX Oceanographic AI Science Assistant. "
        "Your role is to explain deterministic ocean model validation and observation intelligence results to marine researchers. "
        "Strict scientific rules:\n"
        "1. GROUNDING: Ground your answers strictly in the provided JSON structured metrics. "
        "   Never invent float IDs, temperatures, depths, salinity measurements, causes, warnings, or forecasts.\n"
        "2. DISTINCTIONS: You must clearly distinguish between what is OBSERVED (direct Argo/Glider measurements), "
        "   COMPUTED (deterministic differences, RMSE, Bias, MAE, Z-scores), INFERRED (statistical tendencies), and UNKNOWN.\n"
        "3. HONESTY: If the loaded data does not establish an answer, state: 'I cannot determine that from the currently loaded data.'\n"
        "4. DATA SOURCES: Reference the Copernicus Marine NEMO numerical model and WMO Argo floats.\n"
        "5. VISUALIZATION: If relevant to the user's question, provide a visualization command "
        "   (e.g. FOCUS_REGION with lat, lon, depth, variable) to guide the 3D viewer.\n"
        "6. Respond strictly in JSON format conforming to the expected schema."
    )

    prompt = (
        f"User Question: {question}\n\n"
        f"Computed Oceanographic Analysis Context:\n{json.dumps(ctx, indent=2)}\n\n"
        "Please provide an explanation and an optional 3D navigation command if helpful."
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=AIQueryResponse,
                temperature=0.2,
            )
        )
        if response.text:
            data = json.loads(response.text)
            return AIQueryResponse.model_validate(data)
    except Exception as e:
        # Graceful fallback to deterministic synthesis if API error occurs
        pass

    # Safe deterministic fallback if API call fails
    cmd = _rule_based_fallback_command(question, default_var=variable)
    return AIQueryResponse(
        question=question,
        explanation=f"Based on computed metrics for {variable}: Model RMSE is {ctx.get('model_accuracy', {}).get('overall_rmse', 0):.3f}. Data gaps span {ctx.get('data_gaps', {}).get('gap_percentage', 0):.1f}% of the grid.",
        confidence="fallback",
        data_sources=["Copernicus Marine NEMO", "WMO Argo Float Array"],
        command=cmd,
        disclaimer="AI explanation grounded in deterministic oceanographic analysis results."
    )


def parse_nl_command(
    text: str,
    variable: str = 'temperature',
    api_key: Optional[str] = None
) -> NLCommandResponse:
    """
    Parses natural language instructions into validated 3D visualization commands.
    Ensures safe, bounded execution by enforcing the VisualizationCommand Pydantic schema.
    """
    key = api_key or GEMINI_API_KEY
    rule_cmd = _rule_based_fallback_command(text, default_var=variable)

    if not key or not key.strip():
        if rule_cmd:
            return NLCommandResponse(
                original_text=text,
                parsed_command=rule_cmd,
                explanation=f"Interpreted action: {rule_cmd.action} for {rule_cmd.variable or variable}."
            )
        # Default safe focus
        default_cmd = VisualizationCommand(action="SET_VARIABLE", variable=variable)
        return NLCommandResponse(
            original_text=text,
            parsed_command=default_cmd,
            explanation="Defaulted to setting active variable. (Configure GEMINI_API_KEY for advanced NLP commands)."
        )

    # Call Gemini for complex natural language instructions
    client = genai.Client(api_key=key)
    system_instruction = (
        "You are a command parser for a 3D oceanographic viewer. "
        "Translate the user's natural language into a validated visualization command. "
        "Allowed actions strictly: FOCUS_REGION, SET_DEPTH, SET_VARIABLE, SHOW_LAYER, VERTICAL_SLICE. "
        "Provide appropriate numeric parameters (lat, lon, depth in meters, variable). "
        "Respond strictly in JSON matching the VisualizationCommand schema."
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=f"Convert this viewer instruction to a 3D command: '{text}'. Current active variable: {variable}.",
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=VisualizationCommand,
                temperature=0.1,
            )
        )
        if response.text:
            cmd_data = json.loads(response.text)
            validated_cmd = VisualizationCommand.model_validate(cmd_data)
            return NLCommandResponse(
                original_text=text,
                parsed_command=validated_cmd,
                explanation=f"Translated '{text}' into action {validated_cmd.action}."
            )
    except Exception:
        pass

    # Fallback to rule-based parser
    final_cmd = rule_cmd or VisualizationCommand(action="SET_VARIABLE", variable=variable)
    return NLCommandResponse(
        original_text=text,
        parsed_command=final_cmd,
        explanation=f"Mapped to action {final_cmd.action}."
    )
