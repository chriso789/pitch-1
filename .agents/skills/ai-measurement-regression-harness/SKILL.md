---
name: ai-measurement-regression-harness
description: Builds and enforces automated regression tests for the AI Measurement pipeline. Triggers when a request touches Fonsica, Montelluna, Palm Harbor, Roofr benchmark comparison, phase gates, perimeter validation, topology validation, customer_report_ready, result_state, or measurement report diagnostics. Enforces that every fix ships with a regression test against the canonical baselines (Fonsica 3077 sqft / ~264 LF / ~14 facets / 6:12 / non-zero ridge+valley when topology passes), that perimeter/topology/route/state/report gates are individually asserted, and that customer_report_ready can only flip true through assertCustomerReportReady.
---

# AI Measurement Regression Harness

## Role
Own the regression test surface for AI Measurement. No fix ships without a test that would have caught the regression it claims to fix.

## Applies when
A request touches:
- Fonsica (4063 Fonsica Ave) — canonical complex hip baseline
- Montelluna — secondary baseline
- Palm Harbor — secondary baseline
- Roofr benchmark comparison
- Phase gates (3A / 3A.5 / 3C / 3D / 3E)
- Perimeter validation
- Topology validation
- `customer_report_ready`
- `result_state`
- Measurement report diagnostics

## Hard Rules

### 1. Test-with-every-fix
Every code change touching the measurement pipeline MUST include at least one new or updated regression test. "Verified manually" is not acceptable.

### 2. Fonsica baseline (canonical)
- Roofr area: **3077 sqft**
- Expected: complex hip roof
- Expected perimeter: **~264 LF** eaves + rakes
- Expected facets: **~14**
- Expected pitch: **~6/12**
- When topology passes: `ridge_lf > 0` AND `valley_lf > 0` (never zero)

### 3. Fonsica perimeter assertions
- Area match alone MUST NOT pass perimeter (`area_sanity_passed=true` + `shape_passed=false` → fail).
- `shape_validation` block MUST exist on the persisted row.
- `visual_edge_alignment_score` MUST be populated (numeric, not null).
- `aerial_edge_support_pct` MUST NOT be null.
- `long_segment_corner_cut_count` MUST be present in diagnostics.
- If shape fails → topology MUST NOT run (assert no `phase3C`/`phase3D` execution).
- If `user_verified_perimeter = true` → topology MAY run, but `customer_report_ready` MUST remain `false` until topology gate also passes.

### 4. Route provenance assertions
- `created_by_function === 'start-ai-measurement'` for canonical rows.
- `canonical_measurement_route === true`.
- `phase3_5`, `phase3C`, `phase3D`, `phase3E` each carry a `version` AND either `executed === true` or an explicit `skipped_reason`.

### 5. State assertions
- `result_state` MUST NEVER be blank/null.
- No unnormalized `result_state` may reach the DB — every write goes through `normalizeResultStateForWrite()`.
- `customer_report_ready` may only flip to `true` via `assertCustomerReportReady()` (or equivalent guard). Direct sets are a test failure.

### 6. Report rendering assertions
- If `diagram_render_intent === 'rejected_only'` AND `phase3_5` exists → the report MUST render the perimeter overlay (not blank, not a geometry-only SVG).
- Failed-geometry rows MUST NOT render anything visually indistinguishable from a customer-ready report (no totals card, no "ready" badge, watermark/banner present).

## Required output (when this skill is invoked)
Before writing implementation code, return:

1. **Test file paths** — exact paths under `supabase/functions/<fn>/__tests__/` and/or `src/**/__tests__/`, named after the regression (e.g. `fonsica-perimeter-shape.test.ts`).
2. **Mock payloads** — fixtures placed under `supabase/functions/_shared/__fixtures__/` or `src/test/fixtures/`. Use real persisted rows where possible (anonymized), not hand-crafted shapes.
3. **Assertions** — explicit `assertEquals` / `expect(...).toBe(...)` list per rule above. Map each assertion to the Hard Rule number it enforces.
4. **Acceptance thresholds** — numeric tolerances (e.g. area ±2%, perimeter ±5%, facets ±25%, pitch ±1/12) tied to the vendor benchmark gate.
5. **Commands to run tests** — for Deno: `supabase--test_edge_functions` with the function name(s). For frontend: `bunx vitest run <path>`. Never tell the user to run shell commands themselves.

## Test layout convention

```
supabase/functions/start-ai-measurement/__tests__/
  fonsica-perimeter-shape.test.ts
  fonsica-route-provenance.test.ts
  fonsica-state-normalization.test.ts
supabase/functions/_shared/__fixtures__/
  fonsica-row.json
  montelluna-row.json
  palm-harbor-row.json
src/components/measurements/__tests__/
  MeasurementReportDialog.rejected-only.test.tsx
```

## Refusal triggers
Refuse to mark a fix complete and surface the gap if:
- The change touches the pipeline but ships no new/updated regression test.
- A Fonsica-class run lacks any of `shape_validation`, `visual_edge_alignment_score`, `aerial_edge_support_pct`, `long_segment_corner_cut_count`.
- A topology phase shows `executed=true` while perimeter `shape_passed=false` and `user_verified_perimeter` is not `true`.
- `customer_report_ready=true` appears without an `assertCustomerReportReady` call path in the test.
- A `rejected_only` row renders a blank report or a customer-style layout in the test snapshot.
