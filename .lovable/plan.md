
## Goal

Stop planning. Prove what is actually wired in the canonical measurement route, fill the documented runtime gaps (debug endpoint, legacy fencing, DB columns, hard-fail names), and produce a route-audit response we can cite before re-running Fonsica.

## 1. Repo audit (output as `docs/measurement-runtime-audit.md`)

For each module, exists / exports / imported-by / active-in-canonical-route:

| Module | Exists | Imported by `start-ai-measurement/index.ts` | Notes |
|---|---|---|---|
| `_shared/autonomous-graph-solver.ts` (`solveAutonomousGraph`) | yes | yes — called L2956 | active |
| `_shared/perimeter-refinement.ts` (`refineTrueOuterRoofPerimeter`) | yes | yes — called L2822 inside Phase 3A.5 block | active |
| `_shared/deferred-structural-edges.ts` | yes | via `autonomous-graph-solver` only | active inside solver |
| `_shared/backbone-seed.ts` (`SeedBackboneResult`) | yes | via solver L2415–2446 | active |
| `_shared/backbone-network.ts` (`buildBackboneNetwork`) | yes | via solver L2389 | active |
| `_shared/constraint-roof-solver.ts` | yes | yes | active |
| `_shared/constraint-solver-repair.ts` (`attemptRepairPass`) | yes | via `constraint-roof-solver` L1691 | active |
| `_shared/roof-lines.ts` (`buildRoofLine`, `aggregateLineTotalsByAttribute`) | yes | yes — L41 | active |
| `_shared/result-state.ts` | yes | yes | active |
| `debug-measurement-runtime` function | **NO** | n/a | **must create** |
| `render-measurement-pdf` | yes | n/a (separate render path) | confirm `report_renderer_version` stamp |

Legacy fences currently stamped:
- `measure` ✅, `analyze-roof-aerial` ✅
- `measure-roof`, `generate-roof-overlay`, `generate-roof-report`, `calculate-roof-measurements`, `ai-measurement`, `ai-measurement-analyzer`, `auto-generate-measurements`, `recalculate-measurement-from-overrides` — **need fencing review** (no `canonical_measurement_route=false` stamp found).

## 2. Database migration

`roof_measurements` already has `canonical_measurement_route`, `created_by_function`, `created_by_component`, `solver_entrypoint`, `route_audit_version`, `report_renderer_version`, `block_customer_report_reason`. Missing:

- Add `hard_fail_reason TEXT` (currently only `last_failure_reason`/`last_failure_stage`).
- Backfill index: `CREATE INDEX IF NOT EXISTS roof_measurements_canonical_route_idx ON roof_measurements (canonical_measurement_route, created_at DESC);`
- Confirm `roof_lines` table exists (read currently returns it). If not present, create with `roof_measurement_id`, `attribute`, `length_ft`, `pitch`, `geometry_geo`, `source_phase`, `confidence`, RLS by `tenant_id`.

(Single migration, requires user approval.)

## 3. `start-ai-measurement` — close the route-stamp gaps

Already done: route_provenance + CANONICAL_ROUTE_PROVENANCE written on success path (L440) and one failure path (L6536). Pending:

- Audit every `insert/upsert` into `roof_measurements` / `ai_measurement_jobs` / `measurement_jobs` in `start-ai-measurement/index.ts` and ensure each spreads `CANONICAL_ROUTE_PROVENANCE` + sets the 5 columns BEFORE early returns. Estimated 6–8 additional insert sites in the 8 308-line file.
- Ensure `geometry_report_json` always includes the four phase blocks (`phase3_5`, `phase3C`, `phase3D`, `phase3E`) even on early failure. Builders exist (`buildPhase3A5Block` etc.) but are only invoked in `assembleGeometryReport`. Wrap early-failure inserts to call the same assembler with `{executed:false, skipped_reason}`.
- Map new hard-fail names: `perimeter_refinement_failed`, `backbone_not_applied`, `topology_undersegmented_after_backbone_repair` → extend `result-state.ts` `normalizeResultStateForWrite` and write to new `hard_fail_reason` column.

## 4. Phase wiring gaps to actually close

