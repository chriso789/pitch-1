"""generate_dsm — DSM (Digital Surface Model) raster from a clipped point cloud.

Method: PDAL pipeline using `writers.gdal` with `output_type=max` over a
resolution grid. DSM = highest return per cell (roof surface, tree canopy, etc.).

Contract:
  * Requires `source_url` (clipped LAZ from clip_point_cloud) + AOI + resolution.
  * Emits a GeoTIFF DSM, uploads it, returns
    `dsm_raster_url`, resolution, nodata_percent, surface_coverage_percent.
  * Status `completed` only when surface_coverage_percent over AOI ≥ 60%.
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage

MIN_SURFACE_COVERAGE_PCT = 60.0


def _aoi_bounds(aoi_geojson: dict[str, Any]) -> tuple[float, float, float, float]:
    from shapely.geometry import shape  # type: ignore
    geom = aoi_geojson
    if geom.get("type") == "FeatureCollection":
        geom = geom["features"][0]["geometry"]
    elif geom.get("type") == "Feature":
        geom = geom["geometry"]
    return shape(geom).bounds  # (minx, miny, maxx, maxy)


def _build_pipeline(src_laz: str, out_tif: str, resolution: float, bounds: tuple, output_type: str = "max") -> dict:
    minx, miny, maxx, maxy = bounds
    return {
        "pipeline": [
            {"type": "readers.las", "filename": src_laz},
            {
                "type": "writers.gdal",
                "filename": out_tif,
                "resolution": resolution,
                "output_type": output_type,
                "gdaldriver": "GTiff",
                "data_type": "float32",
                "nodata": -9999,
                "bounds": f"([{minx},{maxx}],[{miny},{maxy}])",
            },
        ]
    }


def _raster_diagnostics(tif_path: str) -> dict[str, Any]:
    import numpy as np  # type: ignore
    import rasterio  # type: ignore
    with rasterio.open(tif_path) as r:
        arr = r.read(1)
        nodata = r.nodata if r.nodata is not None else -9999
        valid = (arr != nodata) & np.isfinite(arr)
        total = arr.size
        valid_count = int(valid.sum())
        nodata_pct = round(100.0 * (1 - valid_count / total), 2) if total else 100.0
        surface_coverage = round(100.0 * valid_count / total, 2) if total else 0.0
        z_min = float(arr[valid].min()) if valid_count else None
        z_max = float(arr[valid].max()) if valid_count else None
        return {
            "width": r.width, "height": r.height,
            "resolution": list(r.res),
            "crs": str(r.crs) if r.crs else None,
            "bounds": list(r.bounds),
            "nodata_percent": nodata_pct,
            "surface_coverage_percent": surface_coverage,
            "z_min": z_min, "z_max": z_max,
        }


def _run(req: SkillRequest, output_type: str, artifact_subtype: str) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version

    if not req.source_url:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="source_url (clipped point cloud) required",
            qa_flags=["missing_source_url"], worker_version=version,
        )
    if not req.aoi_geojson:
        return SkillResponse(
            skill_run_id=req.skill_run_id, status="failed",
            error_message="aoi_geojson required",
            qa_flags=["missing_aoi"], worker_version=version,
        )
    resolution = float(req.target_resolution or 0.25)  # 25 cm default

    workdir = tempfile.mkdtemp(prefix=f"{artifact_subtype}-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import pdal  # type: ignore
        src_laz = os.path.join(workdir, "src.laz")
        download_to_temp(req.source_url, src_laz, settings.max_download_mb)
        bounds = _aoi_bounds(req.aoi_geojson)
        out_tif = os.path.join(workdir, f"{artifact_subtype}.tif")
        pipeline_def = _build_pipeline(src_laz, out_tif, resolution, bounds, output_type=output_type)
        n = pdal.Pipeline(json.dumps(pipeline_def)).execute()
        if n <= 0 or not os.path.exists(out_tif):
            return SkillResponse(
                skill_run_id=req.skill_run_id, status="failed",
                error_message=f"{artifact_subtype} pipeline produced no output",
                qa_flags=["empty_pipeline_result"], worker_version=version,
            )
        diag = _raster_diagnostics(out_tif)
        storage_path = artifact_path(
            req.measurement_request_id, req.request_hash, req.skill_run_id,
            sub=f"rasters/{artifact_subtype}", filename=f"{artifact_subtype}.tif",
        )
        upload = upload_artifact_to_storage(out_tif, storage_path)

        qa_flags: list[str] = []
        if diag["surface_coverage_percent"] < MIN_SURFACE_COVERAGE_PCT:
            qa_flags.append("low_surface_coverage")

        status = "needs_review" if "low_surface_coverage" in qa_flags else "completed"

        out_url_key = f"{artifact_subtype}_raster_url"
        return SkillResponse(
            skill_run_id=req.skill_run_id, status=status,
            output_payload={
                out_url_key: storage_path,
                "resolution_m": resolution,
                "nodata_percent": diag["nodata_percent"],
                "surface_coverage_percent": diag["surface_coverage_percent"],
                "z_min": diag["z_min"], "z_max": diag["z_max"],
                "crs": diag["crs"], "bounds": diag["bounds"],
            },
            artifacts=[Artifact(
                artifact_type=artifact_subtype,
                storage_path=storage_path,
                metadata={"resolution_m": resolution, "byte_size": upload["byte_size"], **diag},
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
            error_message=f"{artifact_subtype} error: {e}",
            qa_flags=["pipeline_error"], worker_version=version,
        )


def run_generate_dsm(req: SkillRequest) -> SkillResponse:
    return _run(req, output_type="max", artifact_subtype="dsm")
