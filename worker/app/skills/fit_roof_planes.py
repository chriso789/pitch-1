"""fit_roof_planes — RANSAC plane segmentation over isolated roof points.

Iteratively extracts the dominant plane, computes normal + RMSE, removes
in-liers, and repeats until residual point count drops below threshold.
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

MAX_PLANES = 16
MIN_INLIERS = 80
DISTANCE_THRESHOLD_M = 0.15  # 15cm point-to-plane


def _ransac_plane(pts):
    import numpy as np  # type: ignore
    from sklearn.linear_model import RANSACRegressor  # type: ignore
    # Fit z = a*x + b*y + c using RANSAC. For near-vertical planes this fails,
    # but roofs are always sloped <= 60° so this parameterization is safe.
    X = pts[:, :2]
    y = pts[:, 2]
    try:
        ransac = RANSACRegressor(residual_threshold=DISTANCE_THRESHOLD_M, max_trials=200, min_samples=3)
        ransac.fit(X, y)
    except Exception:
        return None, None, None, None
    inlier_mask = ransac.inlier_mask_
    if inlier_mask.sum() < MIN_INLIERS:
        return None, None, None, None
    a, b = ransac.estimator_.coef_
    c = ransac.estimator_.intercept_
    # Plane: -a*x - b*y + z - c = 0 → normal (-a, -b, 1)
    normal = np.array([-a, -b, 1.0])
    normal /= np.linalg.norm(normal)
    inliers = pts[inlier_mask]
    residuals = inliers[:, 2] - (a * inliers[:, 0] + b * inliers[:, 1] + c)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    slope_deg = math.degrees(math.acos(abs(normal[2])))
    return {
        "coef": [float(a), float(b), float(c)],
        "normal": normal.tolist(),
        "slope_deg": round(slope_deg, 2),
        "pitch_rise_per_12": round(math.tan(math.radians(slope_deg)) * 12, 2),
        "rmse_m": round(rmse, 3),
        "inlier_count": int(inlier_mask.sum()),
    }, inlier_mask, inliers, normal


def _facet_polygon(inliers):
    """Concave hull (alpha shape via Shapely's buffer trick) of inlier XY points."""
    from shapely.geometry import MultiPoint, mapping  # type: ignore
    pts = MultiPoint(inliers[:, :2].tolist())
    # Buffer-collapse is robust for sparse roof returns
    hull = pts.buffer(0.4).buffer(-0.2)
    if hull.is_empty:
        hull = pts.convex_hull
    return mapping(hull)


def run_fit_roof_planes(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version
    roof_points_url = req.source_url or (req.inputs or {}).get("roof_points_url")
    if not roof_points_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="roof_points_url required", qa_flags=["missing_inputs"], worker_version=version)

    workdir = tempfile.mkdtemp(prefix=f"planes-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import numpy as np  # type: ignore
        import laspy  # type: ignore
        src = os.path.join(workdir, "roof.laz")
        download_to_temp(roof_points_url, src)
        with laspy.open(src) as f:
            las = f.read()
        pts = np.vstack([las.x, las.y, las.z]).T.astype("float64")

        planes: list[dict[str, Any]] = []
        remaining = pts.copy()
        idx = 0
        while remaining.shape[0] >= MIN_INLIERS and len(planes) < MAX_PLANES:
            result = _ransac_plane(remaining)
            if not result or not result[0]:
                break
            meta, mask, inliers, normal = result
            poly = _facet_polygon(inliers)
            planes.append({
                "plane_id": idx,
                **meta,
                "facet_polygon": poly,
            })
            remaining = remaining[~mask]
            idx += 1

        if not planes:
            return SkillResponse(skill_run_id=req.skill_run_id, status="needs_review",
                output_payload={"reason": "no_planes_fit"},
                qa_flags=["zero_planes"], worker_version=version)

        out_path = os.path.join(workdir, "planes.json")
        with open(out_path, "w") as f:
            json.dump(planes, f)
        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="planes", filename="planes.json")
        upload = upload_artifact_to_storage(out_path, storage_path)

        avg_rmse = round(sum(p["rmse_m"] for p in planes) / len(planes), 3)
        coverage = round(sum(p["inlier_count"] for p in planes) / max(pts.shape[0], 1), 3)

        qa_flags: list[str] = []
        if avg_rmse > 0.12:
            qa_flags.append("high_plane_rmse")
        if coverage < 0.6:
            qa_flags.append("low_plane_coverage")

        return SkillResponse(
            skill_run_id=req.skill_run_id,
            status="needs_review" if qa_flags else "completed",
            output_payload={
                "planes_url": storage_path,
                "plane_count": len(planes),
                "avg_rmse_m": avg_rmse,
                "facet_coverage_ratio": coverage,
                "planes": planes,
            },
            artifacts=[Artifact(
                artifact_type="roof_planes",
                storage_path=storage_path,
                metadata={"plane_count": len(planes), "avg_rmse": avg_rmse,
                          "byte_size": upload["byte_size"]},
                measurement_request_id=req.measurement_request_id,
                request_hash=req.request_hash,
                measurement_job_id=req.measurement_job_id,
                skill_run_id=req.skill_run_id,
            )],
            qa_flags=qa_flags,
            worker_version=version,
        )
    except Exception as e:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"fit_roof_planes error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)
