"""Test-mode-only endpoints for the PITCH Measure worker.

Mounted on the main FastAPI app, but every route checks worker_mode and
returns 403 in production. These endpoints exist to let the control plane
prove the clip_point_cloud skill works end-to-end WITHOUT requiring a real
LiDAR asset or Supabase storage credentials.

Endpoints:
  POST /test/clip-point-cloud-fixture
    Generates a synthetic LAS, runs clip_point_cloud against it with an AOI
    chosen by `mode`, and returns the SkillResponse for assertion.
    Body:
      {
        "mode": "real" | "sparse",   # default "real"
        "skill_run_id": str | null,  # optional, auto-generated otherwise
      }
"""
from __future__ import annotations

import os
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .auth import require_worker_key
from .config import get_settings
from .schemas import SkillRequest, SkillResponse
from .skills.clip_point_cloud import run_clip_point_cloud

router = APIRouter(prefix="/test", tags=["test"])


class FixtureClipRequest(BaseModel):
    mode: str = "real"  # "real" or "sparse"
    skill_run_id: str | None = None
    measurement_request_id: str | None = None
    measurement_job_id: str | None = None


def _guard_non_prod():
    s = get_settings()
    if not s.is_non_prod:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "test endpoints disabled in production (WORKER_MODE=production)",
        )


@router.post("/clip-point-cloud-fixture", response_model=SkillResponse)
async def clip_point_cloud_fixture(
    body: FixtureClipRequest,
    _=Depends(require_worker_key),
) -> SkillResponse:
    _guard_non_prod()

    # Lazy import — only loaded in non-prod
    try:
        from .tests_fixture_runtime import (
            aoi_polygon_geojson,
            aoi_polygon_outside_geojson,
            generate_fixture_las,
        )
    except Exception as e:
        raise HTTPException(500, f"fixture runtime unavailable: {e}")

    workdir = tempfile.mkdtemp(prefix="fixture-clip-")
    las_path = os.path.join(workdir, "fixture.las")
    meta = generate_fixture_las(las_path, inside_grid=40, outside_count=200)

    mode = (body.mode or "real").lower()
    if mode == "sparse":
        aoi = aoi_polygon_outside_geojson()
    elif mode == "real":
        aoi = aoi_polygon_geojson()
    else:
        raise HTTPException(400, f"unknown mode: {body.mode}")

    req = SkillRequest(
        skill_run_id=body.skill_run_id or str(uuid.uuid4()),
        measurement_request_id=body.measurement_request_id or str(uuid.uuid4()),
        measurement_job_id=body.measurement_job_id or str(uuid.uuid4()),
        request_hash="fixture-" + uuid.uuid4().hex,
        source_url="file://" + las_path,
        asset_type="las",
        aoi_geojson=aoi,
    )
    resp = run_clip_point_cloud(req)
    # Attach fixture metadata for the caller to assert against.
    resp.output_payload.setdefault("_fixture", {
        "mode": mode,
        "points_inside": meta.points_inside,
        "points_outside": meta.points_outside,
        "total_points": meta.total_points,
        "aoi_bounds": list(meta.aoi_bounds),
        "crs_epsg": meta.crs_epsg,
    })
    return resp


@router.get("/health")
async def test_health():
    _guard_non_prod()
    s = get_settings()
    return {
        "ok": True,
        "worker_mode": s.worker_mode,
        "local_artifact_dir": s.local_artifact_dir,
        "is_non_prod": s.is_non_prod,
    }
