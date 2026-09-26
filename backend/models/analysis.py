"""
SolvX — Oceanographic Analysis Models
=====================================
Pydantic schemas for Model vs Argo comparison, statistical metrics
(RMSE, Bias, MAE), observation coverage, and spatial/depth data gaps.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class ComparisonPoint(BaseModel):
    """Single vertical sounding level comparing in-situ observation with collocated numerical model."""
    depth: float = Field(..., description="Depth in meters / decibars")
    observed: float = Field(..., description="In-situ observed value (Argo)")
    model: float = Field(..., description="Interpolated numerical model value")
    diff: float = Field(..., description="Signed residual (Model - Observation)")
    abs_diff: float = Field(..., description="Absolute difference |observed - model|")
    qc: int = Field(1, description="Quality control flag (1=good)")
    unit: str = Field("°C", description="Measurement unit (°C or PSU)")


class ProfileComparisonResponse(BaseModel):
    """Complete collocated vertical profile analysis for an Argo profiling float."""
    float_id: str
    wmo: int
    variable: str
    unit: str = Field("°C", description="Measurement unit (°C or PSU)")
    latitude: float
    longitude: float
    timestamp: str
    model_source: str = "Copernicus Global Ocean Analysis (NEMO 1/12°)"
    is_climatology_fallback: bool = Field(False, description="True if reference climatology was used because model data was unavailable")
    points_count: int
    rmse: Optional[float] = Field(None, description="Root Mean Squared Error")
    bias: Optional[float] = Field(None, description="Mean Model Bias (Model - Observation)")
    mae: Optional[float] = Field(None, description="Mean Absolute Error")
    max_diff: Optional[float] = Field(None, description="Maximum absolute difference")
    min_diff: Optional[float] = Field(None, description="Minimum absolute difference")
    comparison: List[ComparisonPoint]
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Metadata including units and data quality")


class RegionalDiscrepancyRank(BaseModel):
    """Float ranking entry based on discrepancy magnitude."""
    float_id: str
    wmo: int
    latitude: float
    longitude: float
    rmse: float
    bias: float
    max_diff: float
    unit: str = Field("°C", description="Measurement unit")


class RegionalModelVsArgoResponse(BaseModel):
    """Basin-wide or region-wide aggregate Model vs Argo evaluation."""
    variable: str
    unit: str = Field("°C", description="Measurement unit")
    floats_compared: int
    total_sounding_points: int
    overall_rmse: Optional[float]
    overall_bias: Optional[float]
    overall_mae: Optional[float]
    float_comparisons: List[ProfileComparisonResponse]
    discrepancy_ranking: List[RegionalDiscrepancyRank]
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Basin evaluation metadata")


class GridCellDensity(BaseModel):
    """Spatial grid cell evaluation for observation density."""
    cell_id: str
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    center_lat: float
    center_lon: float
    count: int
    density_class: str = Field(..., description="Classification: HIGH, MEDIUM, LOW, or NONE")
    float_ids: List[str] = Field(default_factory=list)


class DepthStrataCoverage(BaseModel):
    """Sounding coverage across ocean vertical strata."""
    layer_name: str
    depth_range_m: List[float]
    sounding_count: int
    float_count: int
    status: str = Field(..., description="SUFFICIENT, MODERATE, or SPARSE")


class CoverageAnalysisResponse(BaseModel):
    """Regional observation coverage analysis."""
    bbox: Dict[str, float]
    total_observations: int
    active_floats_count: int
    spatial_coverage_pct: float = Field(..., description="Percentage of grid cells with >= 1 observation")
    density_summary: Dict[str, int] = Field(..., description="Counts of HIGH, MEDIUM, LOW, NONE cells")
    depth_strata_coverage: List[DepthStrataCoverage]
    temporal_distribution: Dict[str, Any]
    grid_cells: List[GridCellDensity]


class GapRegion(BaseModel):
    """Identified contiguous zone lacking observation coverage."""
    id: str
    name: str
    bbox: Dict[str, float]
    density: str
    severity: str = Field(..., description="CRITICAL, MODERATE, or LOW")
    recommendation: str


class DataGapsResponse(BaseModel):
    """Comprehensive observation data gap detection report."""
    bbox: Dict[str, float]
    grid_resolution_deg: float
    thresholds: Dict[str, int]
    total_cells: int
    monitored_cells: int
    empty_cells_count: int
    gap_percentage: float
    gap_regions: List[GapRegion]
    vertical_depth_gaps: List[Dict[str, Any]]


class AnalysisSummaryResponse(BaseModel):
    """Executive unified analysis report combining Model accuracy, Coverage, and Data Gaps."""
    timestamp: str
    bbox: Dict[str, float]
    variable: str
    model_accuracy: Dict[str, Any]
    observation_coverage: Dict[str, Any]
    data_gaps: Dict[str, Any]
    status: str = "READY"


# ==============================================================================
# Stage 5: Anomaly Detection & Abnormal Region Extraction
# ==============================================================================

class AnomalyRecord(BaseModel):
    """A single flagged anomalous depth-level observation from an Argo float profile."""
    variable: str = Field(..., description="Oceanographic variable (temperature / salinity)")
    unit: str = Field("°C", description="Measurement unit (°C or PSU)")
    float_id: str
    wmo: int
    latitude: float
    longitude: float
    depth: float = Field(..., description="Depth in meters / decibars")
    time: str
    value: float = Field(..., description="Observed in-situ value")
    baseline: float = Field(..., description="Reference value used for comparison (model / local mean / climatology)")
    difference: float = Field(..., description="value - baseline")
    abs_difference: float = Field(..., description="|value - baseline|")
    z_score: Optional[float] = Field(None, description="Normalised z-score if computed")
    detection_method: str = Field(..., description="zscore | threshold | model_observation | local_deviation")
    severity: str = Field(..., description="HIGH | MODERATE | LOW")


class AnomalyDetectionResponse(BaseModel):
    """Full anomaly detection run result across all Argo float profiles."""
    variable: str
    unit: str = Field("°C", description="Measurement unit")
    method: str
    threshold_sigma: float
    threshold_abs: float
    floats_scanned: int
    total_depth_levels: int
    anomaly_count: int
    anomalies: List[AnomalyRecord]
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Anomaly scan metadata")


class FocusCommand(BaseModel):
    """A dashboard-to-3D viewer navigation command targeting an anomalous region."""
    action: str = "FOCUS_REGION"
    lat: float
    lon: float
    depth: float
    variable: str
    layer: str = "anomaly"


class AbnormalRegion(BaseModel):
    """Spatially clustered bounding volume of anomalous observations."""
    id: str
    name: str
    bbox: Dict[str, float]
    depth_range_m: List[float] = Field(..., description="[min_depth, max_depth]")
    anomaly_count: int
    anomaly_magnitude_mean: float
    anomaly_magnitude_max: float
    variable: str
    unit: str = Field("°C", description="Measurement unit")
    severity: str = Field(..., description="CRITICAL | MODERATE | LOW")
    focus_command: FocusCommand


class AbnormalRegionResponse(BaseModel):
    """Complete spatial extraction of anomalous clusters with 3D navigation commands."""
    variable: str
    unit: str = Field("°C", description="Measurement unit")
    method: str
    region_count: int
    regions: List[AbnormalRegion]
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Clustering metadata")


# ==============================================================================
# Metric Definitions Catalog (Plan.md Section 19)
# ==============================================================================

METRIC_DEFINITIONS: Dict[str, Dict[str, str]] = {
    "rmse": {
        "name": "Root Mean Squared Error",
        "description": "Typical size of the model's error against in-situ observations. Lower values mean closer agreement.",
        "temperature_unit": "°C",
        "salinity_unit": "PSU"
    },
    "bias": {
        "name": "Mean Model Bias",
        "description": "Average signed residual (model - observation). Positive means the model exceeds observations; negative means the model is below observations.",
        "temperature_unit": "°C",
        "salinity_unit": "PSU",
        "chlorophyll_unit": "mg/m³"
    },
    "mae": {
        "name": "Mean Absolute Error",
        "description": "Average magnitude of error across all sounding depths regardless of sign.",
        "temperature_unit": "°C",
        "salinity_unit": "PSU"
    },
    "z_score": {
        "name": "Statistical Anomaly (Z-score)",
        "description": "Number of standard deviations a measurement deviates from the local or regional baseline.",
        "unit": "σ"
    },
    "spatial_coverage": {
        "name": "Spatial Observation Coverage",
        "description": "Percentage of 1°x1° ocean cells containing active observational profiles.",
        "unit": "%"
    }
}
