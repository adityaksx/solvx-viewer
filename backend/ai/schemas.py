"""
SolvX — AI Scientific Assistant Data Models & Schemas
=====================================================
Pydantic schemas for multi-provider configuration, settings persistence,
deterministic tool calls, chart specifications, 3D visualization commands,
provenance, and standardized chat responses.
"""

from typing import Optional, List, Dict, Any, Union, Literal
from pydantic import BaseModel, Field, model_validator


class RegionContext(BaseModel):
    """Spatial context defined either as a bounding box or named region."""
    type: str = Field('bbox', description="Region representation type ('bbox', 'point', or 'named')")
    min_lat: Optional[float] = Field(None, description="Southernmost latitude [-90, 90]")
    max_lat: Optional[float] = Field(None, description="Northernmost latitude [-90, 90]")
    min_lon: Optional[float] = Field(None, description="Westernmost longitude [-180, 180]")
    max_lon: Optional[float] = Field(None, description="Easternmost longitude [-180, 180]")
    lat: Optional[float] = Field(None, description="Center or point latitude")
    lon: Optional[float] = Field(None, description="Center or point longitude")
    name: Optional[str] = Field(None, description="Preset region name e.g. 'Bay of Bengal'")


class TimelineContext(BaseModel):
    """Temporal context for data slicing or historical trends."""
    start: Optional[str] = Field(None, description="Start date/time ISO string")
    end: Optional[str] = Field(None, description="End date/time ISO string")
    time_iso: Optional[str] = Field(None, description="Exact active timestamp ISO string")


class DepthContext(BaseModel):
    """Vertical depth context in meters."""
    min: Optional[float] = Field(0.0, description="Minimum depth in meters")
    max: Optional[float] = Field(1000.0, description="Maximum depth in meters")
    selected_depth: Optional[float] = Field(None, description="Currently selected depth level")


class VisualizationState(BaseModel):
    """Current state of the 3D WebGL viewer layers and camera."""
    mode: Optional[str] = Field('3d-ocean', description="View mode ('3d-ocean', 'top', 'profile', 'under')")
    variable: Optional[str] = Field(None, description="Currently active ocean variable")
    depth: Optional[float] = Field(None, description="Active depth level in meters")
    depth_mode: Optional[str] = Field('volume', description="Slicing mode ('volume', 'horizontal', 'vertical')")
    argo_visible: bool = Field(True, description="Whether Argo float markers are visible")
    bathymetry_visible: bool = Field(True, description="Whether bathymetry seabed is visible")
    currents_visible: bool = Field(False, description="Whether current vector arrows are visible")
    particles_visible: bool = Field(False, description="Whether particle flow is enabled")


class UIContext(BaseModel):
    """Full deterministic context passed from client UI to AI backend."""
    region: Optional[Union[RegionContext, Dict[str, Any]]] = Field(None, description="Active geographic region")
    timeline: Optional[Union[TimelineContext, Dict[str, Any]]] = Field(None, description="Active temporal bounds")
    depth: Optional[Union[DepthContext, Dict[str, Any]]] = Field(None, description="Active vertical depth")
    selected_dataset: Optional[str] = Field('current-model', description="Active data provider/model")
    selected_variable: Optional[str] = Field(None, description="Active ocean variable")
    visualization_state: Optional[Union[VisualizationState, Dict[str, Any]]] = Field(None, description="Active 3D scene state")
    visualization: Optional[Dict[str, Any]] = Field(None, description="Visualization alias")


class VisualizationAction(BaseModel):
    """
    Validated 3D visualization command for client execution.
    Only recognized actions with validated parameters are allowed.
    """
    action: Literal[
        "set_region",
        "set_time",
        "set_depth",
        "set_variable",
        "set_colormap",
        "show_argo",
        "hide_argo",
        "show_bathymetry",
        "show_coastline",
        "show_currents",
        "show_temperature",
        "show_salinity",
        "show_chlorophyll",
        "show_model_error",
        "highlight_region",
        "set_opacity",
        "set_vertical_exaggeration",
        "reset_view",
        "focus_location",
        "focus_region"
    ] = Field(..., description="Standardized 3D visualization command")
    type: Optional[str] = Field(None, description="Alias for action type")
    params: Dict[str, Any] = Field(default_factory=dict, description="Action parameters")
    value: Optional[Any] = Field(None, description="Convenience property for single-value commands")

    @model_validator(mode='after')
    def sync_type(self):
        if self.type is None:
            self.type = self.action
        return self


class ChartSpecification(BaseModel):
    """Specification for frontend chart rendering (Chart.js / SVG / Canvas)."""
    chart_type: Literal[
        "time_series",
        "depth_profile",
        "model_vs_obs",
        "error_bias_profile",
        "current_magnitude_direction",
        "comparison",
        "bar",
        "line"
    ] = Field(..., description="Chart visualization type")
    title: str = Field(..., description="Descriptive chart title")
    x: str = Field(..., description="X-axis variable/dimension name")
    y: Union[str, List[str]] = Field(..., description="Y-axis variable(s)/dimension(s)")
    unit: Optional[str] = Field(None, description="Unit of measurement for values")
    labels: Optional[List[Any]] = Field(None, description="X-axis category labels or timestamps")
    series: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Data series objects with name, values, and styling"
    )


