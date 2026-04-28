/**
 * Adapter: existing RoofOverlaySchema -> patent-aligned PatentRoofModel.
 *
 * The existing schema is a flat polygon + features list. The patent model
 * requires explicit Layer 1 (perimeter polylines per plane) and Layer 2
 * (structural lines, with overlap references). This adapter performs the
 * minimal restructuring without losing data, so existing measurements can
 * be rendered through the new patent-aligned report and override engine.
 */

import { quickSquare } from "./slopeFactor";
import type {
  PatentRoofModel,
  PerimeterPolyline,
  StructuralLine,
} from "@/types/roofMeasurementPatent";
import type { RoofOverlaySchema, RoofMeasurementData } from "@/types/roofMeasurement";

function mkId(prefix: string, i: number) {
  return `${prefix}-${i.toString().padStart(3, "0")}`;
}

export function overlayToPatentModel(
  overlay: RoofOverlaySchema,
  measurement?: RoofMeasurementData | null,
): PatentRoofModel {
  // Layer 1: split the polygon into edge polylines (one per polygon edge).
  const layer1_perimeter: PerimeterPolyline[] = [];
  const poly = overlay.polygon ?? [];
  const mpp = overlay.image.meters_per_pixel || 0;
  const pxToFt = mpp * 3.28084;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    layer1_perimeter.push({
      id: mkId("p", i),
      plane: "A", // Single-plane fallback when facets unknown.
      points: [a, b],
      length_ft: lengthPx * pxToFt,
      attribute: "perimeter",
    });
  }

  const cleanedFeatures = (() => {
    const features = overlay.features ?? [];
    const syntheticRidges = features.filter(
      (f) => f.type === "ridge" && ["filled_perimeter", "solar_dsm_inferred_ridge"].includes(String((f as any).source || "")),
    );
    if (syntheticRidges.length <= 1) return features;
    const keep = syntheticRidges.reduce((best, f) =>
      (f.length_ft ?? 0) > (best.length_ft ?? 0) ? f : best,
    );
    return features.filter((f) => {
      const isSyntheticRidge = f.type === "ridge" && ["filled_perimeter", "solar_dsm_inferred_ridge"].includes(String((f as any).source || ""));
      return !isSyntheticRidge || f === keep;
    });
  })();

  // Layer 2: every existing feature becomes a structural line. Eaves/rakes
  // are flagged as overlapping the corresponding Layer 1 segment when their
  // endpoints are colinear with a perimeter edge (within 2px).
  const layer2_structural: StructuralLine[] = cleanedFeatures.map(
    (f, i) => {
      const dx = f.p2[0] - f.p1[0];
      const dy = f.p2[1] - f.p1[1];
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      const lengthFt = f.length_ft ?? lengthPx * pxToFt;

      let overlapsLayer1Id: string | null = null;
      if (f.type === "eave" || f.type === "rake") {
        // Find a Layer 1 segment whose endpoints match (within tolerance).
        for (const p of layer1_perimeter) {
          const [pa, pb] = p.points;
          const close = (u: [number, number], v: [number, number]) =>
            Math.hypot(u[0] - v[0], u[1] - v[1]) < 3;
          if (
            (close(pa, f.p1) && close(pb, f.p2)) ||
            (close(pa, f.p2) && close(pb, f.p1))
          ) {
            overlapsLayer1Id = p.id;
            break;
          }
        }
      }

      return {
        id: mkId("s", i),
        type: f.type,
        points: [f.p1, f.p2],
        length_ft: lengthFt,
        overlapsLayer1Id,
        confidence: f.confidence,
        source: (f.source as StructuralLine["source"]) ?? "unet",
      };
    },
  );

  const footprint = measurement?.measurements?.area_sqft ?? 0;
  const pitch = measurement?.measurements?.predominant_pitch ?? 0;
  const qs = quickSquare(footprint, pitch);

  const planes = [
    {
      label: "A",
      pitch,
      plan_area_sqft: footprint,
      roof_area_sqft: qs.roof_area_sqft,
      perimeter_ids: layer1_perimeter.map((p) => p.id),
    },
  ];

  const lengths = {
    perimeter: layer1_perimeter.reduce((s, p) => s + p.length_ft, 0),
    ridge: 0,
    hip: 0,
    valley: 0,
    eave: 0,
    rake: 0,
  };
  for (const s of layer2_structural) lengths[s.type] += s.length_ft;

  return {
    version: "patent-v1",
    image: overlay.image,
    layer1_perimeter,
    layer2_structural,
    planes,
    totals: {
      footprint_sqft: footprint,
      roof_area_sqft: qs.roof_area_sqft,
      roofing_squares: qs.roofing_squares,
      predominant_pitch: pitch,
      slope_factor: qs.slope_factor,
      lengths_ft: lengths,
    },
    // Honor server-side imagery QC. Never hard-code passed: true — the
    // server is the source of truth for whether the report is publishable.
    imagery_qc: ((): { passed: boolean; abnormalities: string[]; reshoot_requested: boolean } => {
      const m = (measurement as any) || {};
      const serverQc = m.imagery_qc || m.quality_checks?.imagery_qc;
      if (serverQc && typeof serverQc === "object") {
        return {
          passed: !!serverQc.passed,
          abnormalities: Array.isArray(serverQc.abnormalities) ? serverQc.abnormalities : [],
          reshoot_requested: !!serverQc.reshoot_requested,
        };
      }
      const blocked = !!(m.report_blocked || m.needs_review);
      const score = typeof m.overall_score === "number" ? m.overall_score : null;
      const passed = !blocked && (score == null || score >= 0.65);
      return {
        passed,
        abnormalities: blocked
          ? [m.blocked_reason || "needs_review"]
          : score != null && score < 0.65
            ? ["low_overall_score"]
            : [],
        reshoot_requested: false,
      };
    })(),
  };
}
