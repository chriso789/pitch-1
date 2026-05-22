# Fonsica Rerun — 2026-05-22

**Lead:** `0a38230e-57ad-4f22-9caa-ac7707a6962f` (4063 FONSICA AVE, NORTH PORT, FL)
**ai_measurement_jobs.id:** `b593277c-5c64-4910-b4f5-03f12445d03b`
**roof_measurements.id:** `461a32bb-7e2f-4a2b-aafe-f45db64ba973`
**Started:** 13:49:41 UTC · **Completed:** 13:53:55 UTC (~4 min)

## Checklist results

| Check | Result |
|---|---|
| `canonical_measurement_route = true` | ✅ |
| `created_by_function = 'start-ai-measurement'` | ✅ |
| `route_audit_version = 'measurement-route-audit-v1'` | ✅ |
| `phase3` version block populated | ✅ (3A/3B/3C/3D/3E/3F/3G all v1) |
| Phase 3A executed | ✅ `phase3A_active=true`, 6 perimeter edges classified `eave` via `hip_roof_default` |
| Phase 3B executed | ✅ counts-only, 6 eaves persisted (`persistence_deferred_reason=phase3B_lite_counts_only_v1`) |
| Phase 3C executed-or-skipped reason | ✅ `executed=false`, `skipped_reason=connectivity_pruning_callsite_not_reached` |
| Phase 3D executed-or-skipped reason | ✅ `executed=false`, `skipped_reason=backbone_seed_not_inserted_before_face_extraction` |
| Phase 3E executed-or-skipped reason | ✅ `executed=false`, `skipped_reason=constraint_solver_repair_not_called` |
| Stage-correct failure | ⚠️ `result_state=ai_failed_perimeter`, `block_customer_report_reason=perimeter_shape_not_accurate` |
| `hard_fail_reason` populated | ❌ NULL on both `roof_measurements` and `ai_measurement_jobs` |
| `phase3_5` refinement block present | ❌ NULL (refinement diagnostics live under `phase3A.eave_rake_*` only) |

## Findings & fixes

1. **`hard_fail_reason` not lifted to top-level columns.** The Phase 3A.5 refinement failure path put `hard_fail_reason` into `geometry_report_json` and into `ai_detection_data.debug`, but the `failurePayload` insert into `roof_measurements` and the `ai_measurement_jobs.update(...)` both omitted the top-level column. **Fixed** in `start-ai-measurement/index.ts`:
   - Added `hard_fail_reason: persistedFailureReason` to `failurePayload` (line ~8222).
   - Added `hard_fail_reason: failReason` to the `ai_measurement_jobs` update on the Phase 3A.5 fail branch (line ~2918).
2. **`phase3_5` block missing under that key.** Refinement diagnostics are nested under `phase3A_5` / `refinement_diagnostics`, not `phase3_5`. The `debug-measurement-runtime` reader looks at `phase3_5` first then `phase3A_5` (already handled) — fine.
3. **Other failure branches** (developer-bug, autonomous-fail, legacy) write `hard_fail_reason` to the column directly — only the Phase 3A.5 refinement-fail path was missing it.

## Verification on next rerun

After deploy, a fresh failed-perimeter run should show:
```
SELECT id, result_state, hard_fail_reason, block_customer_report_reason
FROM roof_measurements WHERE id=<new>;
-- hard_fail_reason: perimeter_shape_not_accurate (or refinement_*)
```

## Out-of-scope follow-ups (deferred)

- Track 2 (legacy provenance stamps on `generate-roof-report`, `ai-measurement`).
- Track 3 (~14 remaining upload surfaces with `{tenantId}/...` prefix + `safeStorageUpload`).
- Track 4 (move real route logic into `supplier-api` / `signature-api` / `measurement-api` routers).

These are scoped in `.lovable/plan.md` and ready to pick up in a follow-up turn.
