# AI Measurement Route Audit + Canonicalization Plan

## Audit findings

The current Lovable workspace does contain the Phase 3 module files and some wiring, but the app still has multiple measurement/report paths. That matches the report symptom: one path can be patched while another path creates or renders the row that the user sees.

### Active frontend entry points


| Route/Component              | File                                                                                    | Purpose                                                                                           | Writes Measurement?                                       | Reads Measurement?                                       | Builds Diagram?                      | Uses Phase 3?                                                                  | Active?                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------- |
| AI Measurements button       | `src/components/measurements/PullMeasurementsButton.tsx`                                | Main lead/estimate button; opens StructureSelectionMap, then calls `useMeasurementJob.startJob()` | Indirectly via `start-ai-measurement`                     | Reads latest `roof_measurements` after job completion    | Seeds debug/verification wizard only | Yes, through `start-ai-measurement`                                            | Active                                    |
| Measurement job hook         | `src/hooks/useMeasurementJob.ts`                                                        | Canonical async start/poll hook                                                                   | Indirectly via `start-ai-measurement`                     | Reads `measurement_jobs`                                 | No                                   | Yes                                                                            | Active                                    |
| Unified measurement panel    | `src/components/measurements/UnifiedMeasurementPanel.tsx`                               | Lead-page history/results/report launcher                                                         | No                                                        | Reads `roof_measurements`, `measurement_jobs`, approvals | Inline schematic and report dialog   | Reads Phase 3 fields                                                           | Active                                    |
| Report dialog                | `src/components/measurements/MeasurementReportDialog.tsx`                               | Internal/customer report viewer and PDF launcher                                                  | Updates only through override/PDF actions                 | Reads provided row + diagrams                            | Yes                                  | Reads Phase 3 fields, but currently falls back to “not implemented” if missing | Active                                    |
| Legacy report preview        | `src/components/measurements/RoofrStyleReportPreview.tsx`                               | Older interactive Roofr-style report preview                                                      | Can call legacy `analyze-roof-aerial` for remeasure       | Reads `roof_measurements` by id/customer/address         | Yes, client-side                     | No canonical Phase 3                                                           | Legacy but still mounted behind old state |
| Material calculations page   | `src/pages/MaterialCalculations.tsx`                                                    | Materials from latest measurement                                                                 | No                                                        | Calls deprecated `measure` via `useLatestMeasurement()`  | Opens report dialog                  | No                                                                             | Active legacy read path                   |
| Legacy roof measurement tool | `src/components/roof-measurement/RoofMeasurementTool.tsx` + `src/pages/RoofMeasure.tsx` | Professional/legacy manual measurement page                                                       | Calls deprecated `measure` and `generate-roof-report`     | Local state + legacy rows                                | Yes                                  | No                                                                             | Active legacy route                       |
| `useMeasurement.ts` hooks    | `src/hooks/useMeasurement.ts`                                                           | Legacy measurement API wrapper                                                                    | Calls deprecated `measure` for pull/overlay/manual verify | Reads legacy `measurements` and `roof_measurements`      | No                                   | No                                                                             | Active import surface                     |
| `useRoofOverlay`             | `src/hooks/useRoofOverlay.ts`                                                           | Standalone overlay generator                                                                      | Calls `generate-roof-overlay`                             | No persisted canonical row                               | Overlay only                         | No                                                                             | Active in legacy tool                     |
| `useRoofLineOverlay`         | `src/hooks/useRoofLineOverlay.ts`                                                       | AI overlay/training helper                                                                        | Calls `generate-roof-line-overlay`                        | Reads/writes `roof_line_overlays`                        | Overlay only                         | No                                                                             | Active utility                            |


### Supabase edge functions that can affect measurement geometry/reporting


