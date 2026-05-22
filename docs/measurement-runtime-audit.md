# Measurement Runtime Audit

Generated as part of the Phase 3 backend-proof pass. Source of truth for what
is actually wired into the canonical AI measurement route
(`start-ai-measurement`) vs. what only exists as a docs/plan file.

Audit method: ripgrep against `supabase/functions/**` for import + call sites,
cross-checked against the runtime call graph in
`supabase/functions/start-ai-measurement/index.ts`.

## 1. Module-by-module status

| Module | Exists | Exports used | Imported by canonical route | Active at runtime |
|---|---|---|---|---|
| `supabase/functions/start-ai-measurement/index.ts` | ✅ | `Deno.serve` handler, `CANONICAL_ROUTE_PROVENANCE`, `buildPhase3A5Block`, `buildPhase3CBlock`, `buildPhase3DBlock`, `buildPhase3EBlock` | n/a (this IS the canonical route) | ✅ |
| `supabase/functions/_shared/autonomous-graph-solver.ts` | ✅ | `solveAutonomousGraph`, `detectComplexRoof`, `analyzeTopologyFidelity` | ✅ (start-ai-measurement L38) | ✅ called L2956 |
| `supabase/functions/_shared/perimeter-refinement.ts` | ✅ | `refineTrueOuterRoofPerimeter`, `PerimeterRefinementResult` | ✅ (start-ai-measurement L37) | ✅ called L2822 |
| `supabase/functions/_shared/deferred-structural-edges.ts` | ✅ | deferred-edge helpers | indirect — used inside `autonomous-graph-solver.ts` | ✅ |
| `supabase/functions/_shared/backbone-seed.ts` | ✅ | `SeedBackboneResult`, `markBackboneInserted` | indirect — used inside `autonomous-graph-solver.ts` L2415–2446 | ✅ |
| `supabase/functions/_shared/backbone-network.ts` | ✅ | `buildBackboneNetwork`, `BackboneDiagnostics` | indirect — used inside `autonomous-graph-solver.ts` L2389 | ✅ |
| `supabase/functions/_shared/constraint-roof-solver.ts` | ✅ | constraint-solver entrypoints | ✅ | ✅ |
| `supabase/functions/_shared/constraint-solver-repair.ts` | ✅ | `attemptRepairPass`, `RepairDiagnostics`, `RepairCandidate` | indirect — used inside `constraint-roof-solver.ts` L1691 | ✅ |
| `supabase/functions/_shared/roof-lines.ts` | ✅ | `buildRoofLine`, `aggregateLineTotalsByAttribute`, `totalsHaveTypedBacking` | ✅ (start-ai-measurement L41) | ✅ |
| `supabase/functions/_shared/result-state.ts` | ✅ | `normalizeResultStateForWrite`, `deriveDiagramRenderIntent` | ✅ | ✅ — already maps Phase 3A.5/3D/3E hard-fail tokens |
| `supabase/functions/debug-measurement-runtime/index.ts` | ✅ *(new)* | `Deno.serve` | n/a | ✅ — master/admin-only route audit |
| `supabase/functions/render-measurement-pdf/index.ts` | ✅ | PDF renderer | n/a (separate render path) | does not write `roof_measurements` |

## 2. Canonical route stamping

DB columns on `roof_measurements` confirmed present:

- `created_by_function`
- `created_by_component`
- `solver_entrypoint`
- `canonical_measurement_route`
- `route_audit_version`
- `report_renderer_version`
- `block_customer_report_reason`
- `hard_fail_reason` *(added in migration `2026-05-22`)*

`start-ai-measurement` writes via the single chokepoint
`insertRoofMeasurementWithSchemaGuard` (L530) and
`updateRoofMeasurementWithSchemaGuard` (L545). Both go through
`prepareRoofMeasurementPayload`, which retains the
`CANONICAL_ROUTE_PROVENANCE` columns and persists `route_provenance` +
phase blocks inside `geometry_report_json`.

Phase block builders (always invoked from `assembleGeometryReport` L432):

- `buildPhase3ABlock` — perimeter classification metrics
- `buildPhase3A5Block` — perimeter refinement (`phase3_5`)
- `buildPhase3BBlock` — typed roof_lines roll-up
- `buildPhase3CBlock` — deferred structural edges
- `buildPhase3DBlock` — locked backbone seed
- `buildPhase3EBlock` — constraint solver repair

Each builder emits `{ version: 'v1', executed: bool, skipped_reason: …, …phase-specific metrics }` so a freshly-created row always shows
either `executed: true` with diagnostics or `executed: false` with a
machine-readable `skipped_reason`.

## 3. Legacy fencing

Non-canonical functions that write `roof_measurements` are now all stamped
with `canonical_measurement_route: false` + `route_warning:
"legacy_noncanonical_measurement_path"`:

| Function | Stamped | Notes |
|---|---|---|
| `measure` | ✅ | `LEGACY_MEASURE_PROVENANCE` spread on all 5 insert sites |
| `measure-roof` | ✅ *(added)* | `LEGACY_MEASURE_ROOF_PROVENANCE`, also injects `route_warning` into `geometry_report_json` |
| `analyze-roof-aerial` | ✅ | existing |
| `generate-roof-report` | n/a — only updates `report_pdf_url` on existing rows |
| `recalculate-measurement-from-overrides` | n/a — sanctioned override-recalc path (Patent Rule 5); does NOT flip canonical flag |

Other measurement-adjacent functions (`ai-measurement`,
`ai-measurement-analyzer`, `auto-generate-measurements`,
`batch-regenerate-measurements`, `batch-remeasure`, `calculate-roof-measurements`,
`trace-roof`) currently contain **no** `roof_measurements` write sites
(`grep -c "from('roof_measurements')\\.\\(insert\\|upsert\\|update\\)" = 0`).
They either dispatch into `start-ai-measurement` or operate on derived
tables only.

## 4. Route audit endpoint

`POST /functions/v1/debug-measurement-runtime` (master/admin only):

```jsonc
// request
{ "lead_id": "<uuid>" }            // or contact_id / measurement_id / address
```

```jsonc
// response (truncated)
{
  "audit_response_version": "debug-measurement-runtime-v1",
  "counts": { "total": 4, "canonical": 2, "legacy": 1, "unstamped": 1 },
  "rows": [{
    "id": "...",
    "created_at": "...",
    "created_by_function": "start-ai-measurement",
    "canonical_measurement_route": true,
    "solver_entrypoint": "_shared/autonomous-graph-solver.solveAutonomousGraph",
    "route_audit_version": "measurement-route-audit-v1",
    "result_state": "ai_failed_topology",
    "hard_fail_reason": "topology_undersegmented_after_backbone_repair",
    "route_provenance": { ... },
    "phase3_5": { "version": "v1", "executed": true, "refinement_iou": 0.91, ... },
    "phase3C":  { "version": "v1", "executed": true, "deferred_structural_candidates_count": 6, ... },
    "phase3D":  { "version": "v1", "executed": true, "seed_backbone_edges_inserted": 4, ... },
    "phase3E":  { "version": "v1", "executed": true, "repair_accepted": false, "final_rejection_reason": "..." }
  }],
  "ai_measurement_jobs": [ ... ]
}
```

Use this endpoint as proof-of-canonical before re-running Fonsica.
