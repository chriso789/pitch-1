// supabase/functions/_shared/mskill/writer-guard.ts
//
// Conflict-lock guards for the mskill measurement pipeline.
// See docs/measurement-conflict-lock.md §2 (single-writer rule) and §4 (tests).
//
// Guards fail closed: when the flag is ON, any legacy write to
// roof_measurements that lacks a canonical mskill provenance stamp is
// rejected with a structured error. The caller is expected to abort the
// request (typically with HTTP 409) and surface the reason.
//
// These helpers are pure (no Supabase client). The orchestrator and legacy
// shims wire them in at their final-write call sites.

import { isMskillPipelineEnabled } from "./feature-flag.ts";
import { isCanonicalProvenance, type RouteProvenance } from "./provenance.ts";

export type FinalWriterContext = {
  /** Function name attempting the write, e.g. "measure-roof". */
  writer: string;
  /** True when the request explicitly opted into legacy via ?legacy=1. */
  legacy_forced: boolean;
  /** Provenance the writer intends to stamp on the row. */
  provenance?: Partial<RouteProvenance> | null;
  /** Set when the writer is the override path (always allowed). */
  is_override_path?: boolean;
};

export type GuardResult =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };

const CANONICAL_FINAL_WRITERS = new Set<string>([
  "bridgeSkillReportToRoofMeasurements",
  "recalculate-measurement-from-overrides",
  "start-ai-measurement/index.legacy.ts",
]);

/**
 * Decide whether `ctx.writer` is allowed to insert/update `roof_measurements`
 * given the current pipeline flag and the request's legacy escape hatch.
 */
export function evaluateFinalWriter(ctx: FinalWriterContext): GuardResult {
  if (ctx.is_override_path) return { allowed: true };

  const flagOn = isMskillPipelineEnabled();

  // Flag OFF: legacy behavior is unchanged.
  if (!flagOn) return { allowed: true };

  // Flag ON: only the canonical bridge, override path, or explicit legacy
  // escape hatch may write final rows.
  if (CANONICAL_FINAL_WRITERS.has(ctx.writer)) {
    if (ctx.writer === "start-ai-measurement/index.legacy.ts" && !ctx.legacy_forced) {
      return {
        allowed: false,
        code: "final_writer_blocked",
        reason: "legacy writer requires ?legacy=1 when mskill pipeline is enabled",
      };
    }
    if (ctx.writer === "bridgeSkillReportToRoofMeasurements"
        && !isCanonicalProvenance(ctx.provenance)) {
      return {
        allowed: false,
        code: "final_writer_blocked",
        reason: "bridge write missing canonical mskill provenance stamp",
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "final_writer_blocked",
    reason: `writer ${ctx.writer} is not permitted to write roof_measurements in mskill mode`,
  };
}

/** Throwing variant — preferred at the actual insert/update call site. */
export function assertFinalWriterAllowed(ctx: FinalWriterContext): void {
  const r = evaluateFinalWriter(ctx);
  if (!r.allowed) {
    const err = new Error(`[mskill/writer-guard] ${r.code}: ${r.reason}`);
    (err as Error & { code?: string }).code = r.code;
    throw err;
  }
}

// --- Export-report gate (T-5a) --------------------------------------------

export type ExportReportContext = {
  /** Function attempting the render. */
  renderer: string;
  /** mskill_runs.id of the export_report run that authorized this render. */
  export_report_run_id?: string | null;
  /** mskill_runs.status; must be 'completed' to authorize. */
  export_report_run_status?: string | null;
  /** True when invoked with ?legacy=1. */
  legacy_forced: boolean;
};

export function evaluateExportReportGate(ctx: ExportReportContext): GuardResult {
  if (ctx.legacy_forced) return { allowed: true };
  if (!isMskillPipelineEnabled()) return { allowed: true };
  if (!ctx.export_report_run_id) {
    return {
      allowed: false,
      code: "export_report_missing",
      reason: `${ctx.renderer} requires export_report_run_id when mskill pipeline is enabled`,
    };
  }
  if (ctx.export_report_run_status !== "completed") {
    return {
      allowed: false,
      code: "export_report_missing",
      reason: `export_report run ${ctx.export_report_run_id} is not completed (got ${ctx.export_report_run_status ?? "null"})`,
    };
  }
  return { allowed: true };
}

export function assertExportReportGate(ctx: ExportReportContext): void {
  const r = evaluateExportReportGate(ctx);
  if (!r.allowed) {
    const err = new Error(`[mskill/writer-guard] ${r.code}: ${r.reason}`);
    (err as Error & { code?: string }).code = r.code;
    throw err;
  }
}

// --- Wrapped-helper gate (T-6a) -------------------------------------------

export type WrappedHelperContext = {
  /** Helper module path, e.g. "_shared/perimeter-refinement.ts". */
  helper: string;
  /** mskill_runs.id of the open skill run that wraps this call. */
  skill_run_id?: string | null;
  /** True when invoked from legacy path (?legacy=1 or flag OFF). */
  legacy_forced: boolean;
};

export function evaluateWrappedHelperCall(ctx: WrappedHelperContext): GuardResult {
  if (ctx.legacy_forced) return { allowed: true };
  if (!isMskillPipelineEnabled()) return { allowed: true };
  if (!ctx.skill_run_id) {
    return {
      allowed: false,
      code: "helper_not_wrapped",
      reason: `${ctx.helper} must be called from inside a mskill_runs row when mskill pipeline is enabled`,
    };
  }
  return { allowed: true };
}

export function assertWrappedHelperCall(ctx: WrappedHelperContext): void {
  const r = evaluateWrappedHelperCall(ctx);
  if (!r.allowed) {
    const err = new Error(`[mskill/writer-guard] ${r.code}: ${r.reason}`);
    (err as Error & { code?: string }).code = r.code;
    throw err;
  }
}