| Function                                 | File                                                                 | Purpose                                               | Creates `roof_measurements`                         | Updates `roof_measurements`       | Reads `geometry_report_json` | Renders diagrams                                                    | Calls autonomous solver                                                      | Phase 3 status                                                |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- | --------------------------------- | ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `start-ai-measurement`                   | `supabase/functions/start-ai-measurement/index.ts`                   | Canonical geometry-first pipeline                     | Yes                                                 | Yes                               | Yes                          | Inserts `ai_measurement_diagrams`, invokes `render-measurement-pdf` | Yes, `_shared/autonomous-graph-solver.ts`                                    | Partially wired; needs hard route stamps and DB column parity |
| `debug-measurement-runtime`              | `supabase/functions/debug-measurement-runtime/index.ts`              | Runtime stamp endpoint                                | No                                                  | No                                | No                           | No                                                                  | No                                                                           | Missing Phase 3 stamps                                        |
| `measure`                                | `supabase/functions/measure/index.ts`                                | Deprecated orchestrator but still invoked by frontend | Yes, multiple insert/update paths                   | Yes                               | Some                         | Calls visualization/overlay helpers                                 | Uses local `measure/autonomous-graph-solver.ts`, not shared canonical solver | Legacy/unwired                                                |
| `measure-roof`                           | `supabase/functions/measure-roof/index.ts`                           | Deprecated function                                   | Yes                                                 | No                                | No                           | No                                                                  | No                                                                           | Legacy/deprecated                                             |
| `analyze-roof-aerial`                    | `supabase/functions/analyze-roof-aerial/index.ts`                    | Vision/aerial analyzer                                | Yes                                                 | Yes                               | Limited                      | No                                                                  | No shared canonical solver                                                   | Legacy/unwired                                                |
| `generate-roof-overlay`                  | `supabase/functions/generate-roof-overlay/index.ts`                  | Two-pass overlay generator                            | No canonical measurement                            | No                                | No                           | Overlay JSON                                                        | Calls `analyze-roof-aerial`                                                  | Legacy/unwired                                                |
| `generate-roof-line-overlay`             | `supabase/functions/generate-roof-line-overlay/index.ts`             | Training/overlay line detector                        | No `roof_measurements`; writes `roof_line_overlays` | No                                | No                           | Overlay PNG/JSON                                                    | No                                                                           | Legacy helper, also uses `esm.sh` import                      |
| `generate-roof-report`                   | `supabase/functions/generate-roof-report/index.ts`                   | Old jsPDF PDF generator                               | No                                                  | Yes: report URL fields            | Reads measurement row        | Yes                                                                 | No                                                                           | Legacy/unwired                                                |
| `generate-roofr-style-report`            | `supabase/functions/generate-roofr-style-report/index.ts`            | Old Roofr-style report generator                      | No                                                  | Documents insert only             | Reads payload/legacy tags    | Yes                                                                 | No                                                                           | Legacy/unwired                                                |
| `render-measurement-pdf`                 | `supabase/functions/render-measurement-pdf/index.ts`                 | Current customer-ready PDF renderer                   | No                                                  | Yes: PDF URL/path + GRJ signature | Yes                          | Yes                                                                 | No                                                                           | Canonical renderer, but missing renderer version stamp        |
| `backfill-measurement-diagrams`          | `supabase/functions/backfill-measurement-diagrams/index.ts`          | Backfills diagrams from old rows                      | No                                                  | No                                | Yes                          | Inserts diagrams                                                    | No                                                                           | Must remain debug/backfill only                               |
| `recalculate-measurement-from-overrides` | `supabase/functions/recalculate-measurement-from-overrides/index.ts` | Rebuilds totals from `roof_lines` overrides           | No                                                  | Yes                               | Yes                          | No                                                                  | No                                                                           | Canonical override path                                       |


### Solver module status


| Module                      | File                                                      | Exported runtime role                                 | Imported by                          | Active?                                                          |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| Canonical autonomous solver | `supabase/functions/_shared/autonomous-graph-solver.ts`   | `solveAutonomousGraph`, topology/fidelity diagnostics | `start-ai-measurement`               | Active only through canonical route                              |
| Deferred edges              | `supabase/functions/_shared/deferred-structural-edges.ts` | Phase 3C diagnostics and edge deferral                | `_shared/autonomous-graph-solver.ts` | Active in shared solver, but not guaranteed if legacy route used |
| Backbone seed               | `supabase/functions/_shared/backbone-seed.ts`             | Phase 3D seed backbone diagnostics                    | `_shared/autonomous-graph-solver.ts` | Active in shared solver, but only if callsite reached            |
| Constraint solver           | `supabase/functions/_shared/constraint-roof-solver.ts`    | Constraint candidate solver                           | `_shared/autonomous-graph-solver.ts` | Active when solver triggers it                                   |
| Repair pass                 | `supabase/functions/_shared/constraint-solver-repair.ts`  | Phase 3E repair diagnostics                           | `_shared/constraint-roof-solver.ts`  | Active only when repair conditions trigger                       |
| Perimeter refinement        | `supabase/functions/_shared/perimeter-refinement.ts`      | Phase 3A.5 true outer perimeter refinement            | `start-ai-measurement`               | Active in canonical route before topology                        |
| Perimeter topology          | `supabase/functions/_shared/perimeter-topology.ts`        | Phase 0 / 3A eave-rake and perimeter gate             | `start-ai-measurement`, solver       | Active in canonical route                                        |
| Roof lines                  | `supabase/functions/_shared/roof-lines.ts`                | Typed line persistence/aggregation                    | `start-ai-measurement`, overrides    | Active but Phase 3B says counts-only in one debug block          |
| Result state                | `supabase/functions/_shared/result-state.ts`              | Canonical DB-safe result states + diagram intent      | `start-ai-measurement`, overrides    | Active                                                           |
| Legacy solver copy          | `supabase/functions/measure/autonomous-graph-solver.ts`   | Old measure pipeline solver                           | `measure/index.ts`                   | Active only if deprecated `measure` is called; not canonical     |


