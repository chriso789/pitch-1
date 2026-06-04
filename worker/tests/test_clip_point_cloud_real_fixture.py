"""End-to-end real-clip tests for clip_point_cloud using a synthetic LAS fixture.

These tests do REAL compute: they generate a tiny LAS file, run the PDAL
pipeline, and assert that the worker only marks status="completed" when a real
clipped artifact lands on disk (local-fallback storage in test mode).

If PDAL or laspy is not installed in the test environment these tests are
skipped — they MUST pass in the worker Docker image where PDAL is present.
"""
from __future__ import annotations

import os
import uuid

import pytest

pytest.importorskip("pdal")
pytest.importorskip("laspy")
pytest.importorskip("shapely")

from worker.app.config import get_settings  # noqa: E402
from worker.app.schemas import SkillRequest  # noqa: E402
from worker.app.skills.clip_point_cloud import run_clip_point_cloud  # noqa: E402
from worker.tests.fixtures.generate_test_las import (  # noqa: E402
    AOI_BOUNDS,
    aoi_polygon_geojson,
    aoi_polygon_outside_geojson,
    generate_fixture_las,
)


@pytest.fixture(scope="module")
def fixture_las_path(tmp_path_factory):
    p = tmp_path_factory.mktemp("clip-fixture") / "fixture.las"
    generate_fixture_las(str(p), inside_grid=40, outside_count=200)
    return str(p)


@pytest.fixture(autouse=True)
def _test_mode_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_MODE", "test")
    monkeypatch.setenv("LOCAL_ARTIFACT_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("MIN_CLIPPED_POINT_COUNT", "100")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


def _req(source_url: str, aoi: dict, **over) -> SkillRequest:
    base = dict(
        skill_run_id=str(uuid.uuid4()),
        measurement_request_id=str(uuid.uuid4()),
        measurement_job_id=str(uuid.uuid4()),
        request_hash="fixture-" + uuid.uuid4().hex,
        source_url=source_url,
        asset_type="las",
        aoi_geojson=aoi,
    )
    base.update(over)
    return SkillRequest(**base)


def test_clip_point_cloud_real_fixture(fixture_las_path):
    """Real clip success — AOI covers the inside grid; status=completed + real artifact."""
    src_url = "file://" + fixture_las_path
    req = _req(src_url, aoi_polygon_geojson())

    resp = run_clip_point_cloud(req)

    assert resp.status == "completed", (
        f"expected completed, got {resp.status} ({resp.error_message}) qa={resp.qa_flags}"
    )
    assert resp.artifacts, "completed run must emit at least one artifact"
    art = resp.artifacts[0]
    assert art.artifact_type == "clipped_point_cloud"
    assert art.storage_path.startswith("test-artifacts/"), art.storage_path

    payload = resp.output_payload
    assert payload["point_count"] > 0
    assert payload["point_count"] <= 1600

    b = payload["bounds"]
    minx, miny, maxx, maxy = AOI_BOUNDS
    slack = 0.5
    assert b["minx"] >= minx - slack and b["maxx"] <= maxx + slack, b
    assert b["miny"] >= miny - slack and b["maxy"] <= maxy + slack, b

    s = get_settings()
    rel = art.storage_path[len("test-artifacts/"):]
    expected = os.path.join(s.local_artifact_dir, rel)
    assert os.path.exists(expected), f"clipped artifact not written: {expected}"
    assert os.path.getsize(expected) > 0


def test_clip_point_cloud_sparse_or_empty_aoi(fixture_las_path):
    """Sparse AOI — polygon outside all points; MUST NOT return completed."""
    src_url = "file://" + fixture_las_path
    req = _req(src_url, aoi_polygon_outside_geojson())

    resp = run_clip_point_cloud(req)

    assert resp.status != "completed", (
        f"empty AOI must not return completed (got {resp.status} qa={resp.qa_flags})"
    )
    bad_signals = {
        "empty_pipeline_result", "low_point_count", "bounds_outside_aoi",
        "pipeline_error", "no_points", "sparse_output",
    }
    assert any(f in bad_signals for f in resp.qa_flags), (
        f"expected sparse/empty qa_flag, got {resp.qa_flags}"
    )
    if resp.status == "failed":
        assert not resp.artifacts
