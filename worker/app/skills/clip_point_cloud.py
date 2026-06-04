"""clip_point_cloud — first real compute skill for the PITCH Measure worker.

Takes a LiDAR source (LAS / LAZ / COPC / EPT) plus an AOI polygon and:
  1. Downloads / streams the source into a temp dir (size-gated).
  2. Runs a PDAL pipeline to crop to the AOI polygon, optionally reprojecting.
  3. Validates point count / bounds against guardrails.
  4. Uploads the clipped LAZ to Supabase Storage under the canonical path.
  5. Returns SkillResponse with the clipped artifact + diagnostics.

Hard rules enforced:
  • request_hash MUST be present in the SkillRequest.
  • source_url + asset_type + aoi_geojson MUST be present.
  • Status "completed" requires:
      - clipped LAZ exists on disk,
      - point_count > MIN_CLIPPED_POINT_COUNT,
      - clipped bounds intersect AOI bounds,
      - file uploaded to storage_path.
  • Any failure → status "failed" or "needs_review" with qa_flags.
  • No stub / partial result may be returned as completed.
"""
from __future__ import annotations

import json
import os
import tempfile
import urllib.parse
import urllib.request
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse

# Lazy imports — only loaded when the skill is actually invoked, so the
# worker still boots even if a heavy dep is missing in a non-prod image.
def _lazy_imports():
    import pdal  # type: ignore
    import laspy  # type: ignore
    from shapely.geometry import shape, box  # type: ignore
    return pdal, laspy, shape, box


