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

// --- T-4a / T-5a / T-6a / T-8 / T-9 conflict-lock assertions ---------------
// Promoted from "pending" to live assertions by docs/measurement-conflict-lock.md.

import {
  evaluateExportReportGate,
  evaluateFinalWriter,
  evaluateWrappedHelperCall,
} from "../../_shared/mskill/writer-guard.ts";
import { buildRouteProvenance } from "../../_shared/mskill/provenance.ts";

function withFlag(value: string | undefined, fn: () => void) {
  const prev = Deno.env.get("USE_MSKILL_MEASUREMENT_PIPELINE");
  if (value === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
  else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", value);
  try { fn(); } finally {
    if (prev === undefined) Deno.env.delete("USE_MSKILL_MEASUREMENT_PIPELINE");
    else Deno.env.set("USE_MSKILL_MEASUREMENT_PIPELINE", prev);
  }
}

Deno.test("T-4a: measure-roof blocked from final write when flag ON", () => {
  withFlag("true", () => {
    const r = evaluateFinalWriter({ writer: "measure-roof", legacy_forced: false });
    assertEquals(r.allowed, false);
    if (!r.allowed) assertEquals(r.code, "final_writer_blocked");
  });
});

Deno.test("T-4a: measure blocked from final write when flag ON", () => {
  withFlag("true", () => {
    const r = evaluateFinalWriter({ writer: "measure", legacy_forced: false });
    assertEquals(r.allowed, false);
  });
});

Deno.test("T-4a: measure-roof allowed when flag OFF (legacy behavior preserved)", () => {
  withFlag("false", () => {
    const r = evaluateFinalWriter({ writer: "measure-roof", legacy_forced: false });
    assertEquals(r.allowed, true);
  });
});

Deno.test("T-4a: bridge write rejected when provenance is non-canonical", () => {
  withFlag("true", () => {
    const r = evaluateFinalWriter({
      writer: "bridgeSkillReportToRoofMeasurements",
      legacy_forced: false,
      provenance: { canonical_measurement_route: false, legacy_artifact: true },
    });
    assertEquals(r.allowed, false);
  });
});

Deno.test("T-4a: bridge write allowed with canonical provenance", () => {
  withFlag("true", () => {
    const prov = buildRouteProvenance({
      source_module: "_shared/mskill/bridge.ts",
      source_function: "bridgeSkillReportToRoofMeasurements",
      measurement_request_id: "00000000-0000-0000-0000-000000000001",
      request_hash: "abc",
      mskill_job_id: "00000000-0000-0000-0000-000000000002",
    });
    const r = evaluateFinalWriter({
      writer: "bridgeSkillReportToRoofMeasurements",
      legacy_forced: false,
      provenance: prov,
    });
    assertEquals(r.allowed, true);
  });
});

Deno.test("T-4a: legacy writer requires ?legacy=1 when flag ON", () => {
  withFlag("true", () => {
    const blocked = evaluateFinalWriter({
      writer: "start-ai-measurement/index.legacy.ts",
      legacy_forced: false,
    });
    assertEquals(blocked.allowed, false);
    const allowed = evaluateFinalWriter({
      writer: "start-ai-measurement/index.legacy.ts",
      legacy_forced: true,
    });
    assertEquals(allowed.allowed, true);
  });
});

Deno.test("T-5a: render-measurement-pdf blocked without export_report run when flag ON", () => {
  withFlag("true", () => {
    const r = evaluateExportReportGate({
      renderer: "render-measurement-pdf",
      legacy_forced: false,
    });
    assertEquals(r.allowed, false);
    if (!r.allowed) assertEquals(r.code, "export_report_missing");
  });
});

Deno.test("T-5a: render blocked when export_report run not completed", () => {
  withFlag("true", () => {
    const r = evaluateExportReportGate({
      renderer: "render-measurement-pdf",
      legacy_forced: false,
      export_report_run_id: "run-1",
      export_report_run_status: "running",
    });
    assertEquals(r.allowed, false);
  });
});

Deno.test("T-5a: render allowed with completed export_report run", () => {
  withFlag("true", () => {
    const r = evaluateExportReportGate({
      renderer: "render-measurement-pdf",
      legacy_forced: false,
      export_report_run_id: "run-1",
      export_report_run_status: "completed",
    });
    assertEquals(r.allowed, true);
  });
});

Deno.test("T-6a: wrapped helper blocked outside a skill run when flag ON", () => {
  withFlag("true", () => {
    const r = evaluateWrappedHelperCall({
      helper: "_shared/perimeter-refinement.ts",
      legacy_forced: false,
    });
    assertEquals(r.allowed, false);
    if (!r.allowed) assertEquals(r.code, "helper_not_wrapped");
  });
});

Deno.test("T-6a: wrapped helper allowed inside a skill run", () => {
  withFlag("true", () => {
    const r = evaluateWrappedHelperCall({
      helper: "_shared/ridge-clustering.ts",
      legacy_forced: false,
      skill_run_id: "run-x",
    });
    assertEquals(r.allowed, true);
  });
});

Deno.test("T-8: buildRouteProvenance throws on missing required field", () => {
  let threw = false;
  try {
    buildRouteProvenance({
      source_module: "",
      source_function: "fn",
      measurement_request_id: "req",
      request_hash: "h",
      mskill_job_id: "job",
    });
  } catch { threw = true; }
  assert(threw, "missing source_module must throw");
});

Deno.test("T-8: buildRouteProvenance stamps legacy defaults correctly", () => {
  const p = buildRouteProvenance({
    source_module: "x.ts",
    source_function: "f",
    measurement_request_id: "req",
    request_hash: "h",
    mskill_job_id: "job",
    legacy_artifact: true,
  });
  assertEquals(p.legacy_artifact, true);
  assertEquals(p.wrapped_by_skill, false);
  assertEquals(p.canonical_measurement_route, false);
  assertEquals(p.route_warning, "legacy_noncanonical_measurement_path");
});

Deno.test({
  name: "T-9: duplicate bridge writes for the same measurement_job_id collapse (DB-level, pending migration)",
  ignore: true,
  fn: () => { /* enforced by future unique index on (measurement_job_id, mskill_job_id) */ },
});
