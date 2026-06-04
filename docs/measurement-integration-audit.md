# Measurement Integration Audit

**Status:** Pre-integration audit. Code unchanged. Findings drive the safe rewire of the **AI Measurement** button onto the new `mskill_*` pipeline while preserving `roof_measurements` as the final compatibility surface.

**Counterpart plan:** `.lovable/plan.md` (`start-measurement-pipeline` orchestrator + bridge).

---

## 1. Current UI triggers

| UI component | Hook | Edge function invoked | Payload (key fields) | Downstream |
|---|---|---|---|---|
| `src/components/measurements/PullMeasurementsButton.tsx` | `useMeasurementJob.startJob` | `start-ai-measurement` | `lead_id, lat, lng, address, zoom=21, pitchOverride, tenantId, userId, original_geocode_lat/lng, confirmed_roof_center_*, user_confirmed_roof_target, user_verified_perimeter, prior_ai_measurement_job_id, source_button="AI Measurement"` | writes `measurement_jobs` (polled), then `roof_measurements` + `measurement_approvals` |
| `src/components/measurements/UnifiedMeasurementPanel.tsx` (delete) | inline | `delete-ai-measurements` | `{ measurementId }` | clears `roof_measurements` row |
| `src/components/measurements/TraceRoofButton.tsx` | inline | `trace-roof` | `{ lat, lng, ... }` | separate legacy trace path (not canonical) |
| `src/components/estimates/ManualMeasurementDialog.tsx` | inline | direct insert | manual facets | writes `roof_measurements` |
| `src/hooks/useMeasurement.ts` | `useMeasurement.*` | `measure` (5 invocations) | mixed | **legacy** — not on canonical path; used by `RoofMeasurementTool` legacy page |
| `src/components/measurements/MeasurementReportDialog.tsx` | render-only | `render-measurement-pdf` | `{ measurementId }` | PDF of existing row |
| `src/pages/admin/MeasurementJobPipelinePage.tsx` | admin only | reads `mskill_jobs` | n/a | new pipeline visualization (admin) |

**Canonical AI Measurement button path today:** `PullMeasurementsButton → useMeasurementJob.startJob → start-ai-measurement → measurement_jobs → roof_measurements`.

---

## 2. Current edge functions (measurement-related)

