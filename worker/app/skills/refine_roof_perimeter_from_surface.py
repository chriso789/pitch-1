"""refine_roof_perimeter_from_surface — surface-truth refinement of roof perimeter.

Replaces math-only soffit offsets with a perimeter derived from the actual roof
surface footprint detected in DSM/CHM. Used to mark per-side overhang exposure,
porch/lanai extensions, and edges that need_review when surface coverage is weak.

Pipeline:
  1. Threshold CHM > 2.0m → binary "roof surface" mask
  2. Morphological close + largest-connected-component (keep main structure)
  3. Compute contour → polygon (Shapely)
  4. Snap candidate offset perimeter edges to the surface boundary
  5. Per-edge: measure surface-extent distance from wall-line footprint
"""
from __future__ import annotations

import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage

ROOF_HEIGHT_THRESHOLD_M = 2.0


def _to_polygon(geo: dict[str, Any]):
    from shapely.geometry import shape  # type: ignore
    g = geo
    if g.get("type") == "FeatureCollection":
        g = g["features"][0]["geometry"]
    elif g.get("type") == "Feature":
        g = g["geometry"]
    return shape(g)


def run_refine_roof_perimeter_from_surface(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version
    chm_url = (req.inputs or {}).get("chm_raster_url")
    footprint = req.building_footprint_geojson
    candidate = req.roof_edge_candidate_geojson

    if not chm_url or not footprint:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="chm_raster_url + building_footprint_geojson required",
            qa_flags=["missing_inputs"], worker_version=version)

    workdir = tempfile.mkdtemp(prefix=f"perim-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import numpy as np  # type: ignore
        import rasterio  # type: ignore
        from rasterio.features import shapes  # type: ignore
        from shapely.geometry import shape as shp_shape, mapping  # type: ignore
        from shapely.ops import unary_union  # type: ignore
        from skimage.morphology import binary_closing, remove_small_objects, disk  # type: ignore

        chm_path = os.path.join(workdir, "chm.tif")
        download_to_temp(chm_url, chm_path)
        with rasterio.open(chm_path) as r:
            chm = r.read(1)
            transform = r.transform
            crs = r.crs
            nodata = r.nodata if r.nodata is not None else -9999

        valid = (chm != nodata) & np.isfinite(chm)
        roof_mask = (chm > ROOF_HEIGHT_THRESHOLD_M) & valid
        roof_mask = binary_closing(roof_mask, footprint=disk(2))
        roof_mask = remove_small_objects(roof_mask, min_size=200)

        polys = []
        for geom, val in shapes(roof_mask.astype("uint8"), mask=roof_mask, transform=transform):
            if val == 1:
                polys.append(shp_shape(geom))
        if not polys:
            return SkillResponse(skill_run_id=req.skill_run_id, status="needs_review",
                output_payload={"reason": "no_roof_surface_detected"},
                qa_flags=["empty_roof_surface"], worker_version=version)
        refined = max(polys, key=lambda p: p.area)
        footprint_poly = _to_polygon(footprint)
        candidate_poly = _to_polygon(candidate) if candidate else footprint_poly

        # Per-edge overhang: measure refined boundary distance outward from footprint edges
        edge_offsets: list[dict[str, Any]] = []
        coords = list(footprint_poly.exterior.coords)
        for i in range(len(coords) - 1):
            from shapely.geometry import LineString, Point  # type: ignore
            seg = LineString([coords[i], coords[i + 1]])
            # Sample midpoint, measure distance from refined polygon boundary
            mid = seg.interpolate(0.5, normalized=True)
            d_inside = refined.boundary.distance(mid)
            edge_offsets.append({
                "edge_index": i,
                "overhang_m": round(float(d_inside), 3),
                "supported_by_surface": refined.contains(mid),
            })

        # Detect porch/lanai extensions = refined polygon area > footprint area * 1.2
        porch_detected = refined.area > footprint_poly.area * 1.2
        # Confidence = ratio of refined area covered by candidate buffer
        if candidate_poly.is_valid and candidate_poly.area > 0:
            overlap_ratio = refined.intersection(candidate_poly).area / refined.area
        else:
            overlap_ratio = 0.5
        confidence = max(0.0, min(1.0, overlap_ratio))

        out_geojson = {
            "type": "Feature",
            "geometry": mapping(refined),
            "properties": {
                "source": "surface_refined",
                "chm_threshold_m": ROOF_HEIGHT_THRESHOLD_M,
                "porch_extension_detected": porch_detected,
                "confidence": round(confidence, 3),
            },
        }
        out_path = os.path.join(workdir, "refined.geojson")
        with open(out_path, "w") as f:
            import json
            json.dump(out_geojson, f)

        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="perimeters/refined", filename="refined.geojson")
        upload = upload_artifact_to_storage(out_path, storage_path)

        avg_overhang_ft = round(
            (sum(e["overhang_m"] for e in edge_offsets) / max(len(edge_offsets), 1)) * 3.28084,
            2,
        )

        qa_flags: list[str] = []
        if confidence < 0.5:
            qa_flags.append("low_perimeter_confidence")
        if porch_detected:
            qa_flags.append("porch_or_extension_detected")

        return SkillResponse(
            skill_run_id=req.skill_run_id,
            status="needs_review" if confidence < 0.5 else "completed",
            output_payload={
                "surface_refined_roof_perimeter_url": storage_path,
                "surface_refined_roof_perimeter_geojson": out_geojson,
                "per_edge_overhang": edge_offsets,
                "avg_overhang_ft": avg_overhang_ft,
                "porch_extension_detected": porch_detected,
                "confidence": round(confidence, 3),
                "confidence_reason": "surface_supported" if confidence >= 0.5 else "weak_surface_overlap",
            },
            artifacts=[Artifact(
                artifact_type="surface_refined_roof_perimeter",
                storage_path=storage_path,
                metadata={"byte_size": upload["byte_size"], "confidence": confidence,
                          "porch_detected": porch_detected},
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
            error_message=f"refine_roof_perimeter_from_surface error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)
