"""
SolvX — AI Assistant Data Models
================================
Pydantic schemas for scientific AI explanation, natural-language command
parsing, and validated 3D visualization commands.
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


class VisualizationCommand(BaseModel):
    """
    Validated visualization command schema.
    Constrained to allowed actions to prevent arbitrary frontend manipulation.
    """
    action: Literal["FOCUS_REGION", "SET_DEPTH", "SET_VARIABLE", "SHOW_LAYER", "VERTICAL_SLICE"] = Field(
        ...,
        description="Structured action to execute in 3D viewer"
    )
    variable: Optional[str] = Field(None, description="Ocean variable name (e.g. 'temperature', 'salinity')")
    depth: Optional[float] = Field(None, description="Depth level in meters")
    lat: Optional[float] = Field(None, description="Target latitude in degrees")
    lon: Optional[float] = Field(None, description="Target longitude in degrees")
    start_lat: Optional[float] = Field(None, description="Vertical slice start latitude")
    start_lon: Optional[float] = Field(None, description="Vertical slice start longitude")
    end_lat: Optional[float] = Field(None, description="Vertical slice end latitude")
    end_lon: Optional[float] = Field(None, description="Vertical slice end longitude")
    layer: Optional[str] = Field(None, description="Visualization layer name (e.g. 'anomaly', 'currents')")
    analysis: Optional[str] = Field(None, description="Analysis filter type if applicable")
    threshold: Optional[float] = Field(None, description="Value threshold for anomaly or comparison filter")


class AnalysisQueryRequest(BaseModel):
    """User request asking the AI to interpret or investigate ocean analysis."""
    question: str = Field(..., description="Natural language question from user")
    variable: str = Field('temperature', description="Active ocean variable ('temperature' or 'salinity')")
    method: str = Field('zscore', description="Active anomaly detection method")
    context: Optional[Dict[str, Any]] = Field(None, description="Optional client-provided analysis context")


class AIQueryResponse(BaseModel):
    """AI-generated explanation grounded in deterministic oceanographic analysis results."""
    question: str
    explanation: str
    confidence: str = "high"
    data_sources: List[str] = Field(
        default_factory=lambda: ["Copernicus Marine NEMO Reanalysis", "WMO Argo Float Profiling Network"]
    )
    command: Optional[VisualizationCommand] = None
    disclaimer: str = "AI-generated explanation grounded strictly in computed oceanographic analysis results."


class NLCommandRequest(BaseModel):
    """Natural language instruction to be translated into a 3D visualization command."""
    text: str = Field(..., description="Natural language command (e.g. 'Show temperature anomalies below 100m')")
    variable: str = Field('temperature', description="Current active variable in viewer")


class NLCommandResponse(BaseModel):
    """Validated structured result from natural language command translation."""
    original_text: str
    parsed_command: VisualizationCommand
    explanation: str
    executed: bool = False


class AIStatusResponse(BaseModel):
    """Health and configuration status of the AI assistant service."""
    available: bool
    model: str
    message: str
