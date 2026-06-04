"""geometry_quality_score skill — Nearmap-parity confidence score WITHOUT Nearmap.

Public skill entrypoint: run_geometry_quality_score. Routed to
/skills/geometry-quality-score and registered as `geometry_quality_score`.

10 components, each clamped to [0,1], combined with the weights below.
Missing inputs receive a neutral-low score (0.4). Output:
  - confidence_score (0..1)
  - pass (bool) — threshold 0.72 AND no component below 0.4
  - components, weights, needs_review_reason
"""
from __future__ import annotations

from ..config import get_settings
from ..schemas import SkillRequest, SkillResponse


def _score(val, ideal, worst) -> float:
    if val is None:
        return 0.4
    if ideal == worst:
        return 1.0
    clamped = max(min(val, max(ideal, worst)), min(ideal, worst))
    return 1.0 - abs(clamped - ideal) / abs(ideal - worst)


def run_geometry_quality_score(req: SkillRequest) -> SkillResponse:
    version = get_settings().worker_version
    i = req.inputs or {}

    components = {
        "source_freshness":     _score(i.get("data_year"), 2024, 2010),
        "point_density":        _score(i.get("point_density_per_m2"), 20, 1),
        "dsm_quality":          _score(100 - (i.get("dsm_nodata_percent") or 0), 100, 50),
        "roof_point_density":   _score(i.get("roof_point_density_per_m2"), 25, 3),
        "plane_rmse":           1.0 - min((i.get("avg_plane_rmse_m") or 0.2) / 0.25, 1.0),
        "facet_coverage":       float(i.get("facet_coverage_ratio") or 0.5),
        "perimeter_confidence": float(i.get("perimeter_confidence") or 0.5),
        "obstruction_penalty":  1.0 - min((i.get("obstruction_percent") or 0) / 50.0, 1.0),
        "pitch_plausibility":   float(i.get("pitch_plausibility") or 0.7),
        "area_reconciliation":  float(i.get("area_reconciliation_ratio") or 0.8),
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