class ToolCallRecord(BaseModel):
    """Audit log of a single deterministic tool execution during an AI turn."""
    tool: str = Field(..., description="Tool function name")
    args: Dict[str, Any] = Field(default_factory=dict, description="Input parameters passed to the tool")
    status: Literal["success", "error", "skipped", "empty"] = Field("success", description="Tool execution outcome")
    summary: Optional[str] = Field(None, description="Brief summary of returned data for auditing")


class DataProvenance(BaseModel):
    """Lineage and audit record of data sources consumed in generating an answer."""
    dataset: str = Field("Copernicus Global Ocean Analysis (NEMO)", description="Primary dataset identifier")
    source: str = Field("WMO Argo / Copernicus Marine Service", description="Originating scientific provider")
    variables: List[str] = Field(default_factory=list, description="Variables queried")
    region: Optional[Dict[str, Any]] = Field(None, description="Geographic bounding box queried")
    time_range: Optional[Dict[str, Any]] = Field(None, description="Temporal bounds queried")
    depth_range: Optional[Dict[str, Any]] = Field(None, description="Vertical depth range queried")
    retrieved_at: str = Field(..., description="ISO 8601 retrieval timestamp")
    processing: List[str] = Field(
        default_factory=list,
        description="Pipeline operations performed (e.g. spatial_subset, interpolation, rmse_calc)"
    )


class ChatRequest(BaseModel):
    """Incoming user request for the AI Scientific Assistant."""
    message: str = Field(..., description="Natural language prompt from user")
    context: Optional[Union[UIContext, Dict[str, Any]]] = Field(None, description="Deterministic UI/client context")
    ui_context: Optional[Union[UIContext, Dict[str, Any]]] = Field(None, description="UI context alias")
    session_id: Optional[str] = Field(None, description="Optional conversation session ID for continuity")
    provider: Optional[str] = Field(None, description="Requested provider ('gemini' or 'nvidia')")
    model: Optional[str] = Field(None, description="Requested LLM model")

    @model_validator(mode='after')
    def sync_context(self):
        if self.context is None and self.ui_context is not None:
            self.context = self.ui_context
        return self


class ChatResponse(BaseModel):
    """Complete structured response from the AI Scientific Assistant."""
    success: bool = Field(True, description="Whether the request succeeded")
    message: str = Field(..., description="Natural language scientific explanation with markdown formatting")
    answer: Optional[str] = Field(None, description="Natural language scientific explanation alias")
    explanation: Optional[str] = Field(None, description="Natural language scientific explanation alias")
    model: Optional[str] = Field(None, description="LLM model identifier used for response")
    provider: str = Field("gemini", description="LLM provider name ('gemini', 'nvidia', or 'deterministic')")
    fallback_used: bool = Field(False, description="Whether fallback model or provider was invoked")
    response_type: Literal[
        "TEXT",
        "TABLE",
        "CHART",
        "3D_ACTION",
        "MAP_HIGHLIGHT",
        "DATA_SUMMARY",
        "ERROR"
    ] = Field("TEXT", description="Primary presentation type for UI rendering")
    tool_calls: List[ToolCallRecord] = Field(
        default_factory=list,
        description="Audit list of deterministic tools executed"
    )
    tools_used: List[Union[ToolCallRecord, Dict[str, Any], str]] = Field(
        default_factory=list,
        description="List of tools used alias"
    )
    visualization_actions: List[VisualizationAction] = Field(
        default_factory=list,
        description="Controlled 3D visualization commands for client execution"
    )
    visualization_commands: List[Union[VisualizationAction, Dict[str, Any]]] = Field(
        default_factory=list,
        description="Alias for visualization actions"
    )
    charts: List[ChartSpecification] = Field(
        default_factory=list,
        description="Chart specifications for frontend rendering"
    )
    provenance: Optional[DataProvenance] = Field(
        None,
        description="Scientifically auditable data lineage"
    )
    session_id: Optional[str] = Field(None, description="Session ID for follow-up conversation turns")
    error: Optional[Union[str, Dict[str, Any]]] = Field(None, description="Clean error summary if unavailable")
    disclaimer: str = Field(
        "Grounded strictly in computed oceanographic analysis and observation intelligence.",
        description="Scientific verification notice"
    )

    @model_validator(mode='after')
    def sync_aliases(self):
        if self.answer is None:
            self.answer = self.message
        if self.explanation is None:
            self.explanation = self.message
        if not self.tools_used and self.tool_calls:
            self.tools_used = self.tool_calls
        if not self.visualization_commands and self.visualization_actions:
            self.visualization_commands = self.visualization_actions
        return self


# =============================================================================
# Settings & Connection Schemas
# =============================================================================

class AISettingsUpdateRequest(BaseModel):
    """Payload to update AI assistant settings."""
    provider: Optional[str] = Field(None, description="Selected provider ('gemini' or 'nvidia')")
    model: Optional[str] = Field(None, description="Selected model for current provider")
    auto_fallback: Optional[bool] = Field(None, description="Cross-provider automatic failover toggle")


class TestConnectionRequest(BaseModel):
    """Payload for provider connection diagnostic test."""
    provider: str = Field("gemini", description="Provider to test ('gemini' or 'nvidia')")
    model: Optional[str] = Field(None, description="Specific model to test")
