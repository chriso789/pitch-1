// Formula evaluator that understands the namespaced measurement context.
// Wraps expr-eval Parser.
//
// Path semantics:
//   global.roof.total_sqft     -> number
//   global.features.ridge_ft   -> number (default 0 when feature absent — these are aggregate)
//   class.flat.area_sqft       -> number OR throws MissingClassMeasurementError if UNAVAILABLE
//   class.flat.squares         -> same
//   section.<name>.<key>       -> number (Phase 1 returns 0; reserved)
//
// Legacy aliases preserved so existing templates keep working:
//   roof.total_sqft, roof.squares       -> global.roof.*
//   lf.eave, lf.ridge, lf.valley, ...   -> global.features.*_ft
//   pen.pipe_vent, pen.skylight, ...    -> global.features.*_count

import { Parser } from "npm:expr-eval@2.0.2";
import type { ScopedContext } from "./types.ts";
import { isUnavailable } from "./types.ts";

export class MissingClassMeasurementError extends Error {
  constructor(public readonly path: string, public readonly className: string) {
    super(`missing_class_measurement:${path}`);
    this.name = "MissingClassMeasurementError";
  }
}

const LEGACY_FEATURE_ALIASES: Record<string, string> = {
  "lf.eave": "eave_ft",
  "lf.eaves": "eave_ft",
  "lf.rake": "rake_ft",
  "lf.rakes": "rake_ft",
  "lf.ridge": "ridge_ft",
  "lf.ridges": "ridge_ft",
  "lf.hip": "hip_ft",
  "lf.hips": "hip_ft",
  "lf.valley": "valley_ft",
  "lf.valleys": "valley_ft",
  "lf.step": "step_flashing_ft",
  "lf.step_flashing": "step_flashing_ft",
  "lf.drip_edge": "drip_edge_ft",
  "pen.pipe_vent": "pipe_boot_count",
  "pen.pipe_vents": "pipe_boot_count",
  "pen.skylight": "skylight_count",
  "pen.chimney": "chimney_count",
  "pen.drain": "drain_count",
};

/**
 * Flattens the scoped context into a variable map usable by expr-eval.
 * UNAVAILABLE class metrics are intentionally NOT included so that referencing
 * them in a formula raises an evaluation error we can convert to a structured
 * missing_class_measurement assignment status.
 */
function flatten(ctx: ScopedContext): {
  vars: Record<string, number>;
  classAvailable: Record<string, boolean>;
} {
  const vars: Record<string, number> = {};
  const classAvailable: Record<string, boolean> = {};

  // global.*
  vars["global_roof_total_sqft"] = ctx.global.roof.total_sqft;
  vars["global_roof_squares"] = ctx.global.roof.squares;
  for (const [k, v] of Object.entries(ctx.global.features)) {
    vars[`global_features_${k}`] = v;
  }
  // legacy aliases
  vars["roof_total_sqft"] = ctx.global.roof.total_sqft;
  vars["roof_squares"] = ctx.global.roof.squares;
  for (const [legacyKey, featureKey] of Object.entries(LEGACY_FEATURE_ALIASES)) {
    const flatLegacy = legacyKey.replace(/\./g, "_");
    vars[flatLegacy] = ctx.global.features[featureKey] ?? 0;
  }

  // class.*
  for (const [cls, bucket] of Object.entries(ctx.class)) {
    const available = !isUnavailable(bucket.area_sqft);
    classAvailable[cls] = available;
    if (available) {
      vars[`class_${cls}_area_sqft`] = bucket.area_sqft as number;
      vars[`class_${cls}_squares`] = bucket.squares as number;
      vars[`class_${cls}_segment_count`] = bucket.segment_count;
    }
  }

  return { vars, classAvailable };
}

/**
 * Rewrites dotted formula paths into underscore-joined identifiers that expr-eval
 * accepts as variable names, then evaluates. Returns NaN-safe number or throws
 * MissingClassMeasurementError when a class.* path was referenced but unavailable.
 */
export function evaluateFormula(
  formula: string,
  ctx: ScopedContext,
): { value: number; rewritten: string } {
  const { vars, classAvailable } = flatten(ctx);

  // Detect class.<name>.<metric> references and validate availability BEFORE eval.
  const classRefs = Array.from(
    formula.matchAll(/\bclass\.(flat|low_slope|sloped|other|unknown)\.([a-z_]+)\b/g),
  );
  for (const [path, cls] of classRefs) {
    if (!classAvailable[cls]) {
      throw new MissingClassMeasurementError(path, cls);
    }
  }

  // Rewrite dotted paths to underscore identifiers (expr-eval can't parse dots in vars).
  const rewritten = formula.replace(
    /\b(global|class|section|roof|lf|pen)\.([a-z_]+)(?:\.([a-z_]+))?/g,
    (_m, ns, a, b) => {
      if (b) return `${ns}_${a}_${b}`;
      return `${ns}_${a}`;
    },
  );

  const parser = new Parser();
  const expr = parser.parse(rewritten);
  const result = expr.evaluate(vars);
  const value = typeof result === "number" && Number.isFinite(result) ? result : 0;
  return { value, rewritten };
}
