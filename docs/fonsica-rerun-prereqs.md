# Fonsica rerun prerequisites

Checklist to satisfy section 10 of the user's prompt *before* re-running the
Fonsica measurement. All items must be ✅ before triggering the run.

## 1. Migration applied

- ✅ `ALTER TABLE roof_measurements ADD COLUMN hard_fail_reason TEXT;`
- ✅ `ALTER TABLE ai_measurement_jobs ADD COLUMN hard_fail_reason TEXT;`
- ✅ `ALTER TABLE measurement_jobs ADD COLUMN hard_fail_reason TEXT;`
- ✅ `CREATE INDEX roof_measurements_canonical_route_idx (canonical_measurement_route, created_at DESC)`
- ✅ `CREATE INDEX roof_measurements_lead_route_idx (lead_id, created_at DESC) WHERE lead_id IS NOT NULL`

Migration timestamp: see `supabase/migrations/` (run 2026-05-22).

## 2. Route audit endpoint live

`debug-measurement-runtime` deployed. Call as master/admin user:

```bash
curl -X POST \
  -H "Authorization: Bearer $MASTER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"<fonsica-lead-id>"}' \
  https://alxelfrbjzkmtnsulcei.functions.supabase.co/debug-measurement-runtime
```

Expected for a freshly-rerun Fonsica row:

```jsonc
{
  "counts": { "canonical": >=1 },
  "rows": [{
    "created_by_function": "start-ai-measurement",
    "canonical_measurement_route": true,
    "solver_entrypoint": "_shared/autonomous-graph-solver.solveAutonomousGraph",
    "route_audit_version": "measurement-route-audit-v1",
    "route_provenance": { /* populated */ },
    "phase3_5": { "version": "v1", "executed": true | false, "skipped_reason": null | "..." },
    "phase3C":  { "version": "v1", "executed": true | false },
    "phase3D":  { "version": "v1", "executed": true | false },
    "phase3E":  { "version": "v1", "executed": true | false }
  }]
}
```

Acceptance: every phase block has `version: "v1"` and either
`executed: true` or a non-null `skipped_reason`. No `null` phase blocks
on a canonical row.

## 3. start-ai-measurement deploy

Triggered automatically by the platform when the function file changes.
Verify deploy timestamp via Supabase Functions dashboard before rerun.

## 4. Phase blocks on failure paths

`assembleGeometryReport` (start-ai-measurement L432) is the only assembler
of `geometry_report_json` used by `insertRoofMeasurementWithSchemaGuard`.
All four phase blocks are produced unconditionally and any phase that did
not run carries `executed: false` + a `skipped_reason` token from
`{not_reached, blocked_by_perimeter_refinement, repair_conditions_not_met,
seed_backbone_not_available, …}`.

## 5. Expected next Fonsica row

| Field | Expected |
|---|---|
| `canonical_measurement_route` | `true` |
| `created_by_function` | `start-ai-measurement` |
| `route_provenance` | populated (5-key object) |
| `phase3_5.version` | `"v1"` |
| `phase3C.version` | `"v1"` |
| `phase3D.version` | `"v1"` |
| `phase3E.version` | `"v1"` |
| `result_state` | one of the 10 canonical buckets |
| `hard_fail_reason` | stage-correct token, e.g. `perimeter_refinement_failed`, `backbone_not_applied`, `topology_undersegmented_after_backbone_repair` (NOT `invalid_roof_footprint:2_facets_for_3250sqft` anymore — that token is now mapped through `result-state.ts` to `ai_failed_topology`) |

If any of these are missing, the rerun is invalid and we do not have
backend proof yet.
