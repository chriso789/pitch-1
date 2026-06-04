"""calculate_pitch skill — weighted (by inlier count) predominant pitch from plane normals.

Public skill entrypoint: run_calculate_pitch. Routed to /skills/calculate-pitch
and registered as `calculate_pitch` in skills_registry.py.

Inputs: planes_url (or req.source_url) → planes.json from fit_roof_planes.
Output: predominant_pitch (rise per 12), predominant_slope_deg, per_plane_pitch[].
"""
from __future__ import annotations

import math

from ..config import get_settings
from ..schemas import SkillRequest, SkillResponse
from ._finalize_io import load_planes


def run_calculate_pitch(req: SkillRequest) -> SkillResponse:
    version = get_settings().worker_version
    planes_url = (req.inputs or {}).get("planes_url") or req.source_url
    if not planes_url:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="planes_url required", qa_flags=["missing_inputs"],
            worker_version=version,
        )
    try:
        planes = load_planes(planes_url)
        if not planes:
            return SkillResponse(
                skill_run_id=req.skill_run_id, status="failed",
                error_message="no planes available", qa_flags=["no_planes"],
                worker_version=version,
            )
        total_weight = sum(p["inlier_count"] for p in planes)
        weighted_pitch = sum(
            p["pitch_rise_per_12"] * p["inlier_count"] for p in planes
        ) / max(total_weight, 1)
        per_plane = [
            {
                "plane_id": p["plane_id"],
                "pitch_rise_per_12": p["pitch_rise_per_12"],
                "slope_deg": p["slope_deg"],
                "inlier_count": p["inlier_count"],
            }
            for p in planes
        ]
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="completed",
            output_payload={
                "predominant_pitch": round(weighted_pitch, 2),
                "predominant_slope_deg": round(
                    math.degrees(math.atan(weighted_pitch / 12)), 2
                ),
                "per_plane_pitch": per_plane,
            },
            qa_flags=[], worker_version=version,
        )
    except Exception as e:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message=f"calculate_pitch error: {e}",
            qa_flags=["pipeline_error"], worker_version=version,
        )
