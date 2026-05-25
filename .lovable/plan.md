## Scope

Six tightly scoped fixes on top of the now-working persistence-contract slice. No geometry gate changes, no schema migration, no architectural rework. Canonical route stays `start-ai-measurement`.

---

## Backend changes (`supabase/functions/start-ai-measurement/index.ts` + `_shared/pre-topology-debug-bag.ts`)

### 1. CPU preemption threshold (fire before exhaustion)

In the pre-Phase-3A.5 preempt check:

- Compute `effective_budget_ms = cpu_budget_ms - cpu_terminal_write_reserve_ms` (e.g. 75000 − 15000 = 60000).
- Preempt when `elapsed_ms >= effective_budget_ms`, regardless of whether `estimated_work_units` is known.
- If `estimated_work_units` is 0/unavailable, fall back purely to wall-clock reserve check (do not skip preempt because work units are missing).
- Record `cpu_budget_preempt_reason = 'wall_clock_reserve_threshold'` and ensure heavy Phase 3A.5/topology calls are not invoked after threshold.

Acceptance: `cpu_budget_elapsed_ms < cpu_budget_ms` and ideally `<= effective_budget_ms + small_tolerance`.

### 2. Persist raw perimeter into phase3_5 + debug_layers before preempt write

In `buildPreTopologyDebugBag` (or the preempt writer that consumes it), when `perimeter_topology.perimeter_ring_px` exists:

```
geometry_report_json.phase3_5.raw_perimeter_px = perimeter_topology.perimeter_ring_px;
geometry_report_json.debug_layers.raw_perimeter_px = perimeter_topology.perimeter_ring_px;
geometry_report_json.debug_layers.selected_perimeter_px = perimeter_topology.perimeter_ring_px;
```

If refined perimeter is absent at preempt time:

```
geometry_report_json.phase3_5.refined_perimeter_missing_reason =
  'refinement_not_reached_before_cpu_preempt';
```

No new fields outside `geometry_report_json` — stays within current persistence contract.

### 3. Derive `px` on debug_roof_lines from `perimeter_topology.eave_edges`

When building `debug_roof_lines`, if the source edge carries `start_px`/`end_px`, populate:

```
px: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]
```

Keep `geo`, `length_ft`, and flags as today. Enforce on every entry:

- `debug_only: true`
- `customer_ready: false`
- `candidate_source: 'phase3A'`
- `validation_status: 'candidate_only'`
- `reason_not_reportable: 'runtime_preempted_before_validated_topology'`

### 4. Nested `dsm_split_status` contract (additive)

Keep existing flat fields untouched. Add nested shape alongside:

```
dsm_split_status.fetch_decode = {
  status: dsm_loaded && mask_loaded && raster_loaded ? 'pass' : 'fail',
  stage: 'dsm_fetch_decode',
  dsm_loaded, mask_loaded, raster_loaded, dsm_size_px,
};
dsm_split_status.georegistration_transform = {
  status: hasAllTransforms ? 'pass' : (dsm_loaded ? 'fail' : 'warning'),
  stage: 'dsm_georeg_transform',
  dsm_tile_bounds_lat_lng_present,
  geo_to_dsm_transform_present,
  dsm_to_raster_transform_present,
  dsm_pixel_transform_valid,
};
```

For current Fonsica state: `fetch_decode.status='pass'`, `georegistration_transform.status='fail'`.

---

## Frontend changes

### 5. Diagnostic resolver — target confirmation (`src/lib/measurements/measurementDiagnosticState.ts`)

Add a `target_confirmation_passed` derivation that returns true when ANY of:

- `user_confirmed_roof_target === true`
- `geometry_report_json.confirmed_roof_center_px` exists
- `geometry_report_json.static_map_center_lat_lng` exists AND run progressed past source acquisition (any of `dsm_loaded`, `mask_loaded`, `footprint_valid`, or a non-source-acquisition `failure_stage`)
- `footprint_valid === true`

For runtime CPU failures (`hard_fail_reason === 'ai_measurement_cpu_timeout'`), the resolver must not surface "roof target not confirmed" as the blocker.

### 6. Visual QA overlay fallback (`AIMeasurement3DDebugViewer.tsx`)

Render order:

1. `geometry_report_json.phase3_5.refined_perimeter_px` (existing)
2. `geometry_report_json.phase3_5.raw_perimeter_px` (new fallback)
3. `geometry_report_json.perimeter_topology.perimeter_ring_px` (last-resort fallback)

Only show "Visual QA overlay unavailable" if all three are missing AND no `overlay_debug.raster_url` exists.

### 7. Debug vs reportable roof line counts (`AIMeasurement3DDebugViewer.tsx` + `MeasurementReportDialog.tsx`)

- Replace single "Roof Lines Count" chip with two labelled chips: **Debug Roof Lines** (from `debug_roof_lines.length`) and **Reportable Roof Lines** (from `roof_lines_count`).
- Customer-report gating logic stays driven by `roof_lines_count` / `customer_report_ready`. Debug count never feeds the report-ready signal.

---

## Tests (added before deploy; deploy only after green)

Backend (Deno) — under `supabase/functions/start-ai-measurement/__tests__/`:

- `cpu-preempt-threshold.test.ts` — given `cpu_budget_ms=75000`, `cpu_terminal_write_reserve_ms=15000`, `elapsed=60000`, preempt fires; assert `elapsed_ms < cpu_budget_ms` and heavy Phase 3A.5 entrypoint not invoked.
- `raw-perimeter-persistence.test.ts` — given `perimeter_topology.perimeter_ring_px` present and no refined perimeter, assert all three persisted paths populated and `refined_perimeter_missing_reason` set.
- `debug-roof-lines-px-derivation.test.ts` — given eave edges with `start_px`/`end_px`, every emitted debug line has non-null `px` and required debug flags.
- `dsm-split-status-nested-contract.test.ts` — given DSM loaded, transforms missing: `fetch_decode.status='pass'`, `georegistration_transform.status='fail'`; flat fields preserved.

Frontend (Vitest):

- `measurementDiagnosticState.test.ts` — runtime CPU failure with valid footprint/center → `target_confirmation_passed === true`; blocker is not "target not confirmed".
- Viewer test — given only `perimeter_topology.perimeter_ring_px`, raw perimeter overlay renders; "Visual QA overlay unavailable" not shown.
- Viewer test — `debug_roof_lines.length=6`, `roof_lines_count=0` → both chips render with distinct labels; customer report remains blocked.

---

## Guardrails (unchanged)

- No geometry gate relaxation, no vendor benchmark threshold changes.
- No DB schema migration; all new fields live inside `geometry_report_json`.
- No new preflight/source/timeout architecture.
- No customer report generation; `customer_report_ready` stays false.
- Canonical route remains `start-ai-measurement`.

## Post-deploy verification (Fonsica rerun from lead UI only)

After tests pass and `start-ai-measurement` redeploys:

- No `23514` / DB constraint errors.
- `cpu_budget_elapsed_ms < cpu_budget_ms`.
- Visual overlay renders from raw perimeter fallback.
- Debug roof lines carry `px`.
- `dsm_split_status` has nested `fetch_decode` + `georegistration_transform`.
- Target-confirmation banner does not appear for runtime CPU failure.
- `customer_report_ready === false`.