### Why the latest report can still show Phase 3 as missing

1. `MeasurementReportDialog` shows `not implemented` when the visible row has null/missing Phase 3 values in `geometry_report_json`.
2. Runtime route stamps like `created_by_function`, `created_by_component`, `solver_entrypoint`, `report_renderer_version`, and `phase3_5_perimeter_refinement_version` do not exist in the current schema/types.
3. `start-ai-measurement` writes Phase 3C/D/E DB columns, but there is no DB column for `phase3_5_perimeter_refinement_version` and no provenance columns, so the report cannot prove which path created the row.
4. Legacy active paths (`measure`, `RoofMeasurementTool`, `generate-roof-report`, `generate-roofr-style-report`, `analyze-roof-aerial`) can still create/update/render measurement artifacts without Phase 3.
5. `debug-measurement-runtime` does not expose Phase 3 stamps, so it cannot prove the deployed edge bundle contains the Phase 3 wiring.

## Canonical route decision

Canonical path should be exactly:

```text
AI Measurement button
→ PullMeasurementsButton
→ useMeasurementJob.startJob
→ start-ai-measurement
→ source acquisition
→ confirmed roof target
→ Phase 0 perimeter
→ Phase 3A eave/rake
→ Phase 3A.5 perimeter refinement hard gate
→ Phase 3C deferred edges
→ Phase 3D locked backbone
→ Phase 3E repair when applicable
→ roof_lines persistence
→ geometry_report_json + DB runtime stamps
→ MeasurementReportDialog / render-measurement-pdf
```

All other paths become one of:

- Read-only renderer.
- Manual/debug tool clearly labeled legacy.
- Deprecated wrapper that returns a 410/redirect-style response for AI pull/generate-overlay actions.

## Implementation plan

### 1. Add runtime provenance DB columns

Create a migration for `roof_measurements`, `ai_measurement_jobs`, and `measurement_jobs`:

- `created_by_function text`
- `created_by_component text`
- `solver_entrypoint text`
- `report_renderer_version text`
- `phase3_5_perimeter_refinement_version text`
- `route_audit_version text`
- `canonical_measurement_route boolean default false`

Also add indexes for route audit queries:

- `roof_measurements(created_by_function, created_at desc)`
- `roof_measurements(canonical_measurement_route, created_at desc)`

### 2. Stamp the canonical start route everywhere

Update `supabase/functions/start-ai-measurement/index.ts` so every job row, success row, failure row, and `geometry_report_json` includes:

```json
{
  "created_by_function": "start-ai-measurement",
  "created_by_component": "PullMeasurementsButton/useMeasurementJob",
  "solver_entrypoint": "_shared/autonomous-graph-solver.solveAutonomousGraph",
  "canonical_measurement_route": true,
  "route_audit_version": "measurement-route-audit-v1",
  "phase3_5_perimeter_refinement_version": "v1",
  "phase3C_deferred_edges_version": "v1",
  "phase3D_backbone_seed_version": "v1",
  "phase3E_constraint_repair_version": "v1"
}
```

For skipped phases, persist the existing block shape:

```json
{ "version": "v1", "executed": false, "skipped_reason": "..." }
```

No Phase 3 version field should be null on new canonical rows.

