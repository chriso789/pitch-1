"""Measurement object contract twin (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

MeasurementUnit = Literal[
    "sqft", "lf", "count", "pitch_ratio", "degrees", "percent", "ratio", "unknown"
]

MeasurementGroup = Literal[
    "roof_area",
    "roof_edges",
    "roof_flashing",
    "roof_pitch",
    "roof_penetrations",
    "roof_waste",
    "wall_area",
    "wall_edges",
    "wall_corners",
    "wall_openings",
    "wall_waste",
    "trim",
    "other",
]

ROOFING_MEASUREMENT_KEYS: tuple[str, ...] = (
    "total_roof_area_sqft",
    "pitched_roof_area_sqft",
    "flat_roof_area_sqft",
    "roof_facets_count",
    "predominant_pitch",
    "pitch_area_by_pitch",
    "eaves_lf",
    "rakes_lf",
    "eaves_plus_rakes_lf",
    "valleys_lf",
    "hips_lf",
    "ridges_lf",
    "hips_plus_ridges_lf",
    "flashing_lf",
    "step_flashing_lf",
    "parapet_lf",
    "penetrations_count",
    "penetrations_area_sqft",
    "penetrations_perimeter_lf",
    "waste_table",
)

WALLS_SIDING_MEASUREMENT_KEYS: tuple[str, ...] = (
    "wall_area_sqft",
    "wall_area_with_windows_doors_sqft",
    "wall_facets_count",
    "wall_area_by_direction",
    "top_of_walls_lf",
    "bottom_of_walls_lf",
    "inside_corners_lf",
    "outside_corners_lf",
    "inside_corners_gt_90_lf",
    "outside_corners_gt_90_lf",
    "fascia_eaves_rake_lf",
    "window_door_area_sqft",
    "window_door_count",
    "window_door_perimeter_lf",
    "wall_waste_table",
)


@dataclass
class BlueprintMeasurementObject:
    import_session_id: str
    measurement_key: str
    measurement_group: MeasurementGroup
    unit: MeasurementUnit
    confidence: float = 0.0
    quantity: Optional[float] = None
    source_document_id: Optional[str] = None
    trade_id: Optional[str] = None
    precision: Optional[float] = None
    source_value_raw: Optional[str] = None
    normalized_value: Optional[dict[str, Any]] = None
    plan_path_id: Optional[str] = None
    page_number: Optional[int] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None
