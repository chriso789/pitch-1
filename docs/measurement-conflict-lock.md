# Measurement Conflict Lock (pre-rewire verification)

**Status:** REQUIRED before the AI Measurement button is rewired to the mskill
orchestrator. Pairs with `docs/measurement-pipeline-reuse-map.md` (the
helper/owner-skill contract) and `docs/measurement-integration-audit.md` (the
high-level integration plan).

This document is the explicit source map + writer map + single-writer
enforcement plan. It exists so the rewire **strengthens** the existing
measurement system instead of stacking a second pipeline on top of it.

Do NOT rewire `PullMeasurementsButton` / `useMeasurementJob` until every
section here is satisfied and the conflict tests (`pipeline-conflict.test.ts`,
`pipeline-conflict.test.tsx`) are green in both flag-OFF and flag-ON modes.

---

## 1. Existing data source map

Each source the existing AI measurement system pulls today, where it is
acquired, and how it is reused under the mskill pipeline.

| Source                 | Today (function / file)                                                                 | Provider / API                              | Required env / secret                       | Output table / bucket                                | Reuse decision (under mskill)                                  |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Geocode (address→lat/lng) | `_shared/geocoding.ts` (called by `start-ai-measurement`)                            | Google Geocoding / Mapbox                   | `GOOGLE_MAPS_API_KEY` / `MAPBOX_TOKEN`      | `roof_measurements.geocode_*` (column), `mskill_artifacts:geocode_result` | **Wrap** — owned by `geocode_address` executor                 |
| Parcel polygon         | `_shared/parcel-resolver.ts`, `mskill/executors/resolve_parcel.ts`                       | Regrid + per-county ArcGIS                  | `REGRID_API_KEY`, county URLs (seeded)      | `mskill_artifacts:parcel_polygon`                    | **Reuse** — already mskill executor                            |
| Building footprint     | `_shared/footprint-acquisition.ts`, `mskill/executors/resolve_building_footprint.ts`    | MS Bing Footprints / OSM / county           | none (public)                               | `mskill_artifacts:building_footprint`                | **Reuse** — already mskill executor                            |
| Aerial RGB tile        | `_shared/aerial-fetch.ts`, `analyze-roof-aerial`                                        | Google Static Maps / Mapbox Satellite       | `GOOGLE_MAPS_API_KEY`                       | `mskill_artifacts:aerial_raster`, `roof_measurements.raster_url` | **Wrap** — owned by `acquire_roof_surface_asset`               |
| Satellite/oblique imagery | `analyze-roof-aerial` (Google Solar `solarInfo`)                                     | Google Solar API                            | `GOOGLE_SOLAR_API_KEY`                      | `mskill_artifacts:solar_segments`                    | **Wrap** — owned by `acquire_roof_surface_asset` (Solar branch)|
| LiDAR coverage         | `mskill/executors/discover_lidar_coverage.ts`                                            | USGS 3DEP / state LiDAR catalogs            | none (public)                               | `mskill_artifacts:lidar_coverage`                    | **Reuse** — already mskill executor                            |
| Point cloud (.laz)     | worker skill `clip_point_cloud` (Python, this PR's earlier scaffold)                    | USGS Entwine / TNM / county COPC            | worker creds (`WORKER_*`)                   | `mskill_artifacts:clipped_point_cloud` (Storage)     | **Reuse** — worker skill (real fixture in progress)            |
| DSM                    | `_shared/dsm-derived-bounds-runtime.ts` (today), worker `generate_dsm` (planned)        | Google Solar `dataLayers.dsmUrl` (current)  | `GOOGLE_SOLAR_API_KEY`                      | `mskill_artifacts:dsm_geotiff`                       | **Wrap** today (Solar DSM), **migrate** to worker `generate_dsm` |
| DEM / DTM              | `mskill/executors/acquire_dem_dtm.ts`                                                    | USGS 3DEP, county DEM                       | none (public)                               | `mskill_artifacts:dem_geotiff` / `dtm_geotiff`       | **Reuse** — already mskill executor                            |
| AOI bounds             | `_shared/dsm-derived-bounds-runtime.ts`, `_shared/source-registration-transform.ts`     | derived (parcel + footprint)                | —                                           | `mskill_artifacts:aoi_bounds`                        | **Wrap** — called from `generate_dsm` registration step        |
| Roof target mask       | `_shared/target-mask-isolation.ts`, Solar `maskUrl`                                      | Google Solar `dataLayers.maskUrl`           | `GOOGLE_SOLAR_API_KEY`                      | `mskill_artifacts:target_roof_mask`                  | **Wrap** — owned by `acquire_roof_surface_asset`               |
| Roof outline / perimeter | `_shared/perimeter-refinement.ts`, `constrained-perimeter-solver.ts`                  | derived (mask + DSM + RGB)                  | —                                           | `mskill_artifacts:refined_perimeter_geojson`         | **Wrap** — owned by `create_roof_edge_candidates`              |
| Ridge / hip / valley   | `_shared/ridge-clustering.ts`, `ridge-cluster-region-split.ts`, `dsm-edge-detector.ts`  | derived (DSM gradient + RGB edges)          | —                                           | `mskill_artifacts:ridge_clusters` / `dsm_edge_features` | **Wrap** — owned by `detect_ridges` / `detect_hips` / `detect_valleys` |
| Eaves / rakes          | `_shared/perimeter-topology.ts`, `gable-detector.ts`, Phase 3A classifier               | derived (perimeter + DSM gradient)          | —                                           | `mskill_artifacts:typed_perimeter_segments`          | **Wrap** — owned by `detect_eaves` / `detect_rakes`            |
| Visual QA overlay      | `_shared/dsm-diagnostic-propagation.ts`, `overlay-evaluator.ts`, `MeasurementVisualQAOverlay` | derived                                  | —                                           | `roof_measurements.geometry_report_json.overlay_debug`, `debug_perimeter_overlay_svg` | **Wrap** — produced inside `validate_geometry`, rendered unchanged |
| PDF / customer report  | `render-measurement-pdf`, `_shared/roof-diagram-renderer.ts`, `diagram-render-intent.ts` | internal                                    | —                                           | `roof_measurements.pdf_url`, `mskill_artifacts:report_pdf` | **Wrap** — invoked by `export_report` executor                 |
| Vendor benchmark       | `roof_measurement_benchmarks` table (manual)                                            | manual ingest                               | —                                           | `roof_measurements.vendor_benchmark_*`               | **Reuse unchanged** — read by `validate_geometry` gate         |

Any source not listed above must be added here **before** the mskill executor
that pulls it ships.

---

## 2. Existing writer map (who can mutate measurement state)

| Function / module                                  | Writes to                                                  | Classification under flag ON                                       |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `start-ai-measurement` (canonical legacy)          | `ai_measurement_jobs`, `roof_measurements` (final)         | **Wrapped → shim**. Forwards to `measurement-api POST /pipeline/start`. `?legacy=1` falls through to `index.legacy.ts` and stamps `route_warning`. |
| `start-ai-measurement/index.legacy.ts`             | `ai_measurement_jobs`, `roof_measurements` (final)         | **Legacy-only**. Allowed iff `?legacy=1`. Stamps `canonical_measurement_route=false`. |
| `measure-roof`                                     | `roof_measurements` (final)                                | **Should be blocked** in flag-ON mode by `assertFinalWriterAllowed` guard. Diagnostics-only otherwise. |
| `measure`                                          | `roof_measurements` (final)                                | **Should be blocked** in flag-ON mode (same guard).                |
| `analyze-roof-aerial`                              | `mskill_artifacts:aerial_raster`, transient cache          | **Wrapped by skill executor**. Direct invocation allowed (read-only / diagnostic). Never writes final. |
| `recalculate-measurement-from-overrides`           | `roof_measurements` (final, override path)                 | **Allowed** — stamps `validation_source='override'`. Not gated by flag. |
| `render-measurement-pdf`                           | `roof_measurements.pdf_url`, Storage                       | **Wrapped by `export_report`**. In flag-ON, refuses canonical render unless invoked with `export_report_run_id` header. |
| `generate-roof-report` / `generate-roofr-style-report` | Storage (PDF), `roof_measurements.pdf_url`             | **Wrapped by `export_report`**. Same gate as above.                 |
| `debug-measurement-runtime`                        | read-only                                                  | **Untouched** — extended to report `mskill_job_id`.                |
| `bridgeSkillReportToRoofMeasurements` (NEW)        | `roof_measurements` (final)                                | **THE single canonical final writer in flag-ON mode.**             |
| Worker `clip_point_cloud`                          | `mskill_artifacts:clipped_point_cloud`                     | **Intermediate artifact writer** — never final.                    |
| `_shared/perimeter-refinement.ts`, `ridge-clustering.ts`, `dsm-derived-bounds-runtime.ts`, `dsm-diagnostic-propagation.ts`, `segment-topology-analyzer.ts`, `autonomous-graph-solver.ts` | helpers (no direct DB writes) | **Helper modules** — must be called from inside a `mskill_runs` row in flag-ON mode (T-6 enforces). |

**Single-writer rule** — when flag is ON, exactly three paths may insert/update
`roof_measurements` rows:

1. `bridgeSkillReportToRoofMeasurements` (the mskill bridge — canonical).
2. `recalculate-measurement-from-overrides` (manual override path).
3. `start-ai-measurement/index.legacy.ts` **only** when `?legacy=1` is set.

Everything else must call `assertFinalWriterAllowed(ctx)` (see
`_shared/mskill/writer-guard.ts`) and abort with `409 final_writer_blocked`
when the guard rejects.

---

## 3. Source provenance fields (stamped on every artifact + final row)

Every mskill artifact and every `roof_measurements` row written under the new
pipeline must carry the following provenance fields (stable JSONB keys under
`geometry_report_json.route_provenance` for the row, mirrored on
`mskill_artifacts.provenance` for the artifact):

| Field                  | Type     | Required | Meaning                                                          |
| ---------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `source_module`        | text     | yes      | File path of the helper that produced the artifact               |
| `source_function`      | text     | yes      | Exported function name within that module                        |
| `provider_key`         | text     | when provider-backed | Matches `mskill_provider_sources.key` (e.g. `google_solar`)      |
| `measurement_request_id` | uuid   | yes      | `mskill_jobs.measurement_request_id`                             |
| `request_hash`         | text     | yes      | SHA-256 of the canonical request envelope                        |
| `measurement_job_id`   | uuid     | when bridged | `roof_measurements.measurement_job_id` (legacy mirror)           |
| `mskill_job_id`        | uuid     | yes (mskill) | `mskill_jobs.id`                                                 |
| `skill_run_id`         | uuid     | when produced by a skill | `mskill_runs.id`                                                 |
| `legacy_artifact`      | boolean  | yes      | `true` when written by the `?legacy=1` path                      |
| `wrapped_by_skill`     | boolean  | yes      | `true` when the helper was invoked from inside a `mskill_runs` row |
| `route_warning`        | text     | when legacy | `'legacy_noncanonical_measurement_path'` for legacy rows         |
| `canonical_measurement_route` | boolean | yes | `true` only for mskill-bridged or override-validated rows        |

The stamping helper lives at `supabase/functions/_shared/mskill/provenance.ts`
(`buildRouteProvenance`, `stampArtifactProvenance`). The writer guard at
`supabase/functions/_shared/mskill/writer-guard.ts`
(`assertFinalWriterAllowed`) enforces these fields are present before any
`roof_measurements` insert/update.

---

## 4. Conflict tests (extension of §7 in the reuse map)

Already scaffolded in:

- `supabase/functions/measurement-api/__tests__/pipeline-conflict.test.ts`
- `src/components/measurements/__tests__/pipeline-conflict.test.tsx`

This conflict lock adds the following concrete assertions (no longer pending):

- **T-4a**: `assertFinalWriterAllowed` rejects writes from `measure-roof` /
  `measure` when flag ON and `mskill_job_id` is absent.
- **T-5a**: `assertExportReportGate` rejects PDF render requests that lack an
  `export_report_run_id` referencing a `completed` `mskill_runs` row.
- **T-6a**: `assertWrappedHelperCall` rejects helper invocations (perimeter /
  ridge / DSM) that are not nested inside an open `mskill_runs` row.
- **T-8 (NEW)**: `buildRouteProvenance` produces all required fields from a
  minimal context; missing any required field throws and writes nothing.
- **T-9 (NEW)**: Two simultaneous `bridgeSkillReportToRoofMeasurements` calls
  for the same `measurement_job_id` collapse to a single row (unique guard on
  `(measurement_job_id, mskill_job_id)`).

---

## 5. Rewire approval gate (extends reuse-map §8)

Conflict lock additions (must all be checked **before** flipping the button):

- [x] §1 source map written and reviewed
- [x] §2 writer map written and reviewed
- [x] `provenance.ts` helper available
- [x] `writer-guard.ts` helper available
- [ ] All legacy final writers (`measure-roof`, `measure`,
      `start-ai-measurement/index.legacy.ts`) call `assertFinalWriterAllowed`
      before insert/update
- [ ] `render-measurement-pdf` / `generate-roof-report` /
      `generate-roofr-style-report` call `assertExportReportGate`
- [ ] Helper modules (perimeter / ridge / DSM) call `assertWrappedHelperCall`
      at their entry points (or skill executors call it on their behalf)
- [ ] T-4a / T-5a / T-6a / T-8 / T-9 promoted from pending → asserting
- [ ] Fonsica / Montelluna / Palm Harbor replays green in flag-ON mode

Only after every box is checked does `useMeasurementJob` switch on the flag
and `start-ai-measurement` become a shim.
