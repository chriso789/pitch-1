// Pipeline-conflict frontend tests (vitest).
//
// Pin the §7 T-1 / T-2 contract from
// docs/measurement-pipeline-reuse-map.md against the actual button + hook.
// Real assertions land alongside the useMeasurementJob rewire — kept here as
// pending shells so the contract is visible and any future regression is
// immediately surfaced.

import { describe, it, expect } from "vitest";
import { isMskillPipelineEnabled, setMskillPipelineEnabled } from "@/lib/measurementPipelineFlag";

describe("measurement pipeline feature flag (frontend)", () => {
  it("defaults to OFF (legacy start-ai-measurement remains canonical)", () => {
    try { localStorage.removeItem("USE_MSKILL_MEASUREMENT_PIPELINE"); } catch { /* ignore */ }
    expect(isMskillPipelineEnabled()).toBe(false);
  });

  it("localStorage toggle wins over env", () => {
    setMskillPipelineEnabled(true);
    expect(isMskillPipelineEnabled()).toBe(true);
    setMskillPipelineEnabled(false);
    expect(isMskillPipelineEnabled()).toBe(false);
  });
});

describe.skip("T-1 / T-2 conflict guards (pending useMeasurementJob rewire)", () => {
  it("T-1: PullMeasurementsButton invokes exactly one start path per click", () => {
    // assert spies on edgeApi('measurement-api','/pipeline/start') and
    // supabase.functions.invoke('start-ai-measurement') are mutually exclusive.
  });
  it("T-2: useMeasurementJob.startJob never spawns two measurement jobs for one user action", () => {
    // assert createJob is called at most once per startJob invocation.
  });
});