| Function | LOC | State | Purpose | Tables written |
|---|---:|---|---|---|
| `start-ai-measurement` | 16,314 | **active** (canonical) | geometry_first_v2 monolith: footprint cascade → DSM/solar → autonomous graph solver → bridge to `roof_measurements` | `measurement_jobs`, `ai_measurement_jobs`, `roof_measurements`, `measurement_approvals`, `geometry_report_json` |
| `start-ai-measurement/index.legacy.ts` | – | legacy snapshot | prior version retained | none (file-only) |
| `measure` | 5,937 | legacy | older synchronous endpoint used by `useMeasurement.ts` and `RoofMeasure.tsx` | `roof_measurements`, `roof_measurement_versions` |
| `measure-roof` | 304 | legacy | thin wrapper over older AI measure | `roof_measurements` |
| `analyze-roof-aerial` | 5,804 | legacy | AI vision aerial analyzer | `ai_measurement_jobs` |
| `ai-measurement` | – | duplicate | old name; still present | `roof_measurements` (audit later) |
| `ai-measurement-analyzer` | – | duplicate | older analyzer | – |
| `auto-generate-measurements`, `batch-regenerate-measurements`, `batch-remeasure` | – | batch tools | bulk reruns | `roof_measurements` |
| `calculate-measurement-corrections`, `calculate-roof-measurements` | – | utility | corrections | `roof_measurements` |
| `compare-ai-measurement-to-vendor`, `compare-accuracy` | – | QA | vendor benchmark | `roof_measurement_benchmarks` |
| `debug-footprint-sources`, `debug-measurement-runtime` | – | admin diagnostics | inspection | none |
| `delete-ai-measurements` | – | active | delete row | `roof_measurements` |
| `detect-building-footprint`, `regrid-footprint`, `save-manual-footprint` | – | active utility | footprint helpers | `roof_measurements.footprint_*` |
| `detect-roof-obstruction` | – | active utility | obstruction flagging | `roof_measurements` |
| `extract-roof-plan-geometry` | – | utility | geometry extraction | – |
| `generate-estimate-from-measurement` | – | active | estimate generator | `estimates` |
| `generate-measurement-visualization`, `generate-roof-line-overlay`, `generate-roof-overlay` | – | rendering | overlay PNGs | Storage bucket |
| `generate-roof-report`, `parse-roof-report`, `roof-report-ingest` | – | vendor PDF ingest | imports paid reports | `roof_measurements`, `roof_report_imports` |
| `measurement-api` | 400 | **new, partially scaffolded** | routed: `/mskill/jobs/create`, `/mskill/jobs/get`, `/mskill/skills/pipeline`, `/mskill/skills/run`, `/mskill/skills/run-status`, `/mskill/skills/retry`, `/mskill/jobs/bridge`, plus measurement-imports normalize/split | `mskill_*` |
| `measurement-worker` | 104 | **new** | service-role callback endpoint for worker | `mskill_runs`, `mskill_artifacts` |
| `measurement-worker-test` | – | **new** | test harness for clip_point_cloud | none |
| `measurement-calibration`, `measurement-learning-loop` | – | learning loop | accuracy training | `measurement_learning_*` |
| `recalculate-measurement-from-overrides` | – | active | manual override recalc | `roof_measurements` |
| `render-measurement-pdf` | 654 | active | PDF render | Storage |
| `roofhub-webhook` | – | external | inbound provider | `roof_measurements` (vendor) |
| `run-measurement-benchmark`, `score-roof-accuracy`, `track-measurement-accuracy`, `validate-measurement` | – | QA | benchmarks | `roof_measurement_benchmarks` |
| `trace-roof` | – | legacy alt | manual trace | `roof_measurements` |

**Architecture-guard note:** 40 measurement-related folders exist. Per `pitch-crm-route-migration-enforcer`, anything new must land in `measurement-api` / `measurement-worker`, not as a new standalone function.

---

## 3. Current data sources pulled by `start-ai-measurement`

Source cascade (from `start-ai-measurement` + `_shared/footprint-source.ts`):

| Source | Provider / API | Env var | Used for | Where stored | Reusable by new pipeline? |
|---|---|---|---|---|---|
| Geocoding | Google Geocoding | `GOOGLE_MAPS_API_KEY` | address → lat/lng | request, not persisted | **yes** → `geocode_address` executor |
| OSM Overpass building polygons | OpenStreetMap | none | `footprint_source=osm_overpass` | `geometry_report_json.footprint_source` | **yes** → `resolve_building_footprint` |
| Google Solar mask contour | Google Solar API | `GOOGLE_SOLAR_API_KEY` | `footprint_source=google_solar_mask_contour`, DSM, mask | `geometry_report_json`, debug storage | **yes** → `discover_elevation_assets` + footprint executor |
| Google Solar Data Layers (DSM/mask/RGB) | Google Solar | `GOOGLE_SOLAR_API_KEY` | primary DSM evidence | Storage `dsm-debug/{job}/...` | **yes** as elevation_asset (Solar tier) |
| Mapbox satellite static tiles | Mapbox | `VITE_MAPBOX_PUBLIC_TOKEN` (client) + server tokens | aerial overlay | request, debug bucket | reusable for overlay only |
| Mapbox vector building tiles | Mapbox | as above | `footprint_source=mapbox_vector` | `geometry_report_json` | reusable |
| UNet mask | none built (per `mem://constraints/measurement-unet-not-built`) | – | `unet_mask` slot in cascade | unused | **no — not built** |
| AI detection (vision) | OpenAI/Anthropic | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | `ai_detection` fallback | `geometry_report_json` | reusable but optional |
| Vendor PDFs (EagleView/Roofr/etc.) | manual upload | – | `roof-report-ingest` | `roof_report_imports`, `roof_measurements` | bypass pipeline — direct write |
| LABINS / FL LiDAR coverage | – | – | **not currently pulled** in `start-ai-measurement` | – | **new** in pipeline (`discover_lidar_coverage`) |
| USGS 3DEP | – | – | **not currently pulled** | – | **new** (`discover_elevation_assets`) |
| NOAA Digital Coast | – | – | **not currently pulled** | – | **new** |
| County parcel / footprint APIs | – | – | **not currently pulled** | – | **new** (`resolve_parcel`) |

