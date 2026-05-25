## Scope (edge-function-only slice)

Backend changes confined to `supabase/functions/start-ai-measurement/index.ts` plus new Deno tests under `supabase/functions/start-ai-measurement/__tests__/`.

No schema migration. No frontend changes. No relaxation of any geometry gate. No new preflight / no new timeout wrapper.

---

## 1. New helper: `buildPreTopologyDebugBag(...)`

Add a single pure helper near the existing CPU-budget helpers (~line 13020):

```ts
function buildPreTopologyDebugBag(args: {
  stage: "phase3_5_perimeter_refinement" | "autonomous_topology_solver" | "pre_phase3_5_preempt";
  dsmGrid: any; maskedDSM: any; roofMask: any; raster: any;
  perimeterPhase0Snapshot: any;
  perimeterTopologySnapshot: any;
  targetMaskIsolation: any;
  footprintSource: string | null;
  footprintGeo: [number, number][] | null;
  footprintPx: [number, number][] | null;
  registrationPreflight: any;
}): Record<string, unknown>
```

Returns a single object containing:

- `dsm_split_status`: `{ dsm_loaded, masked_dsm_loaded, mask_loaded, raster_loaded, dsm_size_px, masked_dsm_size_px, raster_size_px, dsm_resolution_mpp }` — booleans + sizes, never throws on null inputs.
- `perimeter_phase0` (already computed upstream — passed through).
- `perimeter_topology` (already computed upstream — passed through).
- `target_mask_isolation` minus the heavy `target_mask_grid` field.
- `footprint_source`, `footprint_point_count`, `footprint_px` (sliced first 256 pts for cost), `footprint_valid: boolean`.
- `debug_roof_lines`: array built from `perimeter_topology.eave_edges + rake_edges` (if present) typed as `[{ type, geo: [[lng,lat],[lng,lat]], px: [[x,y],[x,y]], debug_only: true, customer_ready: false }]`. Empty array when perimeter not yet built. Capped at 512 lines.
- `debug_layers_persisted_at_stage: stage`.

The bag is intentionally cheap — no DSM raster pixels, no mask grid, no aerialRgba.

---

## 2. Add pre-Phase-3A.5 preempt checkpoint

Right before the existing Phase 3A.5 budget check at line ~6500, run a second `shouldPreemptForCpuBudget(input, 0)` call with stage `pre_phase3_5_preempt`. Today's check at 6500 already uses estimated work units; the new check guarantees that if we are *already* under reserve before estimating, we exit with the cheap debug layers persisted.

If preempted:
- Call `persistCpuBudgetTerminalFailure({ ..., stage: "pre_phase3_5_preempt", debug: buildPreTopologyDebugBag(...) })`.
- Return immediately.

---

## 3. Wire debug bag into both existing CPU-budget call sites

Replace the inline ad-hoc `debug:` object at:

- Line ~6512 (Phase 3A.5 preempt) — use `buildPreTopologyDebugBag({ stage: "phase3_5_perimeter_refinement", ... })`.
- Line ~6978 (autonomous topology preempt) — use `buildPreTopologyDebugBag({ stage: "autonomous_topology_solver", ... })` plus merge in `phase3A_5: phase3A5Diagnostics`.

Both retain the existing extra fields (DSM size, perimeter snapshots) — the helper produces a superset.

---

## 4. Extend `persistCpuBudgetTerminalFailure` debug payload

In the function body (~line 13067), after the `...args.debug` spread, lift the four keys the slice requires to top level so `insertFailedPreliminaryMeasurement` writes them onto `geometry_report_json`:

- `dsm_split_status`
- `debug_roof_lines`
- `debug_layers_persisted_at_stage`
- `target_mask_isolation`

Also explicitly set `customer_report_ready: false`, `customer_ready: false`, and ensure `roof_lines_count: 0` (the count of *typed customer* roof lines, not debug lines).

---

## 5. Extend `insertFailedPreliminaryMeasurement` geometry_report_json