### 3. Stamp the PDF/report renderer

Update `render-measurement-pdf` to write:

- `report_renderer_version = "render-measurement-pdf-v1"`
- `geometry_report_json.report_renderer_version = "render-measurement-pdf-v1"`
- `geometry_report_json.rendered_by_function = "render-measurement-pdf"`

Keep customer PDF gating unchanged.

### 4. Fix report dialog Phase 3 visibility

Update `MeasurementReportDialog` to read Phase 3 values from all canonical locations:

- top-level `measurement.phase3C_deferred_edges_version`
- `geometry_report_json.phase3C_deferred_edges_version`
- `geometry_report_json.phase3.phase3C_deferred_edges_version`
- `geometry_report_json.phase3C.version`

Same for 3A.5, 3D, 3E.

Display:

- `v1 / executed`
- `v1 / skipped: <reason>`
- `MISSING — stale or non-canonical route`

Do not use the phrase “not implemented” for rows that simply predate route stamping.

### 5. Fence legacy measurement creation routes

Update active legacy frontends:

- `RoofMeasurementTool.tsx`: for AI analysis, replace `measure?action=pull` with the canonical `start-ai-measurement` flow or show a warning that this is a legacy/manual-only tool.
- `useMeasurement.ts`: keep `latest` read for legacy materials only, but prevent `pull`, `repull`, and `generate-overlay` from silently creating canonical-looking `roof_measurements` through `measure`.
- `MaterialCalculations.tsx`: stop using `measure?action=latest` as source of truth; read latest `roof_measurements` directly by lead/customer id.

Do not delete legacy edge functions in this pass; add runtime stamps where they still create rows:

- `created_by_function = "measure"` or `"analyze-roof-aerial"`
- `canonical_measurement_route = false`
- `geometry_report_json.route_warning = "legacy_noncanonical_measurement_path"`

### 6. Add a route audit diagnostic endpoint

Extend `debug-measurement-runtime` or add `debug-measurement-route-audit` to return:

- deployed canonical versions
- latest measurement rows for a lead/address
- each row’s `created_by_function`, `solver_entrypoint`, phase versions, `result_state`, `hard_fail_reason`, and renderer version
- whether any active legacy row exists after the latest canonical row

This gives an objective answer before rerunning Fonsica.

### 7. Generate a static audit doc in the repo

Add `docs/measurement-route-audit.md` with:

- the audit table above
- canonical path diagram
- deprecated paths
- Phase 3 stamp contract
- expected Fonsica rerun checklist

### 8. Deploy and validate without rerunning Fonsica yet

Deploy changed functions:

- `start-ai-measurement`
- `render-measurement-pdf`
- `debug-measurement-runtime` or new route audit function

Then validate:

- schema columns exist
- runtime endpoint returns Phase 3 stamps
- frontend report dialog can display the new stamp locations
- legacy paths are visibly non-canonical

## Expected result before rerun

Before rerunning Fonsica, we should be able to inspect the system and prove:

- which route created each visible measurement row
- whether the row is canonical or legacy
- whether Phase 3A.5/3C/3D/3E executed or were skipped with specific reasons
- which renderer generated any report/PDF
- no hidden old path can create a stale customer-looking report without route warnings

Only after that should Fonsica be rerun. A new canonical Fonsica row must show non-null:

- `phase3_5_perimeter_refinement_version`
- `phase3C_deferred_edges_version`
- `phase3D_backbone_seed_version`
- `phase3E_constraint_repair_version`
- `created_by_function`
- `solver_entrypoint`
- `report_renderer_version` once rendered

If it still fails, the failure must be specific and stage-correct:

- `perimeter_refinement_failed`
- `backbone_not_applied`
- `topology_undersegmented_after_backbone_repair`
- or another normalized hard-fail reason mapped through `normalizeResultStateForWrite()`.  
  