**Key gap:** the current button does not touch LiDAR / 3DEP / NOAA / county sources at all. Those are net-new capability via the mskill control plane. Solar + OSM remain primary fallbacks.

---

## 4. Current artifacts produced

| Artifact | Produced by | Stored in | QA / confidence | Failure modes | Pipeline role |
|---|---|---|---|---|---|
| Roof outline / `true_outer_roof_perimeter` | `start-ai-measurement` perimeter phase | `roof_measurements.true_outer_roof_perimeter_geo`, `..._px`, `geometry_report_json` | `perimeter_validation`, `shape_validation` | shape_passed=false → no topology | **input** to `validate_geometry`; reusable as Layer-1 perimeter |
| Footprint polygon + source | footprint cascade | `geometry_report_json.footprint_source`, `footprint_px/geo` | `footprint_confidence`, hard gates | source_acquisition_failed → block | **input** to `resolve_building_footprint` |
| DSM (Solar Data Layers) | Solar API fetcher | Storage `dsm-debug/{job}/dsm.tif` | `dsm_coverage`, registration RMS/IoU | Solar 403 → hard fail | **input** to `acquire_roof_surface_asset` |
| Roof mask | Solar / contour | Storage / `geometry_report_json` | `mask_iou`, `coverage` | low IoU → fail | **input** |
| Facets | autonomous_graph_solver | `geometry_report_json.facets`, `roof_lines` | `validated_faces_pct` | <70% → hard fail | replaced by `fit_roof_planes` (compute) |
| Ridges/hips/valleys (LF) | classifyEdgeByDSM | `roof_lines`, `total_*_length` | along-edge gradient | classification ambiguous → ridge_network_missing | replaced by `detect_ridges/hips/valleys` |
| Eaves/rakes (LF) | Phase 3A classifier | `roof_lines`, `total_eave_length`, `total_rake_length` | confidence | – | replaced by `detect_eaves/detect_rakes` |
| Predominant pitch | pitch fusion (DSM + Solar) | `roof_measurements.predominant_pitch`, `pitch_source` | `pitch_source` enum | <2/12 → Solar fallback | replaced by `calculate_pitch` |
| Roof area (adjusted + flat) | area calc | `total_area_adjusted_sqft`, `total_area_flat_sqft` | `area_ratio` gate | >1.25 → hard fail | replaced by `calculate_roof_area` |
| Overlay image | `generate-roof-overlay` / `generate-roof-line-overlay` | Storage | – | – | reused for UI |
| Visual QA result | registration gate | `geometry_report_json.registration` | rms_px, max_error_px, mask_iou, coverage | rms>4, iou<0.85 → fail | reused as input to `validate_geometry` |
| PDF report | `render-measurement-pdf` | Storage | – | – | reused; pipeline calls after bridge |
| `geometry_report_json` | start-ai-measurement | `roof_measurements.geometry_report_json` JSONB | many gates | – | **bridge surface**: new pipeline must write equivalent fields when bridging |

---

## 5. Database tables (measurement-related)

