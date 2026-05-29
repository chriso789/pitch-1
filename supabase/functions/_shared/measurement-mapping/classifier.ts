// Deterministic surface-class classifier.
// Rules (locked Phase 1):
//   pitch < 2/12               -> flat
//   2/12 <= pitch < 4/12       -> low_slope
//   pitch >= 4/12              -> sloped
//   explicit provider flat     -> flat (beats pitch)
//   pitch unknown, no provider -> unknown (never invented)
//
// NEVER guess flat/sloped from missing data.

import type { SurfaceClass } from "./types.ts";

export interface ClassifierInput {
  pitch_rise_over_12?: number | null;
  pitch_scope?: "segment" | "global" | "none";
  provider_explicit_flat?: boolean;
  provider_membrane_indicator?: boolean;
}

export interface ClassifierOptions {
  low_slope_threshold?: number; // default 2
  sloped_threshold?: number;    // default 4
}

export interface ClassificationResult {
  surface_class: SurfaceClass;
  confidence: number;
  reason: string;
}

export function classifySurface(
  input: ClassifierInput,
  opts: ClassifierOptions = {},
): ClassificationResult {
  const lowSlope = opts.low_slope_threshold ?? 2;
  const slopedT = opts.sloped_threshold ?? 4;

  // 1. Explicit provider evidence wins.
  if (input.provider_explicit_flat === true || input.provider_membrane_indicator === true) {
    return {
      surface_class: "flat",
      confidence: 0.98,
      reason: input.provider_explicit_flat ? "provider_explicit_flat" : "provider_membrane_indicator",
    };
  }

  const pitch = input.pitch_rise_over_12;
  if (pitch == null || Number.isNaN(pitch)) {
    return { surface_class: "unknown", confidence: 0.25, reason: "no_pitch" };
  }

  const scopeBoost = input.pitch_scope === "segment" ? 0.3 : 0;

  if (pitch < lowSlope) {
    return {
      surface_class: "flat",
      confidence: 0.6 + scopeBoost,
      reason: `pitch_lt_${lowSlope}_12`,
    };
  }
  if (pitch < slopedT) {
    return {
      surface_class: "low_slope",
      confidence: 0.58 + scopeBoost,
      reason: `pitch_${lowSlope}_to_${slopedT}_12`,
    };
  }
  return {
    surface_class: "sloped",
    confidence: 0.62 + scopeBoost,
    reason: `pitch_ge_${slopedT}_12`,
  };
}
