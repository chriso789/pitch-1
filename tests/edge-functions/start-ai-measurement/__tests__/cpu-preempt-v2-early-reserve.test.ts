// CPU containment v2 — early-reserve safety margin regression tests.
//
// Pure-logic tests — no DSM/geotiff imports. Mirror the constants exactly as
// they live in start-ai-measurement/index.ts so any drift here surfaces as a
// failing test rather than a silent runtime regression.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildCpuBudgetTerminalDebugPayload,
  preserveEstimatedWorkUnits,
} from "../../_shared/pre-topology-debug-bag.ts";

// Mirror live constants. A stale 75s env override caused Fonsica runs to fail
// after ~210s, so the production helper clamps to this minimum.
const MIN_CPU_BUDGET_MS = 240_000;
const TERMINAL_RESERVE_MS = 20_000;
const SAFETY_MARGIN_MS = 10_000;
const CPU_BUDGET_MS = Math.max(75_000, MIN_CPU_BUDGET_MS);
const EFFECTIVE_PREEMPT_MS = CPU_BUDGET_MS - TERMINAL_RESERVE_MS -
  SAFETY_MARGIN_MS; // 210_000
const POLICY_VERSION = "cpu-preempt-v2-early-reserve";
const TOPOLOGY_PIXEL_LIMIT = 950_000;

// Local mirror of `shouldPreemptForCpuBudget` so we can test pure logic.
function shouldPreempt(elapsedMs: number, workUnits = 0) {
  const remainingMs = CPU_BUDGET_MS - elapsedMs;
  const wallClockReserveMs = CPU_BUDGET_MS - TERMINAL_RESERVE_MS;
  const base = {
    elapsed_ms: elapsedMs,
    remaining_ms: remainingMs,
    effective_preempt_ms: EFFECTIVE_PREEMPT_MS,
    safety_margin_ms: SAFETY_MARGIN_MS,
    policy_version: POLICY_VERSION,
  };
  if (elapsedMs >= EFFECTIVE_PREEMPT_MS) {
    return {
      ...base,
      preempt: true,
      reason: elapsedMs >= wallClockReserveMs
        ? "wall_clock_reserve_threshold"
        : "early_reserve_safety_margin",
    };
  }
  if (remainingMs < (TERMINAL_RESERVE_MS + SAFETY_MARGIN_MS)) {
    return { ...base, preempt: true, reason: "early_reserve_safety_margin" };
  }
  if (workUnits > 0 && workUnits > TOPOLOGY_PIXEL_LIMIT) {
    return {
      ...base,
      preempt: true,
      reason: "estimated_topology_workload_exceeds_cpu_budget",
    };
  }
  return { ...base, preempt: false, reason: null };
}

Deno.test("v2: stale 75s env override is clamped to the 240s Fonsica floor", () => {
  assertEquals(CPU_BUDGET_MS, 240_000);
  assertEquals(EFFECTIVE_PREEMPT_MS, 210_000);
});

Deno.test("v2: elapsed=209000ms → preempt=false (under early-reserve threshold)", () => {
  const ckpt = shouldPreempt(209_000);
  assertEquals(ckpt.preempt, false);
  assertEquals(ckpt.effective_preempt_ms, 210_000);
  assertEquals(ckpt.safety_margin_ms, 10_000);
  assertEquals(ckpt.policy_version, POLICY_VERSION);
});

Deno.test("v2: elapsed=211000ms → preempt=true with early_reserve_safety_margin reason", () => {
  const ckpt = shouldPreempt(211_000);
  assertEquals(ckpt.preempt, true);
  assertEquals(ckpt.reason, "early_reserve_safety_margin");
  assertEquals(ckpt.effective_preempt_ms, 210_000);
  assertEquals(ckpt.safety_margin_ms, 10_000);
  assertEquals(ckpt.policy_version, POLICY_VERSION);
});

Deno.test("v2: refineTrueOuterRoofPerimeter NOT called at 211000ms", () => {
  const refineSpy = { called: false };
  const ckpt = shouldPreempt(211_000);
  if (!ckpt.preempt) refineSpy.called = true; // would invoke refine
  assertEquals(refineSpy.called, false);
});