| Table | Writers | Readers | Recommendation |
|---|---|---|---|
| `roof_measurements` | start-ai-measurement, measure, measure-roof, ai-measurement, manual dialog, vendor ingest | every UI consumer (`MeasurementReportDialog`, estimate builder, etc.) | **KEEP** as final compatibility surface. New pipeline writes here ONLY via `bridgeSkillReportToRoofMeasurements` after validate_geometry + export_geojson + export_report. |
| `ai_measurement_jobs` | start-ai-measurement | hooks, debug-measurement-runtime | KEEP (job-level state, patent confirmation). New pipeline mirrors confirmation rules. |
| `measurement_jobs` | start-ai-measurement | useMeasurementJob polling | KEEP; bridge populates so existing polling UI continues to work. |
| `measurement_approvals` | start-ai-measurement | UnifiedMeasurementPanel | KEEP. |
| `measurement_overrides` | manual edits | recalculate-measurement-from-overrides | KEEP, unchanged. |
| `roof_measurement_benchmarks` | benchmark tools | vendor verification UI | KEEP. |
| `measurement_imports` + `measurement_import_segments` | measurement-api | classifier/mapper | KEEP. |
| `roof_report_imports` | roof-report-ingest | – | KEEP. |
| `mskill_requests` | measurement-api `/mskill/jobs/create` | runner, bridge | **NEW canonical request contract.** |
| `mskill_jobs` | measurement-api | runner, bridge, admin pipeline UI | **NEW canonical job.** Must associate with `measurement_jobs` and `ai_measurement_jobs` so legacy UI sees it. |
| `mskill_runs` | runner | pipeline status UI, bridge | **NEW.** Realtime feed for the new status panel. |
| `mskill_artifacts`, `mskill_report_artifacts` | runner + worker callback | bridge, debug | **NEW.** Bridge gate. |
| `mskill_workers` | measurement-worker registration | measurement-worker-test panel | **NEW.** |
| `mskill_roof_surface_assets`, `mskill_surface_processing_jobs`, `mskill_parcels`, `mskill_building_footprints`, `mskill_lidar_assets`, `mskill_lidar_windows`, `mskill_elevation_assets`, `mskill_roof_edge_candidates`, `mskill_plane_candidates`, `mskill_segments`, `mskill_geometry_status` | executors + worker | runner + bridge | **NEW**, isolated namespace. No collision with legacy. |
| `mskill_pipeline_bridges` | bridge | audit | **NEW** — provenance row for every roof_measurements bridge. |
| `mskill_provider_*` | provider executors | discovery | **NEW.** |

---

## 6. Conflict map (legacy ↔ new)

| Risk | Conflict | Mitigation |
|---|---|---|
| Duplicate job creation | both `measurement_jobs` and `mskill_jobs` get created when button clicked | Orchestrator inserts ONE `mskill_jobs` row and ONE matching `measurement_jobs` shell (so existing `useMeasurementJob` polling still works). |
| Duplicate status tracking | `measurement_jobs.status` vs `mskill_jobs.status` vs per-run `mskill_runs.status` | Orchestrator is the single writer; `measurement_jobs.status` derived from pipeline state. |
| Duplicate report generation | legacy renders from `geometry_report_json`; new pipeline produces `export_report` artifact | Bridge populates `geometry_report_json` from `export_report` so renderer is unchanged. |
| Duplicate roof polygon storage | legacy `true_outer_roof_perimeter_*` vs new `mskill_segments` | Bridge writes both. Legacy columns derived from validated mskill output. |
| Duplicate DSM artifacts | legacy `dsm-debug` bucket vs new `mskill-artifacts` | Keep both; reference mskill artifact in `geometry_report_json.evidence_pointers`. |
| Duplicate provider calls | Solar pulled by legacy AND new pipeline | New `acquire_roof_surface_asset` reads from cached mskill artifact first; only pulls fresh when missing. |
| Stale artifact risk | request_hash drift between request and job | already enforced in `bridge.ts` (`request_hash` mismatch → blocked). |
| Wrong request_hash on worker callback | worker returns artifact bound to wrong run | already returns HTTP 409 in `measurement-worker`. |
| Incomplete data into `roof_measurements` | bridge runs before geometry validated | already enforced: bridge refuses unless `validate_geometry + export_geojson + export_report` + 10 required artifact types. **Hard rule preserved.** |
| Two AI measurement buttons | none in UI today; legacy `RoofMeasure.tsx` is separate page, not the AI Measurement button | no action — leave RoofMeasure legacy page. |

---

## 7. Reuse map — what we keep and call from the new pipeline

