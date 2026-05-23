
## Live audit result (Fonsica, latest row 2026-05-22)

Queried `roof_measurements` directly. The most recent Fonsica row is already on the canonical route:

| Field | Value | Status |
|---|---|---|
| `canonical_measurement_route` | `true` | ✅ |
| `created_by_function` | `start-ai-measurement` | ✅ |
| `created_by_component` | `PullMeasurementsButton/useMeasurementJob` | ✅ |
| `solver_entrypoint` | `_shared/autonomous-graph-solver.solveAutonomousGraph` | ✅ |
| `route_audit_version` | `measurement-route-audit-v1` | ✅ |
| `geometry_report_json.route_provenance` | populated | ✅ |
| `geometry_report_json.phase3C.version` | `v1` | ✅ |
| `geometry_report_json.phase3D.version` | `v1` | ✅ |
| `geometry_report_json.phase3E.version` | `v1` | ✅ |
| `geometry_report_json.phase3_5.version` | **NULL** | ❌ |
| `hard_fail_reason` (column) | **NULL** while `result_state=ai_failed_perimeter` | ❌ |
| `report_renderer_version` | **NULL** | ❌ |

Older Fonsica rows (May 14) predate the fence and remain `canonical=false` with null provenance — that's historical, not a current bug. Legacy functions `measure`, `measure-roof`, `analyze-roof-aerial` already spread `LEGACY_*_PROVENANCE` on every `roof_measurements` insert/update, so the fence is in place going forward.

So we don't need to re-wire the whole canonical route — just close 3 concrete gaps and re-run.

## Gap 1 — `phase3_5` block alias

`withPhase3Visibility` (start-ai-measurement/index.ts:437) emits `phase3A_5` only. Audit/contract requires `phase3_5`. The debug endpoint already falls back (`phase3_5 ?? phase3A_5`), but the live row has only `phase3A_5`, which is why `phase3_5.version` is null.

Fix: in `withPhase3Visibility`, also emit `phase3_5: buildPhase3A5Block(payload)` (alias of `phase3A_5`). Apply the same alias in the two other places that build the autonomous debug object (lines ~3101 and ~6166 already emit both; line 437 is the only branch that doesn't). Result: every canonical row, success or failure, carries both `phase3_5` and `phase3A_5`.

## Gap 2 — `hard_fail_reason` DB column on failure rows

`insertFailedPreliminaryMeasurement` writes `geometry_report_json.hard_fail_reason` but does not set the top-level `roof_measurements.hard_fail_reason` column on the insert. Latest Fonsica row proves it: `result_state=ai_failed_perimeter`, `hard_fail_reason=null`.

Fix: add `hard_fail_reason: persistedFailureReason` and `block_customer_report_reason: persistedFailureReason` to the column set inside `insertFailedPreliminaryMeasurement` (start-ai-measurement/index.ts ~line 8050+). Use the existing `persistedFailureReason` value already computed at line 8052.

## Gap 3 — `report_renderer_version` stamp

No write path currently sets the `report_renderer_version` column. Audit requires it so we can tell which renderer produced the report/diagram on each row.

Fix:
- Add a constant `CANONICAL_REPORT_RENDERER_VERSION = "measurement-report-renderer-v1"` in start-ai-measurement and include it in `getCanonicalRouteDbColumns()` so every canonical insert/update carries it.
- Add `report_renderer_version: "legacy-<fn-name>-v0"` to each legacy provenance constant (`LEGACY_MEASURE_PROVENANCE`, `LEGACY_MEASURE_ROOF_PROVENANCE`, `LEGACY_ANALYZE_PROVENANCE`) so legacy rows are distinguishable from canonical ones.

## Gap 4 — debug endpoint surface

`debug-measurement-runtime/index.ts` already returns `created_by_function`, `solver_entrypoint`, `canonical_measurement_route`, `route_audit_version`, `route_provenance`, `phase3_5` (with `phase3A_5` fallback), `phase3C`, `phase3D`, `phase3E`. Add three small fields to the summary so a single call answers "is each phase executed, skipped, or missing, and which renderer ran":
- `report_renderer_version`
- `hard_fail_reason`
- `phase_status: { phase3_5, phase3C, phase3D, phase3E }` where each is `"executed" | "skipped" | "missing"` derived from `executed` / `skipped_reason` / null block

## Gap 5 — rerun Fonsica and verify

After Gaps 1–4 ship:
1. Hit `debug-measurement-runtime?address=fonsica&limit=5` and confirm the existing canonical row already shows `phase3_5` via the fallback and the new `report_renderer_version`/`hard_fail_reason` columns surface.
2. Trigger a fresh Fonsica measurement via PullMeasurementsButton.
3. Re-query. Expect on the new row:
   - `canonical_measurement_route=true`, full `route_provenance`
   - `phase3_5.version=v1`, `phase3C.version=v1`, `phase3D.version=v1`, `phase3E.version=v1` (no nulls)
   - `report_renderer_version` populated
   - On failure: `hard_fail_reason` is stage-specific (`perimeter_refinement_failed`, `backbone_not_applied`, or `topology_undersegmented_after_backbone_repair`) on **both** the column and `geometry_report_json`.

## Files to change

- `supabase/functions/start-ai-measurement/index.ts`
  - `withPhase3Visibility` → also emit `phase3_5`
  - `insertFailedPreliminaryMeasurement` → set `hard_fail_reason`/`block_customer_report_reason` columns
  - Add `CANONICAL_REPORT_RENDERER_VERSION` to canonical provenance / DB columns
- `supabase/functions/measure/index.ts`, `measure-roof/index.ts`, `analyze-roof-aerial/index.ts`
  - Add `report_renderer_version` to each `LEGACY_*_PROVENANCE` constant
- `supabase/functions/debug-measurement-runtime/index.ts`
  - Surface `report_renderer_version`, `hard_fail_reason`, and a derived `phase_status` map

## Out of scope

- Not touching the autonomous solver, perimeter refiner, or backbone repair logic — the audit is a visibility/provenance contract, not a geometry fix.
- Not back-filling old rows; legacy fence is forward-only by design.
- Not removing the legacy functions yet — the fence + report_renderer_version stamp is enough to make every row attributable.
