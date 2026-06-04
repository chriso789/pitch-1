"""Re-export of the fixture generator for runtime (non-test-collection) imports.

The test fixture generator lives under `worker/tests/fixtures/` which is fine
for pytest collection, but importing from `worker.tests.*` at runtime is
fragile (tests dir is excluded from some package layouts). This thin module
re-exports the functions so worker/app/test_routes.py can import them without
pulling pytest into the worker runtime path.
"""
from __future__ import annotations

# Import directly from the fixtures module — it has no test-only dependencies.
from worker.tests.fixtures.generate_test_las import (  # noqa: F401
    AOI_BOUNDS,
    FIXTURE_CRS_EPSG,
    FixtureMeta,
    aoi_polygon_geojson,
    aoi_polygon_outside_geojson,
    generate_fixture_las,
)
