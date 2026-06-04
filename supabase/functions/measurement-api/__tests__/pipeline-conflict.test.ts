// Pipeline-conflict regression tests (Deno).
//
// These tests are SCAFFOLDS that pin the §7 contract from
// docs/measurement-pipeline-reuse-map.md. They run in the default "flag OFF"
// baseline and assert that no duplicate writer or double-route scenario can
// silently slip through. They will be expanded with the actual implementation
// of measurement-api POST /pipeline/start and the start-ai-measurement shim.
//
// T-1 through T-7 map 1:1 to the reuse-map §7 contract.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isMskillPipelineEnabled,
  pipelineRouteDecision,
} from "../../_shared/mskill/feature-flag.ts";

// --- Flag baseline ---------------------------------------------------------

Deno.test("flag defaults to OFF when env var unset", () => {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
  try {
    assertEquals(isMskillPipelineEnabled(), false, "default must remain legacy");
  } finally {
    if (prev !== undefined) Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
});

Deno.test("flag respects truthy env values", () => {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  try {
    for (const v of ["true", "1", "yes", "ON"]) {
      Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", v);
      assertEquals(isMskillPipelineEnabled(), true, `value "${v}" must enable`);
    }
    for (const v of ["false", "0", "no", "off", ""]) {
      Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", v);
      assertEquals(isMskillPipelineEnabled(), false, `value "${v}" must disable`);
    }
  } finally {
    if (prev === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
    else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
});

// --- T-3: ?legacy=1 escape hatch overrides flag ----------------------------

Deno.test("T-3: ?legacy=1 forces legacy regardless of flag state", () => {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", "true");
  try {
    const req = new Request("https://example.test/start-ai-measurement?legacy=1", { method: "POST" });
    const decision = pipelineRouteDecision(req);
    assertEquals(decision.use_mskill, false);
    assertEquals(decision.legacy_forced, true);
    assert(decision.reason.includes("legacy=1"));
  } finally {
    if (prev === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
    else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
});

Deno.test("T-3: flag ON without ?legacy=1 routes to mskill", () => {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", "true");
  try {
    const req = new Request("https://example.test/start-ai-measurement", { method: "POST" });
    const decision = pipelineRouteDecision(req);
    assertEquals(decision.use_mskill, true);
    assertEquals(decision.legacy_forced, false);
  } finally {
    if (prev === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
    else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
});

Deno.test("T-3: flag OFF without ?legacy=1 stays legacy", () => {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", "false");
  try {
    const req = new Request("https://example.test/start-ai-measurement", { method: "POST" });
    const decision = pipelineRouteDecision(req);
    assertEquals(decision.use_mskill, false);
    assertEquals(decision.legacy_forced, false);
  } finally {
    if (prev === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
    else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
});

// --- T-4 / T-5 / T-6 contract assertions -----------------------------------
// These are intentionally documented-but-not-yet-asserted. They will become
// real DB-level assertions once the orchestrator route + shim ship. Keeping
// them as Deno.test placeholders ensures `supabase test` surfaces the contract
// and that a missing implementation is visible (skipped/ignored, not silently
// absent).

Deno.test({
  name: "T-4: measure-roof cannot write final roof_measurements when flag ON (pending implementation)",
  ignore: true,
  fn: () => { /* will assert canonical_measurement_route stamp absence path is blocked */ },
});

Deno.test({
  name: "T-5: render-measurement-pdf refuses canonical render without export_report artifact (pending)",
  ignore: true,
  fn: () => { /* will assert 409 export_report_missing */ },
});

Deno.test({
  name: "T-6: legacy helpers cannot write mskill_artifacts outside a mskill_runs row (pending)",
  ignore: true,
  fn: () => { /* will assert FK / trigger blocks orphan artifacts */ },
});