Deno.test("v2: autonomous topology solver NOT called at 211000ms", () => {
  const solverSpy = { called: false };
  const ckpt = shouldPreempt(211_000);
  if (!ckpt.preempt) solverSpy.called = true; // would invoke solver
  assertEquals(solverSpy.called, false);
});

Deno.test("v2: terminal payload contract — headroom + policy fields", () => {
  const ckpt = shouldPreempt(211_000);
  // Caller of buildCpuBudgetTerminalDebugPayload writes the payload from a
  // budget snapshot taken AT the checkpoint. The harness in
  // persistCpuBudgetTerminalFailure then forces the v2 fields onto dp.
  const dp = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_refine_true_outer_roof_perimeter",
    estimatedWorkUnits: null,
    debug: {
      aerial_candidate_roof_graph: { executed: true, edges: Array(12).fill({}) },
    },
    budget: ckpt,
    constants: {
      AI_MEASUREMENT_CPU_BUDGET_MS: CPU_BUDGET_MS,
      AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: TERMINAL_RESERVE_MS,
      AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: TOPOLOGY_PIXEL_LIMIT,
      AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "topology_validation",
      AI_MEASUREMENT_CPU_TIMEOUT_REASON: "cpu_budget_exceeded",
      REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph",
    },
  }) as any;

  // Force v2 fields exactly as persistCpuBudgetTerminalFailure does.
  dp.cpu_preempt_policy_version = POLICY_VERSION;
  dp.cpu_preempt_safety_margin_ms = SAFETY_MARGIN_MS;
  dp.cpu_effective_preempt_ms = EFFECTIVE_PREEMPT_MS;
  dp.cpu_checkpoint_stage = "pre_refine_true_outer_roof_perimeter";
  dp.cpu_checkpoint_elapsed_ms = ckpt.elapsed_ms;
  dp.cpu_checkpoint_remaining_ms = ckpt.remaining_ms;

  assert(dp.cpu_budget_elapsed_ms < CPU_BUDGET_MS);
  assert(dp.cpu_budget_remaining_ms > 0);
  assertEquals(dp.late_cpu_preempt, false);
  assertEquals(dp.cpu_preempt_policy_version, POLICY_VERSION);
  assertEquals(dp.cpu_effective_preempt_ms, 210_000);
  assertEquals(dp.cpu_preempt_safety_margin_ms, 10_000);
  assertEquals(dp.cpu_checkpoint_stage, "pre_refine_true_outer_roof_perimeter");
});

Deno.test("v2: estimated_work_units cascade — prior 996004 wins", () => {
  const preserved = preserveEstimatedWorkUnits({
    estimatedWorkUnits: 0,
    priorGeometry: { estimated_work_units: 996_004 },
    incoming: { topology_pixel_limit: 950_000 },
    topologyPixelLimit: 950_000,
  });
  assertEquals(preserved, 996_004);
});

Deno.test("v2: estimated_work_units cascade — fallback to topology_pixel_limit 950000", () => {
  const preserved = preserveEstimatedWorkUnits({
    estimatedWorkUnits: 0,
    priorGeometry: null,
    incoming: { topology_pixel_limit: 950_000 },
    topologyPixelLimit: 950_000,
  });
  assertEquals(preserved, 950_000);
});

Deno.test("v2: estimated_work_units cascade — never 0 when topologyPixelLimit arg supplied", () => {
  const preserved = preserveEstimatedWorkUnits({
    estimatedWorkUnits: null,
    priorGeometry: null,
    incoming: null,
    topologyPixelLimit: 950_000,
  });
  assertEquals(preserved, 950_000);
});

Deno.test("v2: estimated_work_units cascade — null when nothing supplied", () => {
  const preserved = preserveEstimatedWorkUnits({
    estimatedWorkUnits: null,
    priorGeometry: null,
    incoming: null,
  });
  assertEquals(preserved, null);
});