| Reusable asset | Location | Role in new pipeline |
|---|---|---|
| DSM-derived bounds | `supabase/functions/_shared/dsm-derived-bounds-runtime.ts` | called by `acquire_roof_surface_asset` |
| Footprint cascade + sanity gates | `_shared/footprint-source.ts` | called by `resolve_building_footprint` |
| DSM diagnostic propagation | `_shared/dsm-diagnostic-propagation.ts` | used by `validate_geometry` |
| Perimeter refinement | `_shared/perimeter-refinement.ts` | input to `validate_geometry` (Layer-1 perimeter contract) |
| Ridge clustering / region split | `_shared/ridge-clustering.ts`, `ridge-cluster-region-split.ts` | shadowed by future `detect_ridges` worker; used as **cross-check**, never as the canonical source |
| Registration gate | `_shared/registration-gate.ts` | reused inside `validate_geometry` |
| Result-state normalizer | `_shared/result-state.ts` | bridge MUST use `normalizeResultStateForWrite()` for every `roof_measurements` write |
| Customer-report-ready guard | `assertCustomerReportReady` (in start-ai-measurement) | extracted/reused by bridge before flipping flag |
| PDF renderer | `render-measurement-pdf` | called by `export_report` (or post-bridge from UI, unchanged) |
| MeasurementReportDialog | `src/components/measurements/MeasurementReportDialog.tsx` | unchanged — reads `roof_measurements` |
| Regression harness | `.agents/skills/ai-measurement-regression-harness/SKILL.md` | new pipeline subject to same Fonsica/Montelluna/Palm Harbor assertions |
| Vendor verification dashboard | `src/components/settings/VendorVerificationDashboard.tsx` | unchanged — reads `roof_measurement_benchmarks` |
| Real-time `mskill_runs` subscription | new | feeds new `MeasurementPipelineStatus` UI panel |
| Bridge guard | `_shared/mskill/bridge.ts` (`REQUIRED_ARTIFACT_TYPES`) | already enforces 10-artifact gate before `roof_measurements` write |

---

## 8. Safe integration recommendation

### What stays legacy (untouched)
- `measure`, `measure-roof`, `analyze-roof-aerial`, `ai-measurement`, `ai-measurement-analyzer`, `auto-generate-measurements`, `trace-roof`, `RoofMeasure.tsx`, `useMeasurement.ts` — NOT on canonical AI Measurement button path. Audit later for DELETE_CANDIDATE.
- `render-measurement-pdf`, `MeasurementReportDialog`, `EstimatePreviewPanel`, `EnhancedEstimateBuilder` — read `roof_measurements`; need no changes.
- `roof-report-ingest`, vendor benchmarks, `recalculate-measurement-from-overrides` — independent inputs to `roof_measurements`.

### What becomes a shim
- `start-ai-measurement` → thin forwarder that calls the new orchestrator with the user's JWT, stamps `legacy_entrypoint=start-ai-measurement`, `routed_to=measurement_skills_pipeline`. Legacy `geometry_first_v2` body remains reachable only behind `?legacy=1` query flag for debug parity tests during cutover.

### What becomes the new orchestrator
- **Per architecture guard:** NOT a new standalone function. Add `POST /pipeline/start` to existing `measurement-api`. (Plan revised from earlier `start-measurement-pipeline` standalone proposal.) The orchestrator:
  1. `requireAuth` + `requireTenant`
  2. inserts `mskill_requests` + `mskill_jobs` and mirrors a `measurement_jobs` shell so `useMeasurementJob` polling keeps working
  3. runs control-plane skills 1–8 inline via `runMeasurementSkill`
  4. probes worker health; dispatches compute skills 9–21 or marks them `blocked: worker_offline` (pipeline → `paused`, NOT `failed`)
  5. runs 22 `validate_geometry`, 23 `export_geojson`, 24 `export_report`
  6. calls `bridgeSkillReportToRoofMeasurements` only when artifact gate passes
- Frontend `useMeasurementJob.startJob` → `edgeApi("measurement-api", "/pipeline/start", payload)`.

### Reused data-source functions
- Solar/DSM acquisition: existing helpers reused by `acquire_roof_surface_asset`.
- Footprint cascade reused by `resolve_building_footprint`.
- Geocoding helper reused by `geocode_address`.
- Validation gates (`registration-gate`, perimeter refinement, result-state normalizer) reused by `validate_geometry` and the bridge.