In the `geometryReportJson` builder (~line 14537), add three pass-through fields from `debug`:

```ts
dsm_split_status: debug?.dsm_split_status ?? null,
debug_roof_lines: Array.isArray(debug?.debug_roof_lines) ? debug.debug_roof_lines : [],
debug_layers_persisted_at_stage: debug?.debug_layers_persisted_at_stage ?? null,
```

Each `debug_roof_lines` entry is guaranteed to carry `debug_only: true` and `customer_ready: false`. Failure rows therefore always have either zero or N debug-flagged lines and never customer-flagged ones.

---

## 6. Final-diagram zero-geometry safety gate (success path)

In the success-path write at line ~11961, immediately before the `.insert(...)` call, add:

```ts
const _facetCountFinal = planeRows.length;
const _roofLinesCountFinal = edgeRows.length;
if (_facetCountFinal === 0 && _roofLinesCountFinal === 0) {
  // Force-rejected — no geometry to show a customer.
  (failurePayload as any).customer_report_ready = false;
  (failurePayload as any).internal_debug_report_ready = true;
  (failurePayload as any).diagram_render_intent = "debug_only";
  (failurePayload as any).result_state = normalizeResultStateForWrite(
    "ai_failed_runtime",
    (failurePayload as any),
  );
  (failurePayload as any).block_customer_report_reason =
    "zero_geometry_final_diagram_guard";
  (failurePayload as any).hard_fail_reason ??= "zero_geometry_final_diagram_guard";
  (geometryReportJson as any).customer_report_ready = false;
  (geometryReportJson as any).diagram_render_intent = "debug_only";
  (geometryReportJson as any).block_customer_report_reason =
    "zero_geometry_final_diagram_guard";
}
```

This is a defensive gate — if any upstream change ever lets the success path land with zero plane rows and zero edge rows, the row will not present as a customer report.

---

## 7. Regression tests (new files, all Deno)

Under `supabase/functions/start-ai-measurement/__tests__/`:

1. `pre-topology-debug-bag.test.ts` — unit test for `buildPreTopologyDebugBag`:
   - returns `dsm_split_status` with correct booleans for `{ dsm: null, mask: null }`, `{ dsm: present, mask: null }`, `{ dsm + mask + raster }`.
   - `debug_roof_lines` empty when `perimeter_topology` is null.
   - `debug_roof_lines` populated and every entry has `debug_only===true && customer_ready===false` when perimeter edges present.
   - omits `target_mask_isolation.target_mask_grid` (memory hygiene).

2. `cpu-budget-debug-payload.test.ts` — call `persistCpuBudgetTerminalFailure` with a mocked `supabase` and asserts the inserted row carries `dsm_split_status`, `debug_roof_lines`, `debug_layers_persisted_at_stage` on `geometry_report_json`, and `customer_report_ready === false`.

3. `zero-geometry-final-diagram-gate.test.ts` — feed the success-path builder a synthetic payload with `planeRows=[]` and `edgeRows=[]`. Assert `customer_report_ready === false`, `diagram_render_intent === "debug_only"`, `result_state` normalized, and `block_customer_report_reason === "zero_geometry_final_diagram_guard"`.

Tests use only what's already imported. No new dependencies. Mocks supabase via a minimal shim object.

---

## 8. Deploy + Fonsica rerun

1. Run new tests via `supabase--test_edge_functions` — must be green.
2. If green, deploy `start-ai-measurement` via `supabase--deploy_edge_functions`.
3. User reruns Fonsica from the lead UI; we read `geometry_report_json` to confirm `dsm_split_status`, `debug_roof_lines[]`, `debug_layers_persisted_at_stage` are populated on whichever failure stage hits.

---

## Out of scope (explicit)

- No `roof_measurements` / `ai_measurement_jobs` schema migration.
- No customer-report-ready promotion logic changes.
- No relaxation of perimeter / topology / vendor-benchmark / footprint-sanity gates.
- No new preflight stage. No timeout wrapper rewrite.
- No frontend touch (slice 1 diagnostic truth changes remain).