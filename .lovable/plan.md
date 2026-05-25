Implement one scoped diagnostic-contract cleanup for the AI Measurement runtime/perimeter failure, without loosening geometry gates or producing a customer report.

## Scope and guardrails

- No timeout/preflight chasing and no geometry gate relaxation.
- No database schema migration expected; new diagnostic artifacts stay in `geometry_report_json` / `source_context` JSON.
- Preserve the canonical route: `start-ai-measurement` only.
- Fonsica must remain non-customer-ready until real validated roof lines/facets/topology exist.
- Deploy only after targeted regression tests pass, then rerun Fonsica from the lead UI only.

## Relevant contract rules being enforced

- Do-no-harm perimeter gate: persist `raw_perimeter_area_sqft`, `refined_perimeter_area_sqft`, `target_mask_area_sqft`, `benchmark_area_sqft`, `raw_to_refined_area_ratio`, `raw_to_refined_iou`, `perimeter_vs_target_mask_iou`, and fallback/rejection flags. If raw is within 15% of benchmark/target and refined/raw area ratio is `< 0.85`, reject destructive refinement and prefer raw fallback only if `raw_iou_vs_target >= 0.80`.
- Visual QA invariant: failed or blocked topology must render an aerial-backed perimeter/debug overlay, never a blank or geometry-only customer-style report.
- Required diagnostics: `route_provenance`, `phase3_5`, `phase3C`, `phase3D`, `phase3E` must exist with `version` and either `executed=true` or explicit `skipped_reason`.
- Customer report gate: no `customer_report_ready=true` unless validated roof lines/facets/pitch/topology exist.

## Files to update

### Frontend diagnostic truth

- `src/lib/measurements/measurementDiagnosticState.ts`
  - Extend resolved diagnostic state with final failure stage and stage routing hints.
  - Preserve target confirmation pass while runtime CPU failure points active UI to Phase 3A.5.
- `src/components/measurements/AIMeasurement3DDebugViewer.tsx`
  - Resolve initial/active stage from final resolved failure, not from `stages[0]`.
  - Split current “Raster tile / DSM” into separate DSM fetch/decode and DSM georegistration/transform status.
  - Make final diagram fail/debug-only when `roof_lines_count=0` and `facet_count=0`.
  - Read debug-only eave/rake/perimeter layers from new persisted JSON fields.
- `src/components/measurements/MeasurementReportDialog.tsx`
  - Ensure blocked runtime/perimeter rows render debug overlay if raw perimeter/mask/layer data exists, even if `refined_perimeter_px` is absent.
  - Keep failed rows visually marked as internal diagnostic only.

### Edge function diagnostic persistence

- `supabase/functions/start-ai-measurement/index.ts`
  - Add a small debug-layer builder before Phase 3A.5/refinement/topology that captures cheap, already-available artifacts.
  - Persist those layers through all failure paths, especially `persistCpuBudgetTerminalFailure()`.
  - Preempt topology/refinement before heavy work when estimated work exceeds pixel limit or projected remaining budget.
  - Persist Phase 3A eave/rake candidate lines as debug-only layers, not customer-ready `roof_lines`.
  - Split DSM loaded/decode status from DSM georegistration/transform status in persisted diagnostics.
  - Guard final diagram status so it cannot pass with zero final roof lines and zero facets.

## Overlay layer contract


| Layer                       | Style                  | Backend field(s)                                                             | Toggle                    | Missing behavior                   |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| Aerial raster               | image background       | `overlay_debug.raster_url`, `satellite_overlay_url`                          | `raster`                  | “No raster tile available” banner  |
| Raw perimeter               | gray stroke            | `phase3_5.raw_perimeter_px`, `debug_layers.raw_perimeter_px`, `footprint_px` | `perimeter`               | “raw perimeter not persisted”      |
| Refined perimeter           | green stroke           | `phase3_5.refined_perimeter_px`                                              | `perimeter`               | label “refinement not reached”     |
| Selected perimeter          | blue stroke            | `selected_perimeter_px`, `true_outer_roof_perimeter_px`                      | `perimeter`               | “selected perimeter not persisted” |
| Target roof mask            | translucent green fill | `target_roof_mask_px`, `target_mask_contour_px`, `target_mask_bbox_px`       | `targetMask`              | bbox fallback, else missing note   |
| Global mask                 | dashed gray            | `global_mask_px`, `global_visible_roof_bbox_px`                              | `globalMask`              | bbox fallback, else missing note   |
| Missed regions              | orange fill/dash       | `missed_roof_regions_px`, `missed_target_roof_regions_px`                    | `missed`                  | missing note                       |
| Solar segments              | blue/purple outlines   | `solar_segments[].polygon_px`, simplified segment px                         | `solar`                   | count only + missing note          |
| Eaves                       | green lines            | `debug_roof_lines.eave`, `phase3A.eave_edges_px`                             | `eaves`                   | show candidate length if no pixels |
| Rakes                       | purple dashed lines    | `debug_roof_lines.rake`, `phase3A.rake_edges_px`                             | `rakes`                   | show candidate length if no pixels |
| Ridge/hip/valley candidates | red/orange/cyan        | `roof_lines`, `deferred_structural_candidates`                               | `ridges/hips/valleys`     | not persisted note                 |
| Component centroids/bboxes  | small markers/boxes    | `mask_components_table`, `selected_component_id`                             | existing debug layer area | not persisted note                 |


## JSON fields to persist/read

Required debug JSON fields:

- `geometry_report_json.final_state_source`
- `geometry_report_json.failure_stage`
- `geometry_report_json.hard_fail_reason`
- `geometry_report_json.cpu_budget_*`
- `geometry_report_json.phase3_5.version/executed/skipped_reason`
- `geometry_report_json.phase3_5.raw_perimeter_px`
- `geometry_report_json.phase3_5.refined_perimeter_px` when available, otherwise explicit missing/refinement-not-reached reason
- `geometry_report_json.phase3_5.debug_perimeter_overlay_svg` or equivalent aerial overlay URL/data
- `geometry_report_json.debug_layers.target_roof_mask_px` or contour/bbox
- `geometry_report_json.debug_layers.global_mask_px` or contour/bbox
- `geometry_report_json.debug_layers.selected_perimeter_px`
- `geometry_report_json.debug_layers.mask_components_table`
- `geometry_report_json.debug_layers.solar_segments_px`
- `geometry_report_json.debug_roof_lines` with `debug_only=true`, `candidate_source='phase3A'`, line type, points, length
- `geometry_report_json.dsm_status.fetch_decode`
- `geometry_report_json.dsm_status.georegistration_transform`
- `geometry_report_json.registration.transform_package_valid`

Optional JSON fields:

- `target_mask_bbox_px`, `global_visible_roof_bbox_px`, `selected_component_id`, `target_mask_centroid_px`, `component_centroids_px`
- `visual_edge_alignment_score`, `aerial_edge_support_pct`, `dsm_boundary_support_pct`, `corner_snap_confidence`, `shape_failure_reasons`, `visual_review_gate`

## DSM status split

Replace the single UI pass/fail meaning with:

- DSM fetch/decode: pass when `dsm_loaded=true` and `dsm_size_px` exists.
- DSM georegistration/transform: fail/warn when any of `dsm_tile_bounds_lat_lng`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, or `dsm_pixel_transform_valid` are missing/false.
- Coordinate registration gate: fail when `selected_candidate_polygon_px` missing or transform package invalid.

## CPU preemption behavior

Before calling heavy refinement/topology:

```text
if estimated_work_units >= topology_pixel_limit
or projected runtime > cpuBudget - terminalWriteReserve
  persist debug layers first
  write terminal ai_failed_runtime
  hard_fail_reason = ai_measurement_cpu_timeout
  failure_stage = phase3_5_topology_cpu_budget_exceeded
  cpu_budget_preempt_reason = estimated_topology_workload_exceeds_cpu_budget
  do not call heavy topology
```

Acceptance: preemptive failures must record `cpu_budget_elapsed_ms < cpu_budget_ms`, not 96s elapsed on a 75s budget.

## Regression tests to add/update

### Frontend tests

