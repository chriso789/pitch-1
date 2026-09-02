// Blueprint scale calibration and validation.
// Converts declared drawing scales to PDF-point conversion factors and can
// verify them against printed-dimension anchors before geometry is trusted.

import type { NormalizedScale } from "./blueprint-sheet-intelligence.ts";

export const BLUEPRINT_SCALE_CALIBRATION_VERSION = "blueprint-scale-calibration-v1";

export type ScaleCalibrationStatus =
  | "validated"
  | "declared_unverified"
  | "conflict"
  | "not_to_scale"
  | "missing";

export interface ScaleDimensionAnchor {
  known_feet: number;
  pdf_distance_points: number;
  source_text?: string | null;
  confidence?: number;
}

export interface ScaleCalibrationResult {
  version: string;
  status: ScaleCalibrationStatus;
  confidence: number;
  declared_scale: NormalizedScale | null;
  feet_per_pdf_point: number | null;
  pdf_points_per_foot: number | null;
  validation_error_pct: number | null;
  anchors_used: number;
  source: "dimension_validated" | "declared_scale" | "none";
  review_required: boolean;
  message: string;
}

export function scaleFeetPerPdfPoint(scale: NormalizedScale | null): number | null {
  if (!scale || scale.kind === "unknown" || scale.feet_per_paper_inch == null) return null;
  if (!Number.isFinite(scale.feet_per_paper_inch) || scale.feet_per_paper_inch <= 0) return null;
  return scale.feet_per_paper_inch / 72;
}

function weightedMean(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((v) => Number.isFinite(v.value) && v.value > 0 && Number.isFinite(v.weight) && v.weight > 0);
  if (!valid.length) return null;
  const weight = valid.reduce((sum, v) => sum + v.weight, 0);
  return valid.reduce((sum, v) => sum + v.value * v.weight, 0) / weight;
}

export function calibrateBlueprintScale(
  declaredScale: NormalizedScale | null,
  anchors: ScaleDimensionAnchor[] = [],
): ScaleCalibrationResult {
  if (!declaredScale) {
    return {
      version: BLUEPRINT_SCALE_CALIBRATION_VERSION,
      status: "missing",
      confidence: 0,
      declared_scale: null,
      feet_per_pdf_point: null,
      pdf_points_per_foot: null,
      validation_error_pct: null,
      anchors_used: 0,
      source: "none",
      review_required: true,
      message: "No usable drawing scale was detected for this viewport.",
    };
  }

  if (/\b(?:NTS|NOT\s+TO\s+SCALE)\b/i.test(declaredScale.raw)) {
    return {
      version: BLUEPRINT_SCALE_CALIBRATION_VERSION,
      status: "not_to_scale",
      confidence: 1,
      declared_scale: declaredScale,
      feet_per_pdf_point: null,
      pdf_points_per_foot: null,
      validation_error_pct: null,
      anchors_used: 0,
      source: "none",
      review_required: true,
      message: "Drawing is explicitly marked not to scale.",
    };
  }

  const nominal = scaleFeetPerPdfPoint(declaredScale);
  if (nominal == null) {
    return {
      version: BLUEPRINT_SCALE_CALIBRATION_VERSION,
      status: "missing",
      confidence: 0.1,
      declared_scale: declaredScale,
      feet_per_pdf_point: null,
      pdf_points_per_foot: null,
      validation_error_pct: null,
      anchors_used: 0,
      source: "none",
      review_required: true,
      message: "Scale text was detected but could not be converted into a real-world calibration.",
    };
  }

  const implied = anchors
    .filter((a) => a.known_feet > 0 && a.pdf_distance_points > 0)
    .map((a) => ({
      value: a.known_feet / a.pdf_distance_points,
      weight: Math.max(0.1, Math.min(1, a.confidence ?? 0.8)),
    }));
  const measured = weightedMean(implied);

  if (measured == null) {
    return {
      version: BLUEPRINT_SCALE_CALIBRATION_VERSION,
      status: "declared_unverified",
      confidence: 0.82,
      declared_scale: declaredScale,
      feet_per_pdf_point: nominal,
      pdf_points_per_foot: 1 / nominal,
      validation_error_pct: null,
      anchors_used: 0,
      source: "declared_scale",
      review_required: true,
      message: "Scale is mathematically usable but has not yet been validated against a printed dimension.",
    };
  }

  const errorPct = Math.abs(measured - nominal) / nominal * 100;
  const validated = errorPct <= 3;
  const conflict = errorPct > 7;
  const chosen = validated ? measured : nominal;

  return {
    version: BLUEPRINT_SCALE_CALIBRATION_VERSION,
    status: validated ? "validated" : conflict ? "conflict" : "declared_unverified",
    confidence: validated ? Math.max(0.9, 1 - errorPct / 100) : conflict ? 0.25 : 0.7,
    declared_scale: declaredScale,
    feet_per_pdf_point: conflict ? null : chosen,
    pdf_points_per_foot: conflict ? null : 1 / chosen,
    validation_error_pct: Number(errorPct.toFixed(3)),
    anchors_used: implied.length,
    source: validated ? "dimension_validated" : "declared_scale",
    review_required: !validated,
    message: validated
      ? `Scale validated against ${implied.length} printed dimension anchor(s) within ${errorPct.toFixed(2)}%.`
      : conflict
        ? `Declared scale conflicts with printed dimensions by ${errorPct.toFixed(2)}%; geometry conversion is blocked.`
        : `Scale differs from printed dimensions by ${errorPct.toFixed(2)}%; review is required before geometry is trusted.`,
  };
}
