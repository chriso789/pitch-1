"""Unit tests for the clip_point_cloud skill input gates.

These tests do NOT require PDAL — they exercise the early validation gates
that must reject bad input before any compute happens. PDAL/laspy are imported
lazily inside _lazy_imports(), so we never hit them on bad-input paths.
"""
import pytest

from worker.app.schemas import SkillRequest
from worker.app.skills.clip_point_cloud import run_clip_point_cloud


def _req(**over) -> SkillRequest:
    base = dict(
        skill_run_id="00000000-0000-0000-0000-000000000001",
        measurement_request_id="00000000-0000-0000-0000-000000000002",
        request_hash="a" * 32,
        measurement_job_id="00000000-0000-0000-0000-000000000003",
        source_url="https://example.com/sample.laz",
        asset_type="laz",
        aoi_geojson={
            "type": "Polygon",
            "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
    )
    base.update(over)
    return SkillRequest(**base)


def test_missing_source_url_fails():
    r = run_clip_point_cloud(_req(source_url=None))
    assert r.status == "failed"
    assert "missing_source_url" in r.qa_flags


def test_missing_aoi_fails():
    r = run_clip_point_cloud(_req(aoi_geojson=None))
    assert r.status == "failed"
    assert "missing_aoi" in r.qa_flags


def test_invalid_aoi_fails():
    r = run_clip_point_cloud(_req(aoi_geojson={"type": "Polygon", "coordinates": []}))
    assert r.status == "failed"
    assert "invalid_aoi_geojson" in r.qa_flags


def test_short_request_hash_fails():
    r = run_clip_point_cloud(_req(request_hash="short"))
    assert r.status == "failed"
    assert "missing_request_hash" in r.qa_flags


def test_unsupported_asset_type_fails():
    r = run_clip_point_cloud(_req(asset_type="geotiff"))
    assert r.status == "failed"
    assert "unsupported_asset_type" in r.qa_flags


def test_never_returns_stub_completed():
    # The stub-completion path simply does not exist in this skill — any
    # failure surface returns status=failed (or needs_review for sparse output).
    r = run_clip_point_cloud(_req(source_url=None))
    assert r.status != "completed"
    assert r.status != "needs_implementation"