- `src/lib/measurements/measurementDiagnosticState.test.ts`
  - Runtime CPU failure resolves to final runtime failure and exposes Phase 3A.5 stage hint.
  - Target confirmation remains pass when confirmed center exists.
  - DSM loaded remains true while transform/georegistration is invalid.
- Add or extend a viewer test under `src/components/measurements/__tests__/AIMeasurement3DDebugViewer.runtime-stage.test.tsx`
  - Given `final_state_source=runtime_cpu_budget_guard` and `failure_stage=phase3_5_topology_cpu_budget_exceeded`, active stage is Phase 3A.5 / Perimeter topology, not Target confirmation.
  - Given `roof_lines_count=0` and `facet_count=0`, final diagram cannot show pass.
  - Given debug layers but no `refined_perimeter_px`, overlay still renders raw perimeter/target mask/eave candidates.

### Edge function tests

- `supabase/functions/start-ai-measurement/__tests__/runtime-cpu-preemption-diagnostics.test.ts`
  - `estimated_work_units > topology_pixel_limit` preempts before heavy topology.
  - Writes `ai_failed_runtime`, `ai_measurement_cpu_timeout`, `phase3_5_topology_cpu_budget_exceeded`.
  - Persists selected perimeter, target mask, debug eave/rake candidate lines.
  - Elapsed budget remains under configured budget in the preempt path.
- `supabase/functions/start-ai-measurement/__tests__/dsm-status-split.test.ts`
  - `dsm_loaded=true` + `dsm_size_px` + null bounds/transform means fetch/decode pass, transform fail/warn, diagnostic-only.
- `supabase/functions/start-ai-measurement/__tests__/phase3a-debug-lines.test.ts`
  - `perimeter_edge_classification_table` produces debug-only eave/rake polylines and lengths.
  - Debug lines do not count as customer-ready roof lines.

### Assertions mapped to hard rules

- Fonsica perimeter rule: area pass alone never passes shape; `shape_validation` and edge-support metrics present when applicable.
- Route provenance: `created_by_function='start-ai-measurement'`, `canonical_measurement_route=true`.
- State: `result_state` non-null and normalized; specific failure stays in `hard_fail_reason`.
- Diagram: rejected/runtime diagnostic row renders overlay, not blank and not customer-ready.
- Customer gate: `customer_report_ready=false` unless final reportable geometry exists.

## Acceptance thresholds

- Fonsica vendor baseline: area 3077 sqft, expected complex hip, about 14 facets, pitch about 6/12.
- Vendor gate remains: facets within 25%, pitch within 1/12, ridge/hip/valley within 25%, topology score >= 80 before customer-ready.
- Perimeter do-no-harm: reject refined/raw area ratio `< 0.85` when raw is within 15% of benchmark/target.
- Raw fallback only if `raw_iou_vs_target >= 0.80` and raw area delta within 15%.

## Database/schema plan

- DB fields required: none new. Stable columns already exist for `result_state`, `hard_fail_reason`, `failure_stage`, `customer_report_ready`, and route provenance.
- JSON-only fields: all new debug pixel layers, DSM split status, CPU preemption details, and debug-only roof line candidates.
- Migration needed: no.
- Safe write changes: update `insertFailedPreliminaryMeasurement()` and CPU failure persistence to preserve optional debug fields inside `geometry_report_json`; do not add new columns.
- Schema verification SQL if needed:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('roof_measurements','ai_measurement_jobs','measurement_jobs')
ORDER BY table_name, ordinal_position;
```

## Test and deploy sequence

1. Run targeted frontend tests for diagnostic resolver/viewer.
2. Run targeted Deno edge tests for `start-ai-measurement` and shared result-state/registration utilities.
3. Deploy `start-ai-measurement` only after green tests.
4. Rerun Fonsica from the lead UI only.
5. Pull fresh `job_id` and `measurement_id` and verify:
  - `result_state` matches on job and measurement.
  - Runtime failure points active viewer stage to Phase 3A.5.
  - DSM fetch/decode and transform/georegistration are separated.
  - Pixel/debug overlay layers are present before CPU preemption.
  - Final diagram is debug/fail, not pass, with zero final geometry.
  - `customer_report_ready=false`.

Used the roof-measurement-vision-qa, measurement-overlay-visual-qa, ai-measurement-regression-harness, and supabase-schema-db-drift-guard skills.  
  
My read: **approve this plan, but tighten it in 3 places before Codex/Lovable implements it.**

## What’s good

The plan correctly focuses on the real current blocker:

- not more preflight chasing
- not more timeout guessing
- no customer report until real roof geometry exists
- debug artifacts stay in JSON, no schema migration
- visual overlay must render even on failure
- CPU preemption happens before the expensive topology path
- DSM status gets split into “loaded” vs “georegistered”
- Phase 3A eave/rake lines get persisted as **debug-only**, not customer-ready roof lines

That is the right direction. The plan states Fonsica must remain non-customer-ready until validated roof lines/facets/topology exist.

## The 3 changes I would require

### 1. Add a hard “no blank viewer” acceptance rule

The plan says visual QA should render an aerial-backed overlay, but make it stricter:

```

