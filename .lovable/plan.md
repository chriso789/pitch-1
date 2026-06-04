# PITCH Measure — Beat Nearmap Without Nearmap

**Mission:** First-party roof measurement engine using free / public / already-connected sources. **No Nearmap integration.**

## Phase status

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Capability-gap doc vs Nearmap | ✅ `docs/pitch-vs-nearmap-capability-gap.md` |
| 1 | `verifyRoofSurfaceDataAvailability` + executor | ✅ `_shared/mskill/verify-roof-surface-data.ts` + `executors/verify_roof_surface_data.ts` |
| 2 | `generate_dsm` / `generate_dtm` / `generate_chm` worker skills (real PDAL/rasterio) | ✅ `worker/app/skills/generate_*.py` |
| 3 | `isolate_roof_points` + `refine_roof_perimeter_from_surface` | ✅ `worker/app/skills/isolate_roof_points.py`, `refine_roof_perimeter_from_surface.py` |
| 4 | `fit_roof_planes` (RANSAC) | ✅ `worker/app/skills/fit_roof_planes.py` |
| 5 | `detect_ridges` / `_hips` / `_valleys` / `_eaves` / `_rakes` (plane-intersection classifier) | ✅ `worker/app/skills/detect_segments.py` |
| 6 | `calculate_pitch` + `calculate_roof_area` (slope-adjusted) | ✅ `worker/app/skills/geometry_finalize.py` |
| 7 | `geometry_quality_score` (first-party confidence score) | ✅ `geometry_finalize.run_geometry_quality_score` |
| 7b | `validate_geometry` (gates: closure, snap tolerance, area reconciliation) | 🟡 still scaffold |
| 7c | `export_report` (PDF + GeoJSON) | 🟡 still scaffold |
| 8 | Bridge writer to `roof_measurements` + AI Measurement button rewire | 🔒 **gated** — does not proceed until 7b/7c pass on regression suite |

Worker version bumped: `0.3.0-geometry-engine`.

## Hard rules (still enforced)

- DEM/DTM-only is **not** sufficient — `verifyRoofSurfaceDataAvailability` returns `blocking_reason="dem_only_not_sufficient"`.
- LiDAR coverage rows without a `source_url` / `asset_reference` → `roof_geometry_possible=false`.
- Nearmap provider keys are filtered out in `verify-roof-surface-data.ts` (`NEARMAP_FORBIDDEN_PREFIX`).
- Math-only soffit offsets never outrank `refine_roof_perimeter_from_surface` output (already enforced by `perimeter-selection.ts`).
- Eaves/rakes are NEVER classified from footprint alone — only after `fit_roof_planes` succeeds.
- AI Measurement button rewire stays gated until validate_geometry + Fonsica/Montelluna/Palm Harbor regression pass.

## Regression suite (still required before Phase 8)

- 4063 Fonsica
- neighbor Fonsica address
- Montelluna
- Palm Harbor
- simple gable
- hip roof
- complex valley
- tile roof
- metal roof
- flat / commercial

## Next steps for the next loop

1. Real `validate_geometry` (polygon closure, snap tolerance, area reconciliation between perimeter / footprint / facet sum).
2. Real `export_report` (PDF + GeoJSON, only callable after `validate_geometry.completed`).
3. Provider catalog seed rows for USGS 3DEP, NOAA Digital Coast, LABINS — with `source_url` / `asset_reference` columns populated so `verifyRoofSurfaceDataAvailability` returns real candidates.
4. Wire `verifyRoofSurfaceDataAvailability` into `measurement-api` start-of-pipeline; refuse to enqueue DSM/DTM/CHM skills when `roof_geometry_possible=false`.
5. Worker fixture tests for `generate_dsm`, `fit_roof_planes`, `detect_segments` parallel to existing `test_clip_point_cloud_real_fixture.py`.
6. Then — and only then — bridge writer → `roof_measurements` and AI Measurement button rewire.
