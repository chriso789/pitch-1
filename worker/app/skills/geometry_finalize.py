"""calculate_pitch + calculate_roof_area + geometry_quality_score.

These are CPU-light pure-Python skills that consume the plane fit + segments
artifacts and emit the final measurement totals.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage


def _load_planes(url: str) -> list[dict[str, Any]]:
    workdir = tempfile.mkdtemp(prefix="planes-load-", dir=get_settings().temp_work_dir)
    p = os.path.join(workdir, "planes.json")
    download_to_temp(url, p)
    with open(p) as f:
        return json.load(f)


def run_calculate_pitch(req: SkillRequest) -> SkillResponse:
    version = get_settings().worker_version
    planes_url = (req.inputs or {}).get("planes_url") or req.source_url
    if not planes_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="planes_url required", qa_flags=["missing_inputs"], worker_version=version)
    try:
        planes = _load_planes(planes_url)
        if not planes:
            return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
                error_message="no planes available", qa_flags=["no_planes"], worker_version=version)
        # Weight each plane's pitch by inlier count
        total_weight = sum(p["inlier_count"] for p in planes)
        weighted_pitch = sum(p["pitch_rise_per_12"] * p["inlier_count"] for p in planes) / max(total_weight, 1)
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
                "predominant_slope_deg": round(math.degrees(math.atan(weighted_pitch / 12)), 2),
                "per_plane_pitch": per_plane,
            },
            qa_flags=[], worker_version=version,
        )
    except Exception as e:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"calculate_pitch error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)


def run_calculate_roof_area(req: SkillRequest) -> SkillResponse:
    version = get_settings().worker_version
    planes_url = (req.inputs or {}).get("planes_url") or req.source_url
    if not planes_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="planes_url required", qa_flags=["missing_inputs"], worker_version=version)
    try:
        from shapely.geometry import shape  # type: ignore
        planes = _load_planes(planes_url)
        per_facet = []
        total_flat_m2 = 0.0
        total_slope_m2 = 0.0
        for p in planes:
            poly = shape(p["facet_polygon"])
            flat_area = poly.area  # CRS is metric (assumed UTM/EPSG:3857)
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
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"calculate_roof_area error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)


def run_geometry_quality_score(req: SkillRequest) -> SkillResponse:
    """Nearmap-parity confidence score WITHOUT Nearmap.

    Inputs (all optional but heavily downweighted when missing):
      data_year, point_density_per_m2, dsm_nodata_percent,
      roof_point_density_per_m2, avg_plane_rmse_m, facet_coverage_ratio,
      perimeter_confidence, obstruction_percent, pitch_plausibility (0..1),
      area_reconciliation_ratio (0..1)
    """
    version = get_settings().worker_version
    i = req.inputs or {}

    def score(val: float | None, ideal: float, worst: float) -> float:
        if val is None:
            return 0.4  # missing = neutral-low
        if ideal == worst:
            return 1.0
        clamped = max(min(val, max(ideal, worst)), min(ideal, worst))
        return 1.0 - abs(clamped - ideal) / abs(ideal - worst)

    components = {
        "source_freshness": score(i.get("data_year"), 2024, 2010),
        "point_density": score(i.get("point_density_per_m2"), 20, 1),
        "dsm_quality": score(100 - (i.get("dsm_nodata_percent") or 0), 100, 50),
        "roof_point_density": score(i.get("roof_point_density_per_m2"), 25, 3),
        "plane_rmse": 1.0 - min((i.get("avg_plane_rmse_m") or 0.2) / 0.25, 1.0),
        "facet_coverage": float(i.get("facet_coverage_ratio") or 0.5),
        "perimeter_confidence": float(i.get("perimeter_confidence") or 0.5),
        "obstruction_penalty": 1.0 - min((i.get("obstruction_percent") or 0) / 50.0, 1.0),
        "pitch_plausibility": float(i.get("pitch_plausibility") or 0.7),
        "area_reconciliation": float(i.get("area_reconciliation_ratio") or 0.8),
    }

    weights = {
        "source_freshness": 0.05, "point_density": 0.10, "dsm_quality": 0.10,
        "roof_point_density": 0.15, "plane_rmse": 0.15, "facet_coverage": 0.10,
        "perimeter_confidence": 0.15, "obstruction_penalty": 0.05,
        "pitch_plausibility": 0.10, "area_reconciliation": 0.05,
    }
    weighted = sum(components[k] * weights[k] for k in components)
    confidence = round(max(0.0, min(1.0, weighted)), 3)

    needs_review_reasons = [k for k, v in components.items() if v < 0.4]
    passed = confidence >= 0.72 and not needs_review_reasons

    return SkillResponse(
        skill_run_id=req.skill_run_id,
        status="completed" if passed else "needs_review",
        output_payload={
            "confidence_score": confidence,
            "pass": passed,
            "components": {k: round(v, 3) for k, v in components.items()},
            "weights": weights,
            "needs_review_reason": needs_review_reasons or None,
        },
        qa_flags=[] if passed else ["below_quality_threshold"],
        worker_version=version,
    )