Yes — this is a **good plan**, and it finally targets the real meta-problem: **multiple measurement/report paths are active**, so fixing one path does not guarantee the row/report you see came from that path.
  The audit says exactly what we suspected: there is a canonical path, but there are still legacy paths that can create, update, or render measurement data without Phase 3. The uploaded audit identifies active legacy routes including `measure`, `measure-roof`, `analyze-roof-aerial`, `generate-roof-overlay`, `generate-roof-report`, and `generate-roofr-style-report`, while the intended canonical path is `PullMeasurementsButton → useMeasurementJob.startJob → start-ai-measurement → _shared/autonomous-graph-solver → render-measurement-pdf`.
  I also searched GitHub for the new route-stamp fields like `created_by_function`, `canonical_measurement_route`, `route_audit_version`, and `phase3_5_perimeter_refinement_version`, and nothing came back. That means this plan is not committed/indexed yet, or Lovable has not shipped it into GitHub. Do not rerun Fonsica until these stamps exist.
  ## The only correction I would make
  Do **not** let Lovable add a bunch of new DB columns unless they are truly stable. You already got burned by schema drift with `result_state` and `archetype_debug`.
  I would approve only these as top-level DB columns:
  ```

  ```
  ```
  created_by_function
  created_by_component
  solver_entrypoint
  report_renderer_version
  canonical_measurement_route
  route_audit_version
  ```
  Put all Phase 3 versions and phase execution details inside `geometry_report_json`, not as separate columns:
  ```

  ```
  ```
  geometry_report_json.phase3_5.version
  geometry_report_json.phase3C.version
  geometry_report_json.phase3D.version
  geometry_report_json.phase3E.version
  ```
  That avoids another schema-cache failure every time you add a debug field.
  ## Send this approval with edits
  ```

  ```
  ```
  Approve the AI Measurement Route Audit + Canonicalization Plan with one schema-safety change.

  The plan is correct: the system has multiple active measurement/report paths, and we need canonical route stamps before rerunning Fonsica.

  Proceed, but keep DB columns stable.

  Add only these stable top-level DB columns to roof_measurements, ai_measurement_jobs, and measurement_jobs:
  - created_by_function text
  - created_by_component text
  - solver_entrypoint text
  - report_renderer_version text
  - canonical_measurement_route boolean default false
  - route_audit_version text

  Do NOT add phase3_5_perimeter_refinement_version, phase3C/D/E version fields as top-level DB columns.

  Instead, persist Phase 3 versions and execution states inside geometry_report_json:

  geometry_report_json.phase3_5 = {
    version: "v1",
    executed: true/false,
    skipped_reason: null|string,
    refinement_iou,
    perimeter_to_target_mask_ratio,
    refined_perimeter_vertex_count
  }

  geometry_report_json.phase3C = {
    version: "v1",
    executed: true/false,
    skipped_reason: null|string,
    connectivity_edges_deferred,
    deferred_structural_candidates_count
  }

  geometry_report_json.phase3D = {
    version: "v1",
    executed: true/false,
    skipped_reason: null|string,
    locked_backbone_edges_count,
    seed_backbone_edges_inserted
  }

  geometry_report_json.phase3E = {
    version: "v1",
    executed: true/false,
    skipped_reason: null|string,
    candidate_repair_attempted,
    repair_accepted
  }

  Every new canonical measurement row must also include:

  geometry_report_json.route_provenance = {
    created_by_function: "start-ai-measurement",
    created_by_component: "PullMeasurementsButton/useMeasurementJob",
    solver_entrypoint: "_shared/autonomous-graph-solver.solveAutonomousGraph",
    canonical_measurement_route: true,
    route_audit_version: "measurement-route-audit-v1"
  }

  Legacy routes must stamp:
  canonical_measurement_route = false
  created_by_function = "measure" or "analyze-roof-aerial" etc.
  geometry_report_json.route_warning = "legacy_noncanonical_measurement_path"

  Required before rerunning Fonsica:
  1. Migration applied.
  2. PostgREST schema cache refreshed.
  3. start-ai-measurement deployed.
  4. render-measurement-pdf deployed.
  5. debug-measurement-runtime or debug-measurement-route-audit deployed.
  6. MeasurementReportDialog shows:
     - canonical vs legacy
     - created_by_function
     - solver_entrypoint
     - report_renderer_version
     - phase3_5 / 3C / 3D / 3E: executed, skipped, or missing
  7. Legacy paths are fenced so they cannot silently create canonical-looking measurements.

  Do not rerun Fonsica until the route audit endpoint proves the deployed system can identify:
  - which route created each visible measurement row
  - whether it was canonical
  - whether Phase 3A.5/3C/3D/3E executed or were skipped
  - which renderer generated the PDF/report
  ```
  This is the right checkpoint. You need route provenance before more roof geometry work, otherwise you’ll keep debugging stale or non-canonical reports.