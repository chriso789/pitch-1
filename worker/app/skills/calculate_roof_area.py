"""calculate_roof_area skill — slope-adjusted facet area = flat / cos(slope).

Public skill entrypoint: run_calculate_roof_area. Routed to
/skills/calculate-roof-area and registered as `calculate_roof_area`.

Assumes facet polygons are in a metric CRS (UTM / EPSG:3857). Emits totals
in m², ft², and roofing squares plus per-facet breakdown.
"""
from __future__ import annotations

import math

from ..config import get_settings
from ..schemas import SkillRequest, SkillResponse
from ._finalize_io import load_planes


def run_calculate_roof_area(req: SkillRequest) -> SkillResponse:
    version = get_settings().worker_version
    planes_url = (req.inputs or {}).get("planes_url") or req.source_url
    if not planes_url:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="planes_url required", qa_flags=["missing_inputs"],
            worker_version=version,
        )
    try:
        from shapely.geometry import shape  # type: ignore
        planes = load_planes(planes_url)
        per_facet = []
        total_flat_m2 = 0.0
        total_slope_m2 = 0.0
        for p in planes:
            poly = shape(p["facet_polygon"])
            flat_area = poly.area
            slope_rad = math.radians(p["slope_deg"])
            slope_factor = 1.0 / max(math.cos(slope_rad), 1e-3)
            slope_area = flat_area * slope_factor
            total_flat_m2 += flat_area
            total_slope_m2 += slope_area
            per_facet.append({
                "plane_id": p["plane_id"],
                "flat_area_m2": round(flat_area, 2),
                "slope_adjusted_area_m2": round(slope_area, 2),
                "slope_deg": p["slope_deg"],
                "slope_factor": round(slope_factor, 4),
            })
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="completed",
            output_payload={
                "total_roof_area_m2": round(total_slope_m2, 2),
                "total_roof_area_sqft": round(total_slope_m2 * 10.7639, 2),
                "total_flat_footprint_m2": round(total_flat_m2, 2),
                "roofing_squares": round(total_slope_m2 * 10.7639 / 100, 2),
                "per_facet": per_facet,
            },
            qa_flags=[], worker_version=version,
        )
    except Exception as e:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message=f"calculate_roof_area error: {e}",
            qa_flags=["pipeline_error"], worker_version=version,
        )