```

```
If aerial raster exists and any one of raw perimeter, selected perimeter, target mask bbox, global mask bbox, mask components, or debug roof lines exists, the viewer must render an overlay.

Blank viewer is only allowed when raster_url is missing AND no geometry/debug layer exists.
```

Right now the system keeps saying “overlay unavailable” even when it has enough data to draw **something**.

### 2. Make `debug_roof_lines` the bridge to the final diagram viewer

The plan says persist Phase 3A eave/rake candidate lines as debug-only layers. Good. But the viewer also needs to know those are **not final measurements**.

Add:

```

```

```
debug_roof_lines must include:
- debug_only: true
- customer_ready: false
- candidate_source: phase3A
- validation_status: candidate_only
- reason_not_reportable
```

That prevents the UI from showing 225.9 LF eaves like it is a final customer measurement.

### 3. CPU preemption must happen before Phase 3A.5, not inside it

The plan says before heavy refinement/topology, but Codex may still place the guard too late. Require the guard at the exact callsite.

Add:

```

```

```
The estimator/preemption guard must run immediately before the first Phase 3A.5/refinement/topology call. If it triggers, no Phase 3A.5 heavy function may be invoked.
```

Acceptance should check:

```

```

```
phase3_5.executed = false
phase3_5.skipped_reason = estimated_topology_workload_exceeds_cpu_budget
failure_stage = phase3_5_topology_cpu_budget_exceeded
cpu_budget_elapsed_ms < cpu_budget_ms
```

## Send this back to Lovable/Codex

```

```

```
Approved direction. Implement this as one scoped diagnostic-contract cleanup.

Before implementation, add these three hard requirements:

1. No blank viewer rule
If aerial raster exists and any one of raw perimeter, selected perimeter, target mask bbox, global mask bbox, mask components, or debug roof lines exists, the viewer must render an overlay. Blank viewer is only allowed when raster_url is missing AND no geometry/debug layer exists.

2. Debug roof lines must be explicitly non-customer-ready
debug_roof_lines must include:
- debug_only: true
- customer_ready: false
- candidate_source: phase3A
- validation_status: candidate_only
- reason_not_reportable

These lines may appear in the internal viewer but must not count as final roof_lines or customer measurements.

3. CPU preemption must run before the first heavy Phase 3A.5/refinement/topology call
If estimated_work_units >= topology_pixel_limit or projected runtime exceeds cpuBudget - terminalWriteReserve:
- persist debug layers first
- do not call heavy topology/refinement
- write ai_failed_runtime
- hard_fail_reason = ai_measurement_cpu_timeout
- failure_stage = phase3_5_topology_cpu_budget_exceeded
- phase3_5.executed = false
- phase3_5.skipped_reason = estimated_topology_workload_exceeds_cpu_budget
- cpu_budget_elapsed_ms < cpu_budget_ms

Do not loosen gates. Do not produce a customer report. Do not add schema migrations. Keep all new artifacts in geometry_report_json/source_context JSON.
```

My blunt opinion: this is the **first plan that is actually scoped correctly**. Let it run, but don’t let Lovable turn it into another “also fix geometry” pass. This pass is purely to make the system tell the truth and show the debug layers.