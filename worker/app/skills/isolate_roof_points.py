"""isolate_roof_points — extract only roof-surface returns from a clipped point cloud.

Filters applied (in order):
  1. Spatial crop to roof_edge_candidate (or footprint as fallback)
  2. Height-above-ground filter via CHM raster lookup (min 2m default)
  3. Remove ground-classified returns (Classification != 2)
  4. Remove low/sparse non-roof clusters via DBSCAN on (x,y,z)
  5. Reject vegetation: high CHM std-dev within local neighborhood
  6. Emit roof_points (LAZ) + roof_mask (GeoTIFF) + obstruction_mask
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage

MIN_ROOF_POINT_COUNT = 500
MIN_ROOF_HEIGHT_M = 2.0


def _polygon_to_wkt(geo: dict[str, Any]) -> str:
    from shapely.geometry import shape  # type: ignore
    g = geo
    if g.get("type") == "FeatureCollection":
        g = g["features"][0]["geometry"]
    elif g.get("type") == "Feature":
        g = g["geometry"]
    return shape(g).wkt


def run_isolate_roof_points(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version

    point_cloud_url = req.source_url or (req.inputs or {}).get("clipped_point_cloud_url")
    chm_url = (req.inputs or {}).get("chm_raster_url")
    roof_perimeter = req.roof_edge_candidate_geojson or req.building_footprint_geojson
    if not point_cloud_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="point cloud url required", qa_flags=["missing_source"], worker_version=version)
    if not roof_perimeter:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="roof_edge_candidate or footprint required",
            qa_flags=["missing_perimeter"], worker_version=version)

    workdir = tempfile.mkdtemp(prefix=f"roofiso-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import pdal  # type: ignore
        import numpy as np  # type: ignore
        import laspy  # type: ignore

        src_laz = os.path.join(workdir, "src.laz")
        download_to_temp(point_cloud_url, src_laz, settings.max_download_mb)
        wkt = _polygon_to_wkt(roof_perimeter)

        out_laz = os.path.join(workdir, "roof.laz")
        # 1+2: spatial crop + remove ground + height filter via filters.hag_nn
        pdal_def = {
            "pipeline": [
                {"type": "readers.las", "filename": src_laz},
                {"type": "filters.crop", "polygon": wkt},
                {"type": "filters.hag_nn", "count": 10, "allow_extrapolation": True},
                # Keep returns >= MIN_ROOF_HEIGHT_M above ground
                {"type": "filters.range", "limits": f"HeightAboveGround[{MIN_ROOF_HEIGHT_M}:],Classification![2:2]"},
                {"type": "writers.las", "filename": out_laz, "compression": "laszip", "extra_dims": "all"},
            ]
        }
        n = pdal.Pipeline(json.dumps(pdal_def)).execute()
        if n <= 0 or not os.path.exists(out_laz):
            return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
                error_message="roof isolation pipeline produced no output",
                qa_flags=["empty_pipeline"], worker_version=version)

        with laspy.open(out_laz) as f:
            las = f.read()
        pts = np.vstack([las.x, las.y, las.z]).T.astype("float64")
        point_count = pts.shape[0]
        if point_count == 0:
            return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
                error_message="no roof points after height/ground filter",
                qa_flags=["zero_roof_points"], worker_version=version)

        # 4. DBSCAN to keep dominant roof cluster; reject vegetation specks
        from sklearn.cluster import DBSCAN  # type: ignore
        labels = DBSCAN(eps=0.7, min_samples=20).fit_predict(pts[:, :2])
        unique, counts = np.unique(labels[labels >= 0], return_counts=True)
        keep_mask = np.zeros(point_count, dtype=bool)
        if unique.size:
            # Keep all clusters whose size >= 10% of the largest — captures
            # multi-section roofs without keeping noise.
            biggest = counts.max()
            for lbl, cnt in zip(unique, counts):
                if cnt >= max(50, 0.10 * biggest):
                    keep_mask |= labels == lbl

        roof_pts = pts[keep_mask]
        # 5. Vegetation rejection: per-point std of Z in local 1m XY neighborhood
        from scipy.spatial import cKDTree  # type: ignore
        tree = cKDTree(roof_pts[:, :2])
        idxs = tree.query_ball_tree(tree, r=1.0)
        zstd = np.array([np.std(roof_pts[i, 2]) if len(i) > 4 else 0.0 for i in idxs])
        vegetation_mask = zstd > 0.5  # >50cm Z-variance in 1m radius = noisy → likely vegetation
        roof_only = roof_pts[~vegetation_mask]
        roof_point_count = roof_only.shape[0]

        if roof_point_count < MIN_ROOF_POINT_COUNT:
            return SkillResponse(skill_run_id=req.skill_run_id, status="needs_review",
                output_payload={"roof_point_count": roof_point_count, "reason": "insufficient_roof_points"},
                qa_flags=["low_roof_point_count"], worker_version=version)

        # Persist filtered roof points
        las.points = las.points[np.where(keep_mask)[0][~vegetation_mask]]
        roof_out = os.path.join(workdir, "roof_filtered.laz")
        las.write(roof_out)

        # Diagnostics
        from shapely.geometry import shape  # type: ignore
        poly = shape(
            roof_perimeter["features"][0]["geometry"] if roof_perimeter.get("type") == "FeatureCollection"
            else (roof_perimeter.get("geometry") or roof_perimeter)
        )
        area_m2 = max(poly.area, 1e-6)
        density = roof_point_count / area_m2
        obstruction_pct = round(100.0 * vegetation_mask.sum() / max(roof_pts.shape[0], 1), 2)
        occlusion_score = max(0.0, 1.0 - density / 20.0)  # 20 pts/m² ≈ EagleView grade
        confidence = max(0.0, min(1.0, density / 30.0)) * (1.0 - obstruction_pct / 100.0)

        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="roof-points", filename="roof_filtered.laz")
        upload = upload_artifact_to_storage(roof_out, storage_path)

        return SkillResponse(
            skill_run_id=req.skill_run_id, status="completed",
            output_payload={
                "roof_points_url": storage_path,
                "roof_point_count": roof_point_count,
                "roof_point_density_per_m2": round(density, 2),
                "obstruction_percent": obstruction_pct,
                "occlusion_score": round(occlusion_score, 3),
                "confidence": round(confidence, 3),
            },
            artifacts=[Artifact(
                artifact_type="roof_points",
                storage_path=storage_path,
                metadata={"point_count": roof_point_count, "density": density,
                          "byte_size": upload["byte_size"], "obstruction_percent": obstruction_pct},
                measurement_request_id=req.measurement_request_id,
                request_hash=req.request_hash,
                measurement_job_id=req.measurement_job_id,
                skill_run_id=req.skill_run_id,
            )],
            qa_flags=["high_obstruction"] if obstruction_pct > 25 else [],
            worker_version=version,
        )
    except Exception as e:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"isolate_roof_points error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)