### Bridged artifacts (mskill → roof_measurements)
| Source artifact | Target column |
|---|---|
| `report_json.totals["roof.total_sqft"]` | `total_area_adjusted_sqft` |
| `report_json.totals["roof.plan_sqft"]` | `total_area_flat_sqft` |
| `report_json.totals["lf.{ridge,hip,valley,eave,rake}"]` | `total_{ridge,hip,valley,eave,rake}_length` |
| `mskill_segments` perimeter | `true_outer_roof_perimeter_geo` / `..._px` |
| `pitch_results` | `predominant_pitch`, `pitch_source` |
| `validate_geometry` output | `geometry_report_json` (merged), `result_state` (via `normalizeResultStateForWrite`), `customer_report_ready` (via `assertCustomerReportReady`) |
| `export_report` PDF artifact | `geometry_report_json.report_pdf_path` |

Bridge MUST stamp: `created_by_function='measurement-api'`, `solver_entrypoint='mskill_pipeline'`, `canonical_measurement_route=true`, `route_audit_version=current`, `report_renderer_version=…`, `route_provenance.legacy_entrypoint`, `mskill_request_id`, `mskill_job_id`, `request_hash`.

### Deprecation later
After 2 weeks of dual-path observation:
1. Mark `measure`, `measure-roof`, `analyze-roof-aerial`, `ai-measurement`, `ai-measurement-analyzer`, `trace-roof`, `RoofMeasure.tsx`, `useMeasurement.ts` as DELETE_CANDIDATE in `docs/edge-function-consolidation-audit.csv`.
2. Replace `start-ai-measurement/index.ts` body with `_shared/shim.ts` forwarder.
3. Remove `?legacy=1` debug branch.

### Tests that MUST pass before the AI Measurement button is rewired
Per `.agents/skills/ai-measurement-regression-harness/SKILL.md`:
- **Fonsica** (4063 Fonsica Ave): area 3077±2%, ~264 LF perimeter, ~14 facets, ~6/12 pitch, ridge_lf>0 AND valley_lf>0. Shape gate enforced; topology blocked when shape fails; `customer_report_ready=false` unless `assertCustomerReportReady` passes.
- **Montelluna** and **Palm Harbor** secondary baselines.
- **Test cases A–F** from the rewire spec:
  - A. Worker offline → control plane completes, compute blocked, no `roof_measurements` row.
  - B. Worker online, only `clip_point_cloud` implemented → clip completes, downstream `needs_implementation`, no `roof_measurements` row.
  - C. DEM-only property → blocks at `acquire_roof_surface_asset`, no `roof_measurements` row.
  - D. Missing `GOOGLE_MAPS_API_KEY` → blocks at `geocode_address`, no stale data.
  - E. Wrong `request_hash` callback → HTTP 409, artifact rejected.
  - F. Full success → 25 skills complete, bridge writes one `roof_measurements` row with full provenance.
- Route provenance audit: `created_by_function`, `solver_entrypoint`, `canonical_measurement_route`, `route_audit_version` populated. `debug-measurement-runtime` resolves all 5 questions for the new row.

---

## Plan deltas (from `.lovable/plan.md`)

1. **Do not create a new `start-measurement-pipeline` edge function.** Route `POST /pipeline/start` is added to existing `measurement-api`. Frontend call becomes `edgeApi("measurement-api", "/pipeline/start", ...)`.
2. **Mirror `measurement_jobs`** alongside `mskill_jobs` so existing `useMeasurementJob` polling and downstream UI keep working without simultaneous frontend rewrite.
3. **Bridge writes provenance + result-state normalization.** Bridge call path extracts `assertCustomerReportReady` from `start-ai-measurement` into `_shared/customer-report-ready.ts` so both legacy and new path share the gate.
4. **Worker offline → `paused`, never `failed`.** Already covered.
5. **Audit complete before any code rewire.** This file is the gate.

---

*Generated 2026-06-04. Updates to this file are required when measurement entry points, mskill registry order, or bridge artifact contracts change.*
