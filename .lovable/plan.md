# Fonsica Regression: Run Tests, Add Fixture, Verify Live Row

## Status snapshot

Wired (from prior loop):
- Terminal payload fallback / `rebuildAerialGraphFromFinalPayload`
- `skip_debug` synthesis
- Impossible-skip diagnostics
- `preserveEstimatedWorkUnits` helper
- `late_cpu_preempt` surfacing

Gaps to close in this slice:
1. Tests have not actually been executed.
2. No dedicated Fonsica fixture file exists under `_shared/__fixtures__/`.
3. The 96s CPU overrun is only diagnosed — root cause (missing control-flow checkpoint between expensive phases) is unfixed.

This plan does NOT touch six-phase cleanup, cost-tracker P2+, or any QBO work.

## Slice 1 — Run the regression tests (no claim of "fixed" until green)

Target test files, run via `supabase--test_edge_functions`:

```text
supabase/functions/start-ai-measurement/__tests__/
  registration-pretopology-terminal-payload.test.ts
  aerial-graph-survives-cpu-preempt.test.ts
  cpu-preempt-threshold.test.ts
  raw-perimeter-and-debug-contract.test.ts
  aerial-graph-fonsica-shaped-input.test.ts
```

Pure-logic targets the suite must cover (no DSM/geotiff imports):
- `buildCpuBudgetTerminalDebugPayload`
- `rebuildAerialGraphFromFinalPayload`
- `preserveEstimatedWorkUnits`
- `buildPreTopologyDebugBag`
- `buildAerialCandidateGraph`

If the Deno harness fails because a sibling module pulls in `geotiff` / DSM code, isolate by:
- Moving the pure helpers into a leaf module (or re-exporting from a thin barrel) that the test imports directly.
- Importing the helpers by path, not via the function's `index.ts`.
- No mocking of geotiff — the test must not transitively load it at all.

Pass criteria (per assertion, mapped to the AI Measurement Regression Harness rules):
- `aerial_candidate_roof_graph.executed === true`
- `edges.length >= 6`
- `skipped_reason` is null/absent
- `primary_geometry_source === 'aerial_registered'`
- `dsm_validation_status.reason === 'invalid_transform'`
- `estimated_work_units` preserved (> 0, equal to pre-preempt value)
- `aerial_graph_rebuilt_from_final_payload === true`
- `work_units_preserved === true`
- `customer_report_ready === false`
- If `cpu_budget_elapsed_ms > 75000` → `late_cpu_preempt === true` MUST be asserted present (this is the diagnostic contract; it does NOT mean the bug is fixed).

## Slice 2 — Add the Fonsica fixture file (required, not optional)

New file:
```text
supabase/functions/_shared/__fixtures__/fonsica-pretopology-payload.json
```

Contents: a real, anonymized terminal-payload shape from the last Fonsica run that exhibited the late preempt. Source = the most recent `ai_measurement_jobs` row for 4063 Fonsica Ave (queried via `supabase--read_query`), with PII stripped.

The regression test is rewritten to load the fixture instead of an inline literal, so future Fonsica-class regressions reuse the same shape.

## Slice 3 — Deploy and re-run live

Order is non-negotiable:
1. Tests green (Slice 1).
2. Deploy `start-ai-measurement` via `supabase--deploy_edge_functions`.
3. Ask the user to retrigger Fonsica from the UI (we don't auto-trigger live AI jobs).
4. Query the freshest `ai_measurement_jobs` row for 4063 Fonsica Ave via `supabase--read_query`.
5. Assert against the same contract list above.

## Slice 4 — Decision gate on CPU overrun

After the fresh live row lands, exactly one of:

- `cpu_budget_elapsed_ms <= 75000` AND `late_cpu_preempt` absent/false → graph-persistence fix confirmed; CPU control flow currently healthy on this input. Close the loop.
- `cpu_budget_elapsed_ms > 75000` AND `late_cpu_preempt === true` → graph-persistence fix confirmed, but CPU control flow is still broken. Surface explicitly: "graph persistence fixed; CPU checkpoint follow-up required" and open the next slice (Slice 5).
- Any contract field missing/wrong → stop; do not claim fix; report the exact failed field.

## Slice 5 — (Conditional) Missing CPU checkpoint follow-up

Only if Slice 4 hits the second branch.

Hypothesis: `shouldPreemptForCpuBudget` math is correct, but the long-running path between Phase 3A → 3A.5 → 3C → 3D has no checkpoint call, so the budget is never consulted until after the expensive work returns.

Action (NOT executed in this plan — separate follow-up slice):
- Identify the longest uninterrupted span in `start-ai-measurement/index.ts` between budget checks.
- Insert `shouldPreemptForCpuBudget(...)` checkpoints at phase boundaries (entry of 3A.5, entry of 3C, entry of 3D, before each `solve*` call).
- Add a regression test that simulates a slow Phase 3A and asserts preempt fires before Phase 3C entry, not after.

## Out of scope (explicit)

- Six-phase measurement cleanup
- Cost-tracker P2–P8
- QBO additional call-site changes
- Any frontend report-rendering work

## Acceptance for this loop

- All five Slice 1 tests pass under Deno.
- Fixture file committed at the exact path above and consumed by the test.
- `start-ai-measurement` deployed.
- A fresh Fonsica row is queried and every contract field is reported (pass or fail) in a single status table.
- "Fixed" is only claimed if every Slice-1 assertion passes AND the live row satisfies the Slice-4 first branch. Otherwise Slice 5 is queued.
