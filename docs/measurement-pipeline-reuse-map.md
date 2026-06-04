# Measurement Pipeline Reuse Map (mskill orchestrator ← existing modules)

**Status:** APPROVED guardrails / NOT YET WIRED. The mskill pipeline is the future
orchestrator. It must **wrap** the existing measurement modules listed below as
skill executors. It must **not** duplicate them. `roof_measurements` remains the
final compatibility output, written by **exactly one** path: the mskill bridge
after `validate_geometry` + `export_geojson` + `export_report` complete.

This document is the contract that gates the AI Measurement button rewire.
The rewire ships only when every "wrap target" below has either:
  (a) been moved behind a skill executor, or
  (b) been explicitly marked legacy and prevented from writing final artifacts.

---

## 1. UI / Hook surfaces

| Existing surface                                      | Today                                                                   | After rewire (feature flag ON)                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/components/measurements/PullMeasurementsButton`  | Calls `useMeasurementJob.startJob` → legacy `start-ai-measurement`      | Same button, same hook — hook routes via feature flag                                                |
| `src/hooks/useMeasurementJob.ts`                      | Invokes `start-ai-measurement` edge function                            | If `USE_MSKILL_MEASUREMENT_PIPELINE=true` → `edgeApi('measurement-api','/pipeline/start',...)`       |
| `src/components/measurements/UnifiedMeasurementPanel` | Renders job state from `measurement_jobs`                               | Adds `<MeasurementPipelineStatus mskill_job_id=...>` alongside existing panels (additive, not replacement) |
| `MeasurementReportDialog`                             | Final report viewer for `roof_measurements`                             | UNCHANGED. Remains final viewer. mskill bridge populates the same `roof_measurements` row it reads.  |
| `MeasurementVisualQAOverlay`                          | Renders perimeter / DSM diagnostics                                     | UNCHANGED. Extended to display skill artifacts from `mskill_artifacts` when present.                 |

---

## 2. Edge function surfaces

| Legacy function                          | Status after rewire                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `start-ai-measurement` (`index.ts`)      | Becomes a thin shim that forwards to `measurement-api POST /pipeline/start` (forwards JWT). `?legacy=1` keeps legacy body. |
| `start-ai-measurement/index.legacy.ts`   | Preserved verbatim. Reachable only via `?legacy=1`. Tagged `canonical_measurement_route=false`, `route_warning='legacy_noncanonical_measurement_path'`. |
| `measure-roof`                           | Not rewired. Marked legacy. MUST NOT write final `roof_measurements` rows when flag ON — conflict test (T-4) enforces. |
| `measure`                                | Module folder (autonomous-graph-solver, dsm-*, segment-topology, etc.) — files imported by skill executors below. Function entry remains accessible for diagnostics only. |
| `analyze-roof-aerial`                    | Stays available. Wrapped by `acquire_roof_surface_asset` / `create_roof_edge_candidates` where applicable.       |
| `render-measurement-pdf`                 | Becomes the renderer **invoked by** the `export_report` skill executor. Direct frontend invocations remain (legacy PDF view), but the canonical render path runs through `export_report`. |
| `recalculate-measurement-from-overrides` | Untouched. Override-validated path still allowed to flip `customer_report_ready`.                                 |
| `debug-measurement-runtime`              | Extended to answer "which path produced this row" using `canonical_measurement_route` + new `mskill_job_id` link. |

---

## 3. Shared module reuse map (`supabase/functions/_shared/*`)

Each existing helper is reused by **exactly one** skill executor (or one
explicit reuse group). The "owner skill" column is the contract: that skill is
the only mskill executor allowed to call the helper as part of the canonical
pipeline. Helpers MAY still be called from the legacy path while the feature
flag is OFF.

| Existing module                                    | Owner skill (mskill executor)                          | Output artifact                       | Status when flag ON     |
| -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- | ----------------------- |
| `perimeter-refinement.ts`                          | `create_roof_edge_candidates`                          | `refined_perimeter_geojson`           | wrapped                 |
| `perimeter-topology.ts`                            | `create_roof_edge_candidates` + `validate_geometry`    | `perimeter_topology_diagnostics`      | wrapped                 |
| `constrained-perimeter-solver.ts`                  | `create_roof_edge_candidates`                          | `constrained_perimeter_solution`      | wrapped                 |
| `dsm-derived-bounds-runtime.ts`                    | `generate_dsm` + `acquire_roof_surface_asset` QA       | `dsm_bounds_metadata`                 | wrapped                 |
| `dsm-registration.ts` / `early-dsm-registration.ts`/ `source-registration-transform.ts` | `generate_dsm` (registration step), gated by `registration-gate.ts` | `dsm_registration_report` | wrapped |
| `registration-gate.ts`                             | `validate_geometry` (publish gate)                     | `registration_gate_result`            | wrapped — single gate   |
| `registration-precedence.ts` / `registration-stage-classifier.ts` | `generate_dsm`                          | (internal)                            | wrapped                 |
| `dsm-edge-detector.ts`                             | `isolate_roof_points` + `detect_ridges`                | `dsm_edge_features`                   | wrapped                 |
| `dsm-analyzer.ts` / `dsm-utils.ts`                 | shared util — called by `generate_dsm`, `generate_dtm`, `generate_chm` | (internal)            | wrapped                 |
| `dsm-geometry-contract.ts`                         | `validate_geometry` (six-contract gate)                | `geometry_contract_report`            | wrapped — single gate   |
| `dsm-diagnostic-propagation.ts`                    | `validate_geometry`                                    | `dsm_diagnostics_bundle`              | wrapped                 |
| `image-ridge-detector.ts`                          | `detect_ridges`                                        | `image_ridge_candidates`              | wrapped                 |
| `ridge-detector.ts`                                | `detect_ridges`                                        | `ridge_candidates`                    | wrapped                 |
| `ridge-clustering.ts`                              | `detect_ridges`                                        | `ridge_clusters`                      | wrapped                 |
| `ridge-cluster-region-split.ts`                    | `detect_ridges` + `detect_valleys`                     | `ridge_region_splits`                 | wrapped                 |
| `ridge-filter-and-plane-consolidate.ts`            | `fit_roof_planes`                                      | `consolidated_planes`                 | wrapped                 |
| `ridge-aligned-plane-merge.ts`                     | `fit_roof_planes`                                      | `merged_planes`                       | wrapped                 |
| `ridge-plane-splitter.ts`                          | `fit_roof_planes`                                      | `split_planes`                        | wrapped                 |
| `straight-skeleton.ts` (in `measure/`)             | `fit_roof_planes` + `detect_hips`                      | `skeleton_topology`                   | wrapped                 |
| `segment-topology-analyzer.ts`                     | `detect_hips` + `detect_valleys` (diagnostic only — NOT customer-report path per `mem://constraints/heuristic-geometry-production-gate`) | `segment_topology_report` | diagnostic-only |
| `autonomous-graph-solver.ts`                       | `fit_roof_planes` (primary solver wrap)                | `autonomous_graph_result`             | wrapped                 |
| `gable-detector.ts`                                | `detect_rakes` + Phase 3A eave/rake classifier         | `gable_apex_detections`               | wrapped                 |
| `facet-splitter.ts`                                | `fit_roof_planes` (post-pass)                          | `facet_split_result`                  | wrapped                 |
| `overlay-evaluator.ts`                             | `validate_geometry` (registration RMS/IoU)             | `overlay_evaluation`                  | wrapped                 |
| `qa-validator.ts` (in `measure/`)                  | `validate_geometry`                                    | `qa_report`                           | wrapped                 |
| `result-state.ts` (`normalizeResultStateForWrite`) | every executor that writes `result_state`              | (none — gate)                         | single normalizer       |
| `diagram-render-intent.ts`                         | `export_report`                                        | `diagram_render_intent`               | wrapped                 |
| `roof-diagram-renderer.ts`                         | `export_report`                                        | `roof_diagram_svg`                    | wrapped                 |

`assertCustomerReportReady` (or equivalent guard) MUST be the only function
allowed to flip `customer_report_ready=true`, regardless of path.

---

## 4. Provider/source pull reuse (geocode → parcel → footprint → lidar → DEM/DSM → roof surface)

Already separated as mskill executors; no legacy duplicates. See
`mskill_provider_sources`, executors `geocode_address`, `resolve_parcel`,
`resolve_building_footprint`, `discover_lidar_coverage`,
`discover_elevation_assets`, `acquire_dem_dtm`, `acquire_roof_surface_asset`.
Provider inventory dashboard at `/admin/providers/inventory`.

---

## 5. Single-writer rule (HARD)

A final `roof_measurements` row can be written by **exactly one** of these paths:

1. **Legacy** — only when explicitly opted into with `?legacy=1` AND the row is
   stamped `canonical_measurement_route=false` and
   `geometry_report_json.route_warning='legacy_noncanonical_measurement_path'`.
2. **mskill bridge** — `bridgeSkillReportToRoofMeasurements(...)` after
   `validate_geometry`, `export_geojson`, `export_report` all `completed`
   with their required artifacts. Stamps `canonical_measurement_route=true`,
   `created_by_function='measurement-api/pipeline/start'`,
   `solver_entrypoint='mskill'`, `mskill_job_id=...`.
3. **Override path** — `recalculate-measurement-from-overrides` (existing) for
   manually validated rows. Stamps `validation_source='override'`.

Any other code path writing to `roof_measurements` is a regression. Enforced by
the conflict test suite (see §7).

---

## 6. Feature flag

| Flag                                    | Default | Where read                                       | Effect                                                                                  |
| --------------------------------------- | ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `USE_MSKILL_MEASUREMENT_PIPELINE`       | `false` | `src/lib/measurementPipelineFlag.ts` (frontend), `_shared/mskill/feature-flag.ts` (edge) | ON: `useMeasurementJob` → mskill pipeline. OFF: legacy `start-ai-measurement`.          |
| Query string `?legacy=1`                | —       | `start-ai-measurement` router                    | Forces legacy code path regardless of flag. Debug-only. Stamps `route_warning`.         |

Frontend flag source order: `localStorage('USE_MSKILL_MEASUREMENT_PIPELINE')`
→ `window.__MSKILL_PIPELINE__` → `import.meta.env.VITE_USE_MSKILL_MEASUREMENT_PIPELINE`
→ default `false`. Backend reads `Deno.env.get('USE_MSKILL_MEASUREMENT_PIPELINE')`.

---

## 7. Conflict tests (must pass before rewire ships)

Tracked in `supabase/functions/measurement-api/__tests__/pipeline-conflict.test.ts`
and `src/components/measurements/__tests__/pipeline-conflict.test.tsx`:

- **T-1**: `PullMeasurementsButton` never invokes both legacy + new in one click.
- **T-2**: `useMeasurementJob.startJob` never spawns two measurement jobs for one user action.
- **T-3**: With flag ON, `start-ai-measurement` direct POST (no `?legacy=1`) returns a shim 308/redirect-equivalent JSON envelope and does NOT call the legacy solver.
- **T-4**: `measure-roof` cannot insert/update `roof_measurements` rows that lack `canonical_measurement_route` or `mskill_job_id` when flag ON.
- **T-5**: `render-measurement-pdf` refuses to render a canonical row when `export_report` skill artifact is missing (returns 409 `export_report_missing`).
- **T-6**: Legacy helpers (`perimeter-refinement`, `ridge-clustering`, `dsm-derived-bounds-runtime`) MUST NOT write to `mskill_artifacts` outside a `mskill_runs` row.
- **T-7**: Fonsica / Montelluna / Palm Harbor regression rows (per `ai-measurement-regression-harness` skill) replay successfully against the new pipeline.

---

## 8. Rewire approval gate (do not ship until ALL checked)

- [ ] §3 reuse map merged and reviewed
- [ ] Feature flag scaffolding present (frontend + edge)
- [ ] Conflict tests T-1…T-7 added and passing in "flag OFF" mode (baseline)
- [ ] `measurement-api POST /pipeline/start` route added (orchestrator only, no new solver)
- [ ] `start-ai-measurement` shim added with `?legacy=1` escape hatch
- [ ] `useMeasurementJob` switches on flag
- [ ] `MeasurementPipelineStatus` component added
- [ ] Conflict tests T-1…T-7 re-run in "flag ON" mode — all green
- [ ] Fonsica replay green against new pipeline

Only after every box is checked does `USE_MSKILL_MEASUREMENT_PIPELINE` flip to
default `true`. Legacy code is **not deleted** at that point — it remains as
the `?legacy=1` debug path until a follow-up cleanup pass.