def _download(source_url: str, dest_path: str, max_download_mb: int) -> int:
    """Stream-download with a hard byte cap. Returns bytes written."""
    parsed = urllib.parse.urlparse(source_url)
    if parsed.scheme not in ("http", "https", "file"):
        raise ValueError(f"unsupported source_url scheme: {parsed.scheme}")
    cap = max_download_mb * 1024 * 1024
    written = 0
    req = urllib.request.Request(source_url, headers={"User-Agent": "pitch-measure-worker/0.2"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest_path, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > cap:
                raise ValueError(f"source exceeds max_download_mb={max_download_mb}")
            out.write(chunk)
    return written


def _aoi_to_wkt(aoi_geojson: dict[str, Any]) -> tuple[str, tuple[float, float, float, float]]:
    """Return (WKT polygon, (minx, miny, maxx, maxy)) for the AOI."""
    pdal, laspy, shape, box = _lazy_imports()
    geom = aoi_geojson
    if geom.get("type") == "FeatureCollection":
        feats = geom.get("features") or []
        if not feats:
            raise ValueError("aoi_geojson FeatureCollection has no features")
        geom = feats[0].get("geometry") or {}
    elif geom.get("type") == "Feature":
        geom = geom.get("geometry") or {}
    poly = shape(geom)
    if poly.is_empty:
        raise ValueError("aoi_geojson polygon is empty")
    return poly.wkt, poly.bounds


def _build_pipeline(
    src: str,
    asset_type: str,
    aoi_wkt: str,
    out_laz: str,
    target_crs: str | None,
) -> dict[str, Any]:
    reader: dict[str, Any]
    at = (asset_type or "").lower()
    if at in ("las", "laz"):
        reader = {"type": "readers.las", "filename": src}
    elif at == "copc":
        reader = {"type": "readers.copc", "filename": src, "polygon": aoi_wkt}
    elif at == "ept":
        reader = {"type": "readers.ept", "filename": src, "polygon": aoi_wkt}
    else:
        raise ValueError(f"unsupported asset_type for clip_point_cloud: {asset_type}")

    stages: list[dict[str, Any]] = [reader]
    # readers.copc / readers.ept already crop server-side; for LAS/LAZ we add a crop filter.
    if at in ("las", "laz"):
        stages.append({"type": "filters.crop", "polygon": aoi_wkt})
    if target_crs:
        stages.append({"type": "filters.reprojection", "out_srs": target_crs})
    stages.append({
        "type": "writers.las",
        "filename": out_laz,
        "compression": "laszip",
        "forward": "all",
    })
    return {"pipeline": stages}


def _upload_to_storage(local_path: str, storage_path: str) -> dict[str, Any]:
    """Upload clipped LAZ to Supabase Storage. Returns metadata or raises."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured — cannot upload artifact")
    from supabase import create_client  # type: ignore
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    with open(local_path, "rb") as f:
        data = f.read()
    # upsert via service role; bucket must exist.
    client.storage.from_(settings.supabase_storage_bucket).upload(
        path=storage_path,
        file=data,
        file_options={"contentType": "application/octet-stream", "upsert": "true"},
    )
    return {
        "bucket": settings.supabase_storage_bucket,
        "storage_path": storage_path,
        "byte_size": len(data),
    }


def run_clip_point_cloud(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version

    # ---- gate 1: required inputs --------------------------------------------------
    if not req.request_hash or len(req.request_hash) < 16:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="request_hash missing or too short",
            qa_flags=["missing_request_hash"], worker_version=version,
        )
    if not req.source_url:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="source_url required for clip_point_cloud",
            qa_flags=["missing_source_url"], worker_version=version,
        )
    if not req.asset_type or req.asset_type.lower() not in ("las", "laz", "copc", "ept"):
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message=f"unsupported asset_type: {req.asset_type}",
            qa_flags=["unsupported_asset_type"], worker_version=version,
        )
    if not req.aoi_geojson:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="aoi_geojson required",
            qa_flags=["missing_aoi"], worker_version=version,
        )

    # ---- gate 2: parse AOI --------------------------------------------------------
    try:
        aoi_wkt, aoi_bounds = _aoi_to_wkt(req.aoi_geojson)
    except Exception as e:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message=f"invalid aoi_geojson: {e}",
            qa_flags=["invalid_aoi_geojson"], worker_version=version,
        )

    # ---- compute ----------------------------------------------------------------
    workdir = tempfile.mkdtemp(prefix=f"clip-{req.skill_run_id}-", dir=settings.temp_work_dir)
    src_local: str | None = None
    out_laz = os.path.join(workdir, "clipped.laz")
    qa_flags: list[str] = []
    try:
        pdal, laspy, _shape, _box = _lazy_imports()

        # For LAS/LAZ we must download; readers.copc/ept can stream from URL directly.
        if req.asset_type.lower() in ("las", "laz"):
            src_local = os.path.join(workdir, f"source.{req.asset_type.lower()}")
            _download(req.source_url, src_local, settings.max_download_mb)
            src_for_pdal = src_local
        else:
            src_for_pdal = req.source_url

        pipeline_def = _build_pipeline(
            src=src_for_pdal,
            asset_type=req.asset_type,
            aoi_wkt=aoi_wkt,
            out_laz=out_laz,
            target_crs=req.target_crs,
        )
        pipeline = pdal.Pipeline(json.dumps(pipeline_def))
        n_points = pipeline.execute()

        if n_points <= 0 or not os.path.exists(out_laz):
            return SkillResponse(
                skill_run_id=req.skill_run_id, status="failed",
                error_message="PDAL pipeline produced no output",
                qa_flags=["empty_pipeline_result"], worker_version=version,
            )

        # Inspect output
        with laspy.open(out_laz) as las:
            header = las.header
            point_count = int(header.point_count)
            mins = [float(x) for x in header.mins]
            maxs = [float(x) for x in header.maxs]
            crs_out = str(header.parse_crs()) if hasattr(header, "parse_crs") else (req.target_crs or "unknown")

        if point_count < settings.min_clipped_point_count:
            qa_flags.append("low_point_count")
        bounds = {"minx": mins[0], "miny": mins[1], "maxx": maxs[0], "maxy": maxs[1]}
        # AOI bounds intersection test (works only when CRS matches; treat as advisory otherwise).
        ax, ay, bx, by = aoi_bounds
        intersects = not (bounds["maxx"] < ax or bounds["minx"] > bx or bounds["maxy"] < ay or bounds["miny"] > by)
        if not intersects:
            return SkillResponse(
                skill_run_id=req.skill_run_id, status="failed",
                error_message="clipped output does not intersect AOI bounds",
                qa_flags=qa_flags + ["bounds_outside_aoi"], worker_version=version,
            )

        # Volume / density diagnostics
        area_xy = max((bounds["maxx"] - bounds["minx"]) * (bounds["maxy"] - bounds["miny"]), 1e-6)
        density = point_count / area_xy

        # ---- upload artifact -----------------------------------------------------
        storage_path = (
            f"measurement-requests/{req.measurement_request_id}/"
            f"{req.request_hash}/point-clouds/{req.skill_run_id}/clipped.laz"
        )
        try:
            upload_meta = _upload_to_storage(out_laz, storage_path)
        except Exception as e:
            return SkillResponse(
                skill_run_id=req.skill_run_id, status="failed",
                error_message=f"storage upload failed: {e}",
                qa_flags=qa_flags + ["storage_upload_failed"], worker_version=version,
            )

        if point_count < settings.min_clipped_point_count:
            # Real artifact exists but is too sparse for downstream — return needs_review,
            # control plane refuses to unblock downstream.
            return SkillResponse(
                skill_run_id=req.skill_run_id,
                status="needs_review",
                output_payload={
                    "point_count": point_count,
                    "point_density_per_xy_unit": density,
                    "bounds": bounds,
                    "crs": crs_out,
                    "file_format": "laz",
                    "clipped_point_cloud_url": storage_path,
                    "byte_size": upload_meta["byte_size"],
                },
                artifacts=[Artifact(
                    artifact_type="clipped_point_cloud",
                    storage_path=storage_path,
                    metadata={
                        "point_count": point_count,
                        "bounds": bounds,
                        "crs": crs_out,
                        "byte_size": upload_meta["byte_size"],
                        "format": "laz",
                    },
                    measurement_request_id=req.measurement_request_id,
                    request_hash=req.request_hash,
                    measurement_job_id=req.measurement_job_id,
                    skill_run_id=req.skill_run_id,
                )],
                qa_flags=qa_flags,
                worker_version=version,
            )

        return SkillResponse(
            skill_run_id=req.skill_run_id,
            status="completed",
            output_payload={
                "point_count": point_count,
                "point_density_per_xy_unit": density,
                "bounds": bounds,
                "crs": crs_out,
                "file_format": "laz",
                "clipped_point_cloud_url": storage_path,
                "byte_size": upload_meta["byte_size"],
            },
            artifacts=[Artifact(
                artifact_type="clipped_point_cloud",
                storage_path=storage_path,
                metadata={
                    "point_count": point_count,
                    "bounds": bounds,
                    "crs": crs_out,
                    "byte_size": upload_meta["byte_size"],
                    "format": "laz",
                },
                measurement_request_id=req.measurement_request_id,
                request_hash=req.request_hash,
                measurement_job_id=req.measurement_job_id,
                skill_run_id=req.skill_run_id,
            )],
            qa_flags=qa_flags,
            worker_version=version,
        )
    except Exception as e:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message=f"clip_point_cloud error: {e}",
            qa_flags=qa_flags + ["pipeline_error"], worker_version=version,
        )
    finally:
        # best-effort cleanup of source download; keep clipped on disk only if upload failed
        try:
            if src_local and os.path.exists(src_local):
                os.remove(src_local)
        except Exception:
            pass
