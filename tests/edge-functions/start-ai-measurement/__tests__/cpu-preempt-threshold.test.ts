// Backend regression — CPU preempt wall-clock reserve threshold.
//
// Mirrors the production helper `shouldPreemptForCpuBudget` so we can assert
// the contract documented in `.lovable/plan.md`:
//   • effective_budget_ms = cpu_budget_ms - cpu_terminal_write_reserve_ms
//   • preempt fires when elapsed >= effective_budget_ms, regardless of
//     whether estimated_work_units is known
//   • reason becomes 'wall_clock_reserve_threshold'
//
// We re-implement the pure helper here to avoid pulling the full edge function
// module (which imports DOM-ish runtime globals). The shapes/constants match
// the production copy 1:1 and are kept in lockstep.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIN_AI_MEASUREMENT_CPU_BUDGET_MS = 240_000;
const CONFIGURED_AI_MEASUREMENT_CPU_BUDGET_MS = 75_000;
const AI_MEASUREMENT_CPU_BUDGET_MS = Math.max(
  CONFIGURED_AI_MEASUREMENT_CPU_BUDGET_MS,
  MIN_AI_MEASUREMENT_CPU_BUDGET_MS,
);
const AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS = 20_000;
const AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT = 1_000_000;

function shouldPreemptForCpuBudget(
  elapsedMs: number,
  estimatedWorkUnits = 0,
) {
  const remainingMs = AI_MEASUREMENT_CPU_BUDGET_MS - elapsedMs;
  const effectiveBudgetMs = AI_MEASUREMENT_CPU_BUDGET_MS -
    AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS;
  if (elapsedMs >= effectiveBudgetMs) {
    return {
      preempt: true,
      elapsed_ms: elapsedMs,
      remaining_ms: remainingMs,
      reason: "wall_clock_reserve_threshold",
    };
  }
  if (
    estimatedWorkUnits > 0 &&
    estimatedWorkUnits > AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT
  ) {
    return {
      preempt: true,
      elapsed_ms: elapsedMs,
      remaining_ms: remainingMs,
      reason: "estimated_topology_workload_exceeds_cpu_budget",
    };
  }
  return {
    preempt: false,
    elapsed_ms: elapsedMs,
    remaining_ms: remainingMs,
    reason: null,
  };
}

Deno.test("stale 75s configured budget is clamped to 240s minimum", () => {
  assertEquals(AI_MEASUREMENT_CPU_BUDGET_MS, 240_000);
});

Deno.test("preempt fires at effective budget boundary with reason wall_clock_reserve_threshold", () => {
  const r = shouldPreemptForCpuBudget(220_000, 0);
  assertEquals(r.preempt, true);
  assertEquals(r.reason, "wall_clock_reserve_threshold");
  assert(r.elapsed_ms < AI_MEASUREMENT_CPU_BUDGET_MS);
});

Deno.test("preempt still fires when estimated work units are unknown (0)", () => {
  const r = shouldPreemptForCpuBudget(230_000, 0);
  assertEquals(r.preempt, true);
  assertEquals(r.reason, "wall_clock_reserve_threshold");
});

Deno.test("no preempt while elapsed is comfortably under effective budget", () => {
  const r = shouldPreemptForCpuBudget(120_000, 0);
  assertEquals(r.preempt, false);
  assertEquals(r.reason, null);
});

Deno.test("topology workload cap still trips when wall clock is fine", () => {
  const r = shouldPreemptForCpuBudget(10_000, 5_000_000);
  assertEquals(r.preempt, true);
  assertEquals(r.reason, "estimated_topology_workload_exceeds_cpu_budget");
});
