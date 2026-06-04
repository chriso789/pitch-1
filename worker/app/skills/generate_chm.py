"""generate_chm — Canopy/structure Height Model = DSM - DTM (height above ground)."""
from __future__ import annotations

import os
import tempfile
from typing import Any

from ..config import get_settings
from ..schemas import Artifact, SkillRequest, SkillResponse
from ._io import artifact_path, download_to_temp, upload_artifact_to_storage


def run_generate_chm(req: SkillRequest) -> SkillResponse:
    settings = get_settings()
    version = settings.worker_version
    dsm_url = req.inputs.get("dsm_raster_url") if req.inputs else None
    dtm_url = req.inputs.get("dtm_raster_url") if req.inputs else None
    if not dsm_url or not dtm_url:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message="inputs.dsm_raster_url and inputs.dtm_raster_url required",
            qa_flags=["missing_inputs"], worker_version=version)

    workdir = tempfile.mkdtemp(prefix=f"chm-{req.skill_run_id}-", dir=settings.temp_work_dir)
    try:
        import numpy as np  # type: ignore
        import rasterio  # type: ignore
        from rasterio.warp import reproject, Resampling  # type: ignore

        dsm_path = os.path.join(workdir, "dsm.tif")
        dtm_path = os.path.join(workdir, "dtm.tif")
        download_to_temp(dsm_url, dsm_path)
        download_to_temp(dtm_url, dtm_path)

        with rasterio.open(dsm_path) as dsm_r, rasterio.open(dtm_path) as dtm_r:
            dsm = dsm_r.read(1).astype("float32")
            dsm_nodata = dsm_r.nodata if dsm_r.nodata is not None else -9999
            # Resample DTM onto DSM grid
            dtm_resampled = np.empty(dsm.shape, dtype="float32")
            reproject(
                source=rasterio.band(dtm_r, 1),
                destination=dtm_resampled,
                src_transform=dtm_r.transform, src_crs=dtm_r.crs,
                dst_transform=dsm_r.transform, dst_crs=dsm_r.crs,
                resampling=Resampling.bilinear,
            )
            dtm_nodata = dtm_r.nodata if dtm_r.nodata is not None else -9999
            valid = (dsm != dsm_nodata) & np.isfinite(dsm) & (dtm_resampled != dtm_nodata) & np.isfinite(dtm_resampled)
            chm = np.full(dsm.shape, -9999, dtype="float32")
            chm[valid] = dsm[valid] - dtm_resampled[valid]
            invalid_pct = round(100.0 * (1 - valid.sum() / valid.size), 2)
            chm_valid = chm[valid]
            stats = {
                "mean_m": float(chm_valid.mean()) if chm_valid.size else None,
                "p50_m": float(np.median(chm_valid)) if chm_valid.size else None,
                "p95_m": float(np.percentile(chm_valid, 95)) if chm_valid.size else None,
                "max_m": float(chm_valid.max()) if chm_valid.size else None,
                "above_2m_percent": round(100.0 * (chm_valid > 2.0).sum() / chm_valid.size, 2) if chm_valid.size else 0.0,
            }
            out_path = os.path.join(workdir, "chm.tif")
            profile = dsm_r.profile.copy()
            profile.update(dtype="float32", count=1, nodata=-9999, compress="deflate")
            with rasterio.open(out_path, "w", **profile) as out:
                out.write(chm, 1)

        storage_path = artifact_path(req.measurement_request_id, req.request_hash,
            req.skill_run_id, sub="rasters/chm", filename="chm.tif")
        upload = upload_artifact_to_storage(out_path, storage_path)

        return SkillResponse(
            skill_run_id=req.skill_run_id, status="completed",
            output_payload={
                "chm_raster_url": storage_path,
                "height_above_ground_stats": stats,
                "invalid_pixel_percent": invalid_pct,
            },
            artifacts=[Artifact(
                artifact_type="chm",
                storage_path=storage_path,
                metadata={"byte_size": upload["byte_size"], "stats": stats, "invalid_pixel_percent": invalid_pct},
                measurement_request_id=req.measurement_request_id,
                request_hash=req.request_hash,
                measurement_job_id=req.measurement_job_id,
                skill_run_id=req.skill_run_id,
            )],
            qa_flags=[],
            worker_version=version,
        )
    except Exception as e:
        return SkillResponse(skill_run_id=req.skill_run_id, status="failed",
            error_message=f"generate_chm error: {e}",
            qa_flags=["pipeline_error"], worker_version=version)
