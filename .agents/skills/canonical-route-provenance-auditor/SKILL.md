---
name: canonical-route-provenance-auditor
description: Audits AI Measurement runs to ensure they use the canonical runtime path (PullMeasurementsButton → useMeasurementJob.startJob → start-ai-measurement → autonomous-graph-solver → MeasurementReportDialog/render-measurement-pdf) and that every canonical measurement row carries full route provenance. Triggers when a request touches the AI Measurement button, start-ai-measurement, measurement_jobs, ai_measurement_jobs, roof_measurements, measure / measure-roof / analyze-roof-aerial, generate-roof-report, generate-roofr-style-report, render-measurement-pdf, MeasurementReportDialog, or debug-measurement-runtime. Blocks legacy routes from silently creating canonical-looking measurements and refuses to mark phases implemented without executed=true evidence.
---

# Canonical Route & Runtime Provenance Auditor

## Role
Ensure every AI Measurement run uses the correct canonical runtime path and that no legacy route silently creates or renders measurement data.

## Applies when
A request touches any of:
- AI Measurement button
- `start-ai-measurement`
- `measurement_jobs`
- `ai_measurement_jobs`
- `roof_measurements`
- `measure` / `measure-roof` / `analyze-roof-aerial`
- `generate-roof-report`
- `generate-roofr-style-report`
- `render-measurement-pdf`
- `MeasurementReportDialog`
- `debug-measurement-runtime`

## Hard Rules

### 1. Provenance stamping (canonical rows)
Every new canonical measurement row MUST include:
- `created_by_function`
- `created_by_component`
- `solver_entrypoint`
- `canonical_measurement_route` (true)
- `route_audit_version`
- `report_renderer_version` (if rendered)
- `geometry_report_json.route_provenance`

### 2. Canonical path (exact)
```
PullMeasurementsButton
  → useMeasurementJob.startJob
    → start-ai-measurement
      → _shared/autonomous-graph-solver.solveAutonomousGraph
        → geometry_report_json
          → MeasurementReportDialog / render-measurement-pdf
```
Any deviation = non-canonical.

### 3. Legacy route stamping
Legacy routes MAY NOT create canonical-looking measurements. They MUST stamp:
- `canonical_measurement_route = false`
- `created_by_function =` actual legacy function name
- `geometry_report_json.route_warning = "legacy_noncanonical_measurement_path"`

### 4. Phase-implementation honesty
Do NOT claim a phase (3A, 3A.5, 3C, 3D, 3E, etc.) is implemented unless ALL are true:
- module file exists
- module is imported at the call site
- call site is actually reached at runtime
- diagnostics persist `executed = true` OR an explicit `skipped_reason`

"Code exists" is not "phase shipped." Reachability + execution proof is required.

### 5. Debug endpoint contract
`debug-measurement-runtime` (or equivalent) MUST be able to prove for any row:
- which route created it (`created_by_function` / `canonical_measurement_route`)
- which solver ran (`solver_entrypoint`)
- which renderer rendered it (`report_renderer_version`)
- phase status: `phase3_5`, `phase3C`, `phase3D`, `phase3E` (executed / skipped_reason / hard_fail_reason)
- customer gate state (`customer_report_ready`, `block_customer_report_reason`, `result_state`)

## Required output (BEFORE writing fixes)
For any qualifying request, first produce:

1. **Active route table** — every code path currently capable of writing to `roof_measurements` / `ai_measurement_jobs` / `measurement_jobs`, with: caller component → hook → edge function → solver → renderer.
2. **Legacy route table** — same shape, flagged. Note which ones still write canonical-looking rows.
3. **Canonical row proof** — a recent row showing all required provenance fields populated.
4. **Missing provenance fields** — diff between required stamps and what's actually persisted, per route.
5. **Next migration / function changes** — minimal change set to close the gaps. Migrations grouped, functions listed by name.

Only after that output is on the table do you propose or write code/SQL changes.

## Refusal triggers
Refuse to mark complete and surface the gap if:
- A canonical row is missing any required provenance field.
- A legacy route writes rows without `route_warning = legacy_noncanonical_measurement_path`.
- A phase is reported "done" without `executed = true` (or a `skipped_reason`) in diagnostics.
- `debug-measurement-runtime` cannot answer all five questions in Rule 5 for a given row.
