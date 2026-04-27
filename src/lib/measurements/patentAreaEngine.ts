/**
 * Patent-aligned area recalculation engine.
 *
 * Implements the area-only override propagation from US 9,329,749 B2:
 *   "a user length field enabling a client with said interactive file to
 *    override at least one of said length numeric values, where said area
 *    operator may automatically recalculate area based on said length field
 *    override"
 *
 * SCOPE (per user instruction): area only. Overrides DO NOT cascade into
 * estimate line items or material takeoffs - those remain manually triggered.
 */

import { quickSquare, slopeFactor } from "./slopeFactor";
import type {
  PatentRoofModel,
  PerimeterPolyline,
  RoofPlane,
} from "@/types/roofMeasurementPatent";

/**
 * Effective length for a perimeter polyline, honoring user override.
 */
export function effectiveLengthFt(p: PerimeterPolyline): number {
  if (
    p.user_length_ft_override != null &&
    Number.isFinite(p.user_length_ft_override) &&
    p.user_length_ft_override > 0
  ) {
    return p.user_length_ft_override;
  }
  return p.length_ft;
}

/**
 * Recompute a single plane's plan area when one of its bounding perimeter
 * lengths is overridden.
 *
 * Strategy: scale the original plan area by the ratio of the new total
 * perimeter to the original total perimeter, applied along the same axis
 * proportion. This is the patent's "automatic area recalculation" - it does
 * NOT re-solve geometry from scratch, it scales the recorded area.
 */
export function recalcPlaneArea(
  plane: RoofPlane,
  perimeters: PerimeterPolyline[],
): RoofPlane {
  const bounding = perimeters.filter((p) => plane.perimeter_ids.includes(p.id));
  if (bounding.length === 0) return plane;

  const originalTotal = bounding.reduce((s, p) => s + p.length_ft, 0);
  const effectiveTotal = bounding.reduce((s, p) => s + effectiveLengthFt(p), 0);
  if (originalTotal <= 0) return plane;

  // Linear scale: area scales with the square of length ratio for similar
  // shapes. For partial overrides we apply the patent-literal proportional
  // recalculation (length ratio, not squared) to remain conservative and
  // match the "area operator" behavior shown in the patent's worked examples.
  const ratio = effectiveTotal / originalTotal;
  const newPlanArea = plane.plan_area_sqft * ratio;
  const newRoofArea = newPlanArea * slopeFactor(plane.pitch);

  return {
    ...plane,
    plan_area_sqft: newPlanArea,
    roof_area_sqft: newRoofArea,
  };
}

/**
 * Recompute totals across the entire model after any override or pitch edit.
 */
export function recalcModelTotals(model: PatentRoofModel): PatentRoofModel {
  const planes = model.planes.map((pl) =>
    recalcPlaneArea(pl, model.layer1_perimeter),
  );

  const footprint = planes.reduce((s, p) => s + p.plan_area_sqft, 0);
  const roofArea = planes.reduce((s, p) => s + p.roof_area_sqft, 0);

  // Predominant pitch = pitch of the plane with the largest plan area.
  const dominant = planes.reduce(
    (best, p) => (p.plan_area_sqft > (best?.plan_area_sqft ?? 0) ? p : best),
    planes[0],
  );
  const predominantPitch = dominant?.pitch ?? 0;
  const qs = quickSquare(footprint, predominantPitch);

  const lengths: Record<string, number> = {
    perimeter: 0,
    ridge: 0,
    hip: 0,
    valley: 0,
    eave: 0,
    rake: 0,
  };
  for (const p of model.layer1_perimeter) {
    lengths.perimeter += effectiveLengthFt(p);
  }
  for (const s of model.layer2_structural) {
    lengths[s.type] = (lengths[s.type] ?? 0) + s.length_ft;
  }

  return {
    ...model,
    planes,
    totals: {
      footprint_sqft: footprint,
      roof_area_sqft: roofArea,
      roofing_squares: qs.roofing_squares,
      predominant_pitch: predominantPitch,
      slope_factor: qs.slope_factor,
      lengths_ft: lengths as PatentRoofModel["totals"]["lengths_ft"],
    },
  };
}

/**
 * Apply a length override to a specific perimeter polyline and return a fully
 * recalculated model. This is the entry point used by the editable length
 * field UI.
 */
export function applyLengthOverride(
  model: PatentRoofModel,
  perimeterId: string,
  newLengthFt: number | null,
): PatentRoofModel {
  const layer1_perimeter = model.layer1_perimeter.map((p) =>
    p.id === perimeterId
      ? { ...p, user_length_ft_override: newLengthFt }
      : p,
  );
  return recalcModelTotals({ ...model, layer1_perimeter });
}
