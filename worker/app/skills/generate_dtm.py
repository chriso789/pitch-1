"""generate_dtm — Digital Terrain Model (bare-earth) from a clipped point cloud.

Method: classify ground returns with `filters.smrf`, then rasterize using
`writers.gdal output_type=min` over ground-class points only.
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage
from .generate_dsm import _aoi_bounds, _raster_diagnostics

MIN_GROUND_COVERAGE_PCT = 50.0


def _pipeline(src_laz: str, out_tif: str, resolution: float, bounds: tuple) -> dict:
    minx, miny, maxx, maxy = bounds
    return {
        "pipeline": [
            {"type": "readers.las", "filename": src_laz},
            # Classify ground using Simple Morphological Filter
            {"type": "filters.smrf", "slope": 0.2, "window": 18, "threshold": 0.5, "cell": 1.0},
            {"type": "filters.range", "limits": "Classification[2:2]"},
            {
                "type": "writers.gdal",
                "filename": out_tif,
                "resolution": resolution,
                "output_type": "min",
                "gdaldriver": "GTiff",
                "data_type": "float32",
                "nodata": -9999,
                "bounds": f"([{minx},{maxx}],[{miny},{maxy}])",
            },
        ]
    }


def run_generate_dtm(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version
    if not req.source_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="source_url required", qa_flags=["missing_source_url"], worker_version=version)
    if not req.aoi_geojson:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="aoi_geojson required", qa_flags=["missing_aoi"], worker_version=version)
    resolution = float(req.target_resolution or 0.5)  # DTM coarser OK

    workdir = tempfile.mkdtemp(prefix=f"dtm-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import pdal  # type: ignore
        src_laz = os.path.join(workdir, "src.laz")
        download_to_temp(req.source_url, src_laz, settings.max_download_mb)
        bounds = _aoi_bounds(req.aoi_geojson)
        out_tif = os.path.join(workdir, "dtm.tif")
        n = pdal.Pipeline(json.dumps(_pipeline(src_laz, out_tif, resolution, bounds))).execute()
        if n <= 0 or not os.path.exists(out_tif):
            return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
                error_message="DTM pipeline produced no output",
                qa_flags=["empty_pipeline_result"], worker_version=version)
        diag = _raster_diagnostics(out_tif)
        ground_coverage = diag["surface_coverage_percent"]
        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="rasters/dtm", filename="dtm.tif")
        upload = upload_artifact_to_storage(out_tif, storage_path)

        qa_flags: list[str] = []
        if ground_coverage < MIN_GROUND_COVERAGE_PCT:
            qa_flags.append("low_ground_coverage")
        status = "needs_review" if qa_flags else "completed"

        return SkillResponse(
            skill_run_id=req.skill_run_id, status=status,
            output_payload={
                "dtm_raster_url": storage_path,
                "resolution_m": resolution,
                "ground_coverage_percent": ground_coverage,
                "z_min": diag["z_min"], "z_max": diag["z_max"],
                "crs": diag["crs"], "bounds": diag["bounds"],
                "quality_flags": qa_flags,
            },
            artifacts=[Artifact(
                artifact_type="dtm",
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
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"generate_dtm error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)
