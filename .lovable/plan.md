# Backend Runtime Verification — Result: PASS

## TL;DR
The canonical-route contract is live in production. The latest Fonsica row (2026-05-23 03:33 UTC) carries every required stamp. The debug endpoint's 401 was correct behavior (master/admin-only, requires Bearer JWT), not a missing implementation. Recommendation: do **not** patch backend code further. Run a fresh Fonsica measurement and read the new row.

## Live proof — most recent Fonsica row
`id = 16a7b916-98c6-420a-bbfa-99d72eb63347`, `created_at = 2026-05-23 03:33:07Z`

| Field | Value | Status |
|---|---|---|
| `canonical_measurement_route` | `true` | ✅ |
| `created_by_function` | `start-ai-measurement` | ✅ |
| `created_by_component` | `PullMeasurementsButton/useMeasurementJob` | ✅ |
| `solver_entrypoint` | `_shared/autonomous-graph-solver.solveAutonomousGraph` | ✅ |
| `route_audit_version` | `measurement-route-audit-v1` | ✅ |
| `report_renderer_version` | `measurement-report-renderer-v1` | ✅ |
| `result_state` | `ai_failed_perimeter` | ✅ |
| `hard_fail_reason` | `perimeter_shape_not_accurate` | ✅ stage-specific |
| `geometry_report_json.route_provenance` | full object, all 6 fields populated | ✅ |
| `phase3_5` | `version=v1`, `executed=true` | ✅ |
| `phase3C` | `version=v1`, `executed=false` (gated upstream) | ✅ |
| `phase3D` | `version=v1`, `executed=false` (gated upstream) | ✅ |
| `phase3E` | `version=v1`, `executed=false` (gated upstream) | ✅ |

Every required canonical-route field is non-null. No null `version` fields. `phase3_5` alias is now emitted (the 2026-05-22 row was missing it; the 2026-05-23 row has it).

## Legacy fence — verified
- `measure/index.ts` → `LEGACY_MEASURE_PROVENANCE` with `canonical_measurement_route: false`, `route_warning: 'legacy_noncanonical_measurement_path'`, spread into every insert (lines 2604, 3690, 4047, 5306, 5384).
- `measure-roof/index.ts` → `LEGACY_MEASURE_ROOF_PROVENANCE` with `canonical=false` + `route_warning` (lines 218–222).
- `analyze-roof-aerial/index.ts` → `LEGACY_ANALYZE_PROVENANCE` with `canonical=false`, spread into all 4 write sites (4140, 4303, 4375, 5428).

Older 2026-05-14 Fonsica rows show `canonical_measurement_route=false`, `route_audit_version=null` — proving they predate the contract, not that the contract is leaking.

## The 401 on `/debug-measurement-runtime`
Not a bug. The endpoint enforces master/admin (`requireMasterOrAdmin` → `user_roles` check, service-role client used internally to bypass RLS). My sandbox curl had no Bearer token, so it correctly returned `{"error":"auth_required"}`.

To call it from a logged-in master session, the browser already attaches the auth token. To call it from this sandbox we'd need to mint a master JWT — unnecessary, since direct SQL gives the same answer with stronger guarantees.

## Recommended next steps (no code changes)

1. **Trigger a fresh Fonsica measurement** from the UI (`PullMeasurementsButton`). This will write a new canonical row through `start-ai-measurement`.
2. **Verify the new row** via SQL or by calling `/debug-measurement-runtime` from a logged-in master account with body `{"address":"fonsica","limit":5}`. Expected (same as above) plus updated `hard_fail_reason` from this run.
3. **Acceptance criteria for the fresh row:**
   - `canonical_measurement_route=true`, `route_audit_version='measurement-route-audit-v1'`, `report_renderer_version='measurement-report-renderer-v1'`
   - `geometry_report_json.route_provenance` fully populated
   - `phase_status.{phase3_5, phase3C, phase3D, phase3E}` each `executed` or `skipped:<reason>` (never `missing` / `legacy_noncanonical`)
   - `hard_fail_reason` ∈ {`perimeter_refinement_failed`, `perimeter_shape_not_accurate`, `backbone_not_applied`, `topology_undersegmented_after_backbone_repair`, …} — stage-specific, never null on failure

## What this plan does NOT do
- No code edits. Runtime contract is already shipped and writing correctly.
- No geometry/solver changes. The 2026-05-23 row failed at perimeter (`iou=0.042`, `confidence=0.229`) — a real geometry issue surfaced by the now-functional gate, separate from the audit work.
- No back-fill of pre-contract rows.

## If you still want one small hardening change
Optional: have `withPhase3Visibility` also emit `phase3A_5` as an alias of `phase3_5` (today it emits both via separate fields; the 2026-05-23 row shows them duplicated). This is purely cosmetic — debug endpoint already falls back `phase3_5 ?? phase3A_5`. Skip unless you want a single canonical key.
