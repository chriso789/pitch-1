"""Detect roof segments (ridges, hips, valleys, eaves, rakes) from fitted planes.

Logic (classical, no ML):
  - For each pair of planes, intersect → infinite line in 3D.
  - Project both facet polygons; keep intersection line CLIPPED to where both
    facets overlap (the shared edge).
  - Classify:
        ridge   : interior shared edge; both planes slope away from line
                  (line z > centroid z of both facets), nearly horizontal
        valley  : interior shared edge; both planes slope toward line
                  (line z < centroid z of both facets)
        hip     : exterior shared edge; sloped, line descends from ridge to eave
  - For perimeter edges of each facet that do NOT belong to a shared edge:
        eave    : low edge, plane slopes away upward, nearly horizontal
        rake    : sloped perimeter edge (gable end)

Eaves/rakes are NEVER classified from footprint geometry alone — only after
roof planes exist (per architectural contract).
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


def _plane_z(coef, x, y):
    a, b, c = coef
    return a * x + b * y + c


def _intersect_planes(p1, p2):
    """Return (point_on_line, direction) for the intersection of z=a1x+b1y+c1 and z=a2x+b2y+c2."""
    import numpy as np  # type: ignore
    a1, b1, c1 = p1["coef"]
    a2, b2, c2 = p2["coef"]
    # Subtract: (a1-a2)x + (b1-b2)y = (c2-c1)  → 2D line in XY
    da, db, dc = a1 - a2, b1 - b2, c2 - c1
    if abs(da) < 1e-6 and abs(db) < 1e-6:
        return None
    # Direction in XY perpendicular to gradient of (da, db)
    dir_xy = np.array([-db, da])
    norm = np.linalg.norm(dir_xy)
    if norm < 1e-9:
        return None
    dir_xy = dir_xy / norm
    # Anchor point: solve at x=0 or y=0
    if abs(db) > 1e-6:
        x0, y0 = 0.0, dc / db
    else:
        x0, y0 = dc / da, 0.0
    z0 = _plane_z(p1["coef"], x0, y0)
    # 3D direction: dz/ds along (dir_xy)
    dz = a1 * dir_xy[0] + b1 * dir_xy[1]
    direction = np.array([dir_xy[0], dir_xy[1], dz])
    return np.array([x0, y0, z0]), direction


def _segment_intersection_in_facets(p1, p2):
    """Intersect the infinite plane-intersection line with the overlap of both facet polygons."""
    from shapely.geometry import shape as shp_shape, LineString  # type: ignore
    pt_dir = _intersect_planes(p1, p2)
    if pt_dir is None:
        return None
    anchor, direction = pt_dir
    # Build a long line in XY
    t = 500.0
    line = LineString([
        (anchor[0] - direction[0] * t, anchor[1] - direction[1] * t),
        (anchor[0] + direction[0] * t, anchor[1] + direction[1] * t),
    ])
    poly1 = shp_shape(p1["facet_polygon"])
    poly2 = shp_shape(p2["facet_polygon"])
    overlap_region = poly1.buffer(0.2).intersection(poly2.buffer(0.2))
    if overlap_region.is_empty:
        return None
    clipped = line.intersection(overlap_region)
    if clipped.is_empty:
        return None
    if clipped.geom_type == "MultiLineString":
        clipped = max(clipped.geoms, key=lambda g: g.length)
    if clipped.length < 0.5:  # < 0.5m too short to classify
        return None
    (x1, y1), (x2, y2) = clipped.coords[0], clipped.coords[-1]
    z1 = (_plane_z(p1["coef"], x1, y1) + _plane_z(p2["coef"], x1, y1)) / 2
    z2 = (_plane_z(p1["coef"], x2, y2) + _plane_z(p2["coef"], x2, y2)) / 2
    return {
        "p1": [x1, y1, z1],
        "p2": [x2, y2, z2],
        "length_m": clipped.length,
        "dz": z2 - z1,
        "mid_z": (z1 + z2) / 2,
        "facet_a": p1["plane_id"],
        "facet_b": p2["plane_id"],
    }


def _classify_shared(seg, p1, p2):
    from shapely.geometry import shape as shp_shape, Point  # type: ignore
    midx = (seg["p1"][0] + seg["p2"][0]) / 2
    midy = (seg["p1"][1] + seg["p2"][1]) / 2
    midz = seg["mid_z"]
    c1 = shp_shape(p1["facet_polygon"]).centroid
    c2 = shp_shape(p2["facet_polygon"]).centroid
    z_c1 = _plane_z(p1["coef"], c1.x, c1.y)
    z_c2 = _plane_z(p2["coef"], c2.x, c2.y)
    line_above_both = midz > z_c1 and midz > z_c2
    line_below_both = midz < z_c1 and midz < z_c2
    slope = abs(seg["dz"]) / max(seg["length_m"], 1e-6)
    if line_above_both and slope < 0.15:
        return "ridge"
    if line_above_both and slope >= 0.15:
        return "hip"
    if line_below_both:
        return "valley"
    return "ridge"  # ambiguous → conservative


def _perimeter_segments(plane, shared_lines):
    """Eave/rake: perimeter edges of facet polygon not covered by shared lines."""
    from shapely.geometry import shape as shp_shape, LineString  # type: ignore
    poly = shp_shape(plane["facet_polygon"])
    if poly.geom_type != "Polygon":
        return []
    coords = list(poly.exterior.coords)
    segments = []
    for i in range(len(coords) - 1):
        seg = LineString([coords[i], coords[i + 1]])
        covered = any(seg.buffer(0.3).contains(LineString([s["p1"][:2], s["p2"][:2]])) for s in shared_lines)
        if covered:
            continue
        (x1, y1), (x2, y2) = coords[i], coords[i + 1]
        z1 = _plane_z(plane["coef"], x1, y1)
        z2 = _plane_z(plane["coef"], x2, y2)
        dz = z2 - z1
        length = seg.length
        slope = abs(dz) / max(length, 1e-6)
        kind = "rake" if slope > 0.1 else "eave"
        segments.append({
            "type": kind,
            "p1": [x1, y1, z1], "p2": [x2, y2, z2],
            "length_m": length,
            "facet": plane["plane_id"],
        })
    return segments


def run_detect_segments(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version
    planes_url = (req.inputs or {}).get("planes_url") or req.source_url
    if not planes_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="planes_url required", qa_flags=["missing_inputs"], worker_version=version)

    workdir = tempfile.mkdtemp(prefix=f"segments-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        src = os.path.join(workdir, "planes.json")
        download_to_temp(planes_url, src)
        with open(src) as f:
            planes = json.load(f)

        shared_segments: list[dict[str, Any]] = []
        for i in range(len(planes)):
            for j in range(i + 1, len(planes)):
                seg = _segment_intersection_in_facets(planes[i], planes[j])
                if seg:
                    seg["type"] = _classify_shared(seg, planes[i], planes[j])
                    shared_segments.append(seg)

        perimeter_segments: list[dict[str, Any]] = []
        for p in planes:
            perimeter_segments.extend(_perimeter_segments(p, shared_segments))

        all_segments = shared_segments + perimeter_segments
        lengths_m = {"ridge": 0.0, "hip": 0.0, "valley": 0.0, "eave": 0.0, "rake": 0.0}
        for s in all_segments:
            t = s["type"]
            if t in lengths_m:
                lengths_m[t] += s["length_m"]
        lengths_ft = {k: round(v * 3.28084, 2) for k, v in lengths_m.items()}

        out_path = os.path.join(workdir, "segments.json")
        with open(out_path, "w") as f:
            json.dump({"segments": all_segments, "lengths_ft": lengths_ft}, f)
        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="segments", filename="segments.json")
        upload = upload_artifact_to_storage(out_path, storage_path)

        return SkillResponse(
            skill_run_id=req.skill_run_id, status="completed",
            output_payload={
                "segments_url": storage_path,
                "lengths_ft": lengths_ft,
                "segment_counts": {k: sum(1 for s in all_segments if s["type"] == k) for k in lengths_m},
                "total_segments": len(all_segments),
            },
            artifacts=[Artifact(
                artifact_type="roof_segments",
                storage_path=storage_path,
                metadata={"lengths_ft": lengths_ft, "byte_size": upload["byte_size"]},
                measurement_request_id=req.measurement_request_id,
                request_hash=req.request_hash,
                measurement_job_id=req.measurement_job_id,
                skill_run_id=req.skill_run_id,
            )],
            qa_flags=[] if lengths_ft["ridge"] > 0 or lengths_ft["hip"] > 0 else ["no_ridge_or_hip_detected"],
            worker_version=version,
        )
    except Exception as e:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"detect_segments error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)


# Aliases so each of the five registry skills resolves to the same engine.
run_detect_ridges = run_detect_segments
run_detect_hips = run_detect_segments
run_detect_valleys = run_detect_segments
run_detect_eaves = run_detect_segments
run_detect_rakes = run_detect_segments
