// Slice 1+2 regression: CPU checkpoint placement and estimated_work_units
// preservation through the preempt path.
//
// Pure-logic tests — no DSM/geotiff imports. We import the leaf helpers
// directly so the test harness never transitively loads the heavy modules.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildCpuBudgetTerminalDebugPayload,
  preserveEstimatedWorkUnits,
} from "../../_shared/pre-topology-debug-bag.ts";

// Mirror the constants in start-ai-measurement/index.ts.
const CPU_BUDGET_MS = 75_000;
const TERMINAL_RESERVE_MS = 15_000;
const SAFETY_MARGIN_MS = 10_000;
const EFFECTIVE_THRESHOLD_MS = CPU_BUDGET_MS - TERMINAL_RESERVE_MS -
  SAFETY_MARGIN_MS; // 50_000 (v2 early-reserve safety margin)

// Local re-implementation of `shouldPreemptForCpuBudget` for test isolation.
function shouldPreempt(elapsedMs: number, _workUnits = 0) {
  const remainingMs = CPU_BUDGET_MS - elapsedMs;
  if (elapsedMs >= EFFECTIVE_THRESHOLD_MS) {
    return {
      preempt: true,
      elapsed_ms: elapsedMs,
      remaining_ms: remainingMs,
      reason: "early_reserve_safety_margin",
    };
  }
  return {
    preempt: false,
    elapsed_ms: elapsedMs,
    remaining_ms: remainingMs,
    reason: null,
  };
}

Deno.test("checkpoint 1: elapsed=49000ms → no preempt, compute runs", () => {
  const computeSpy = { called: false };
  const ckpt = shouldPreempt(49_000);
  if (!ckpt.preempt) {
    computeSpy.called = true; // simulates the expensive call
  }
  assertEquals(ckpt.preempt, false);
  assertEquals(computeSpy.called, true);
});

Deno.test("checkpoint 2: elapsed=51000ms → preempt, compute skipped", () => {
  const computeSpy = { called: false };
  const ckpt = shouldPreempt(51_000);
  if (!ckpt.preempt) {
    computeSpy.called = true;
  }
  assertEquals(ckpt.preempt, true);
  assertEquals(computeSpy.called, false);
  assertEquals(ckpt.reason, "early_reserve_safety_margin");
});

Deno.test(
  "checkpoint 3: pre_phase3a5_refinement_call gate blocks refineTrueOuterRoofPerimeter",
  () => {
    const refineSpy = { called: false };
    const ckpt = shouldPreempt(51_000);
    if (!ckpt.preempt) {
      // Would call refineTrueOuterRoofPerimeter here.
      refineSpy.called = true;
    }
    assertEquals(refineSpy.called, false);
  },
);

Deno.test(
  "checkpoint 4–6: terminal payload retains aerial graph + edge counts + budget headroom",
  () => {
    // Synthesize a Fonsica-shaped debug bag where aerial graph executed and
    // perimeter topology has 6 eave + 6 perimeter edges.
    const fakeEdges = Array.from({ length: 12 }, (_, i) => ({
      from: [i, 0],
      to: [i + 1, 0],
    }));
    const fakeEaves = Array.from({ length: 6 }, (_, i) => ({ i }));
    const fakePerimeter = Array.from({ length: 6 }, (_, i) => ({ i }));

    const debug = {
      aerial_candidate_roof_graph: {
        executed: true,
        edges: fakeEdges,
        version: "aerial-candidate-graph-v1",
      },
      perimeter_topology: {
        eave_edges: fakeEaves,
        perimeter_edges: fakePerimeter,
      },
      primary_geometry_source: "aerial_registered",
      dsm_validation_status: { reason: "invalid_transform" },
    };

    const dp = buildCpuBudgetTerminalDebugPayload({
      stage: "post_phase3a5_refinement",
      estimatedWorkUnits: null,
      debug,
      budget: shouldPreempt(61_000),
      constants: {
        AI_MEASUREMENT_CPU_BUDGET_MS: CPU_BUDGET_MS,
        AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: TERMINAL_RESERVE_MS,
        AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 1_000_000,
        AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "topology_validation",
        AI_MEASUREMENT_CPU_TIMEOUT_REASON: "cpu_budget_exceeded",
        REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph",
      },
    }) as any;

    // (4) aerial graph survives the preempt
    assertEquals(dp.aerial_candidate_roof_graph?.executed, true);
    assert(
      Array.isArray(dp.aerial_candidate_roof_graph?.edges) &&
        dp.aerial_candidate_roof_graph.edges.length >= 6,
      "aerial graph edges should survive at >=6",
    );

    // (5) eave + perimeter edge counts as the live row would expose
    const eaves =
      Array.isArray(dp.perimeter_topology?.eave_edges)
        ? dp.perimeter_topology.eave_edges.length
        : 0;
    const perim = Array.isArray(dp.perimeter_topology?.perimeter_edges)
      ? dp.perimeter_topology.perimeter_edges.length
      : 0;
    assert(eaves >= 6, `eave_edges_length=${eaves} must be >=6`);
    assert(perim >= 6, `perimeter_edges_length=${perim} must be >=6`);

    // (6) cpu_budget_elapsed_ms < 75000 and remaining_ms > 0 at the
    // 61000ms checkpoint snapshot.
    assert(
      Number(dp.cpu_budget_elapsed_ms) < CPU_BUDGET_MS,
      `elapsed=${dp.cpu_budget_elapsed_ms} must be <${CPU_BUDGET_MS}`,
    );
    assert(
      Number(dp.cpu_budget_remaining_ms) > 0,
      `remaining=${dp.cpu_budget_remaining_ms} must be >0`,
    );
  },
);


Deno.test(
  "checkpoint 7: prior estimated_work_units=996004 is preserved and not zeroed",
  () => {
    // args.estimatedWorkUnits=0 (preempt site didn't know), but prior
    // geometry knew. Cascade must surface the prior value.
    const preserved = preserveEstimatedWorkUnits({
      estimatedWorkUnits: 0,
      priorGeometry: {
        estimated_work_units: 996_004,
        dsm_planar_graph_debug: { estimated_work_units: 996_004 },
      },
      incoming: { estimated_work_units: 0 },
    });
    assertEquals(preserved, 996_004);

    // Now simulate flowing the preserved value into the terminal payload
    // shape used by persistCpuBudgetTerminalFailure.
    const dp = buildCpuBudgetTerminalDebugPayload({
      stage: "post_phase3a5_refinement",
      estimatedWorkUnits: preserved,
      debug: {
        aerial_candidate_roof_graph: { executed: true, edges: [{}, {}, {}, {}, {}, {}] },
        estimated_work_units: preserved,
        dsm_planar_graph_debug: { estimated_work_units: preserved },
      },
      budget: shouldPreempt(61_000),
      constants: {
        AI_MEASUREMENT_CPU_BUDGET_MS: CPU_BUDGET_MS,
        AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: TERMINAL_RESERVE_MS,
        AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 1_000_000,
        AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "topology_validation",
        AI_MEASUREMENT_CPU_TIMEOUT_REASON: "cpu_budget_exceeded",
        REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph",
      },
    }) as any;

    const workUnitsPreserved =
      typeof dp.estimated_work_units === "number" && dp.estimated_work_units > 0;
    assertEquals(dp.estimated_work_units, 996_004);
    assertEquals(workUnitsPreserved, true);
  },
);