3A.5 — already called (L2822) but verify:
- Gate thresholds (`refinement_iou < 0.88`, `perimeter_to_target_mask_ratio > 1.10`, `refined_confidence < 0.85`) → emit `ai_failed_perimeter` + skip topology + set 3C/3D/3E `skipped_reason='blocked_by_perimeter_refinement'`.
- Replace topology-input perimeter with `refined_perimeter_px` when passing.

3C — solver already defers; ensure `phase3C` diagnostics expose `connectivity_edges_deferred`, `connectivity_edges_deleted_pre_refinement`, `deferred_structural_candidates_count`, `deferred_edges_used_for_refinement`, `deferred_edge_table` to the report block. Acceptance check: Fonsica row must not show `edges_removed_before_face_build=13` with empty deferred list.

3D — backbone seed inserted; need explicit `locked=true` propagation through planar pruning and persist `seed_backbone_edges_survived` + the "pre-solve chains existed but final ridge_lf+valley_lf=0 → `backbone_not_applied`" hard rule.

3E — repair pass exists; surface `repaired_ridge_chains_inserted`, `repaired_valley_chains_inserted`, `repair_iterations`, `repair_accepted`, `final_rejection_reason`. Hard fail with `topology_undersegmented_after_backbone_repair` when no candidate survives post-repair.

## 5. Legacy fencing sweep

Add the 3-line stamp to every legacy function that touches `roof_measurements`:
```
created_by_function: "<name>"
canonical_measurement_route: false
geometry_report_json.route_warning: "legacy_noncanonical_measurement_path"
```
Targets: `measure-roof`, `generate-roof-overlay` (only if it writes), `generate-roof-report` (only if it writes), `calculate-roof-measurements`, `ai-measurement`, `ai-measurement-analyzer`, `auto-generate-measurements`, `batch-regenerate-measurements`, `batch-remeasure`, `recalculate-measurement-from-overrides`, `trace-roof`. For read-only ones, skip.

## 6. Create `debug-measurement-runtime` edge function

New `supabase/functions/debug-measurement-runtime/index.ts`. POST `{ lead_id? , contact_id?, address? }`. Returns latest N `roof_measurements` rows joined with `ai_measurement_jobs`:

```json
{
  "rows": [{
    "id", "created_at",
    "created_by_function","canonical_measurement_route","solver_entrypoint",
    "route_audit_version","report_renderer_version",
    "result_state","hard_fail_reason","block_customer_report_reason",
    "route_provenance":     <geometry_report_json.route_provenance>,
    "phase3_5":             <geometry_report_json.phase3_5>,
    "phase3C":              <geometry_report_json.phase3C>,
    "phase3D":              <geometry_report_json.phase3D>,
    "phase3E":              <geometry_report_json.phase3E>
  }]
}
```
Service-role read, master/admin-only via `auth-api`'s `requireMasterOrAdmin`. CORS, validate input with Zod.

## 7. Validation packet before Fonsica rerun

Write `docs/fonsica-rerun-prereqs.md` containing:
1. Migration timestamp + columns added.
2. `debug-measurement-runtime` curl response for Fonsica's lead (canonical row count, phase versions).
3. `start-ai-measurement` deploy timestamp.
4. Verification snippet showing failure-path inserts include phase blocks.
Then rerun Fonsica and capture the expected fields listed in the user's section 10.

## Out of scope

- No new solver math. No new UI. No work on non-measurement domains. No edge-function consolidation in this pass.

## Technical notes

- File is 8 308 lines; insert-site sweep uses `rg -n "from\\('roof_measurements'\\)\\.(insert|upsert|update)"` to enumerate write sites.
- `result-state.ts` normalizer is the only DB-safe gate for new buckets per project memory; do not widen the CHECK constraint.
- All multi-tenant queries in `debug-measurement-runtime` must `.eq('tenant_id', effectiveTenantId)` per Core memory.

## Deliverables

1. `docs/measurement-runtime-audit.md` (section 1 table, filled in with real line numbers).
2. One migration: add `hard_fail_reason`, optional `roof_lines` table, route index.
3. Edits to `start-ai-measurement/index.ts`: phase-block emission on all failure paths + write `hard_fail_reason`.
4. Edits to `_shared/result-state.ts`: map new hard-fail names.
5. Legacy-fence edits across the ~10 functions listed.
6. New `supabase/functions/debug-measurement-runtime/index.ts`.
7. `docs/fonsica-rerun-prereqs.md` populated after deploy.
