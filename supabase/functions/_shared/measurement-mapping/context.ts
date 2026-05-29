// Builds the scoped formula-evaluation context from normalized segments + features.
// Hard policy:
//  - When a class has zero (non-archived) segments, its area_sqft is UNAVAILABLE (sentinel),
//    NOT 0. This prevents formulas like `class.flat.area_sqft * 1.10` from silently
//    producing 0 line quantities when the import had no flat evidence.
//  - global.roof.total_sqft is the SUM of segment areas (never inflated by classes).

import type {
  ClassBucket,
  MeasurementFeature,
  MeasurementSegment,
  ScopedContext,
  SurfaceClass,
} from "./types.ts";
import { UNAVAILABLE } from "./types.ts";

const SURFACE_CLASSES: SurfaceClass[] = ["flat", "low_slope", "sloped", "other", "unknown"];

const FEATURE_LENGTH_KEYS: Record<string, string> = {
  ridge: "ridge_ft",
  hip: "hip_ft",
  valley: "valley_ft",
  eave: "eave_ft",
  rake: "rake_ft",
  drip_edge: "drip_edge_ft",
  step_flashing: "step_flashing_ft",
  wall_flashing: "wall_flashing_ft",
  parapet: "parapet_ft",
  gutter: "gutter_ft",
  downspout: "downspout_ft",
};
const FEATURE_COUNT_KEYS: Record<string, string> = {
  drain: "drain_count",
  pipe_boot: "pipe_boot_count",
  vent: "vent_count",
  skylight: "skylight_count",
  chimney: "chimney_count",
};

function emptyBucket(): ClassBucket {
  return {
    area_sqft: UNAVAILABLE,
    squares: UNAVAILABLE,
    segment_count: 0,
    avg_confidence: 0,
  };
}

export function buildScopedContext(
  segments: MeasurementSegment[],
  features: MeasurementFeature[],
): ScopedContext {
  const liveSegments = segments.filter((s) => s.archived_at == null);
  const liveFeatures = features.filter((f) => f.archived_at == null);

  const classBuckets = Object.fromEntries(
    SURFACE_CLASSES.map((c) => [c, emptyBucket()]),
  ) as Record<SurfaceClass, ClassBucket>;

  const classAreaSums: Record<SurfaceClass, number> = {
    flat: 0, low_slope: 0, sloped: 0, other: 0, unknown: 0,
  };
  const classCounts: Record<SurfaceClass, number> = {
    flat: 0, low_slope: 0, sloped: 0, other: 0, unknown: 0,
  };
  const classConfSums: Record<SurfaceClass, number> = {
    flat: 0, low_slope: 0, sloped: 0, other: 0, unknown: 0,
  };

  for (const seg of liveSegments) {
    const cls = seg.surface_class;
    const area = Number(seg.area_sqft ?? 0);
    classAreaSums[cls] += area;
    classCounts[cls] += 1;
    classConfSums[cls] += Number(seg.classification_confidence ?? 0);
  }

  for (const cls of SURFACE_CLASSES) {
    if (classCounts[cls] > 0) {
      classBuckets[cls] = {
        area_sqft: classAreaSums[cls],
        squares: classAreaSums[cls] / 100,
        segment_count: classCounts[cls],
        avg_confidence: classConfSums[cls] / classCounts[cls],
      };
    }
  }

  const featureTotals: Record<string, number> = {};
  for (const f of liveFeatures) {
    const lenKey = FEATURE_LENGTH_KEYS[f.feature_type];
    if (lenKey && f.length_ft != null) {
      featureTotals[lenKey] = (featureTotals[lenKey] ?? 0) + Number(f.length_ft);
    }
    const countKey = FEATURE_COUNT_KEYS[f.feature_type];
    if (countKey && f.count_value != null) {
      featureTotals[countKey] = (featureTotals[countKey] ?? 0) + Number(f.count_value);
    }
  }

  const totalArea = SURFACE_CLASSES.reduce((sum, c) => sum + classAreaSums[c], 0);
  const nonUnknownWithData =
    (classCounts.flat > 0 ? 1 : 0) +
    (classCounts.low_slope > 0 ? 1 : 0) +
    (classCounts.sloped > 0 ? 1 : 0);
  const hasClassSplit = nonUnknownWithData >= 1;
  const aggregateOnly =
    liveSegments.length > 0 &&
    liveSegments.every((s) => s.surface_class === "unknown" && s.pitch_scope !== "segment");

  return {
    global: {
      roof: {
        total_sqft: totalArea,
        squares: totalArea / 100,
      },
      features: featureTotals,
    },
    class: classBuckets,
    section: {}, // Phase 1: per-section breakdowns are not produced yet.
    meta: {
      has_class_split: hasClassSplit,
      aggregate_only: aggregateOnly,
      total_segments: liveSegments.length,
      total_features: liveFeatures.length,
    },
  };
}
