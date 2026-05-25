/**
 * Aerial-Primary Gate
 * ────────────────────
 * Decides whether the run has enough registered-aerial geometry to proceed
 * as the PRIMARY measurement scaffold when DSM-tier validation is unavailable.
 *
 * Hierarchy this gate establishes:
 *   Primary    : registered aerial roof perimeter + aerial candidate graph
 *   Secondary  : Google Solar mask / solar segments
 *   Validation : DSM pitch / topology / ridges (optional, not fatal)
 *
 * Hard rules (DO NOT relax):
 *   - This gate NEVER unlocks `customer_report_ready`.
 *   - It only allows the row to land as `result_state="perimeter_only"`
 *     instead of `ai_failed_runtime` when DSM is the only thing missing.
 *   - Aerial-only edges feed `debug_roof_lines`, never typed `roof_lines`.
 *   - Customer-ready gate (typed roof_lines + valid pitch + topology
 *     validation + vendor benchmark) is unchanged.
 */

export interface AerialPrimacyInput {
  rasterUrl: string | null | undefined;
  geoToRasterTransform: unknown;
  rasterBoundsLatLng?: unknown;
  perimeterTopologySnapshot?: {
    perimeter_ring_px?: Array<[number, number] | { x: number; y: number }> | null;
    perimeter_ring_geo?: Array<[number, number] | { lat: number; lng: number }> | null;
    perimeter_vs_mask_iou?: number | null;
    target_mask_overlap_with_perimeter?: number | null;
  } | null | undefined;
  targetMaskIsolation?: {
    perimeter_vs_mask_iou?: number | null;
    target_mask_overlap?: number | null;
    target_mask_overlap_with_perimeter?: number | null;
  } | null | undefined;
  footprintSource: string | null | undefined;
}

export interface AerialPrimacyEvaluation {
  aerial_primary_ready: boolean;
  reasons: string[];
  perimeter_point_count: number;
  mask_iou: number | null;
  mask_overlap: number | null;
  footprint_source: string | null;
}

const FORBIDDEN_FOOTPRINT_SOURCES = new Set([
  "none",
  "unknown",
  "blocked_by_registration_gate",
  "blocked",
  "",
]);

function ringLen(r: unknown): number {
  return Array.isArray(r) ? r.length : 0;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function evaluateAerialPrimacy(
  args: AerialPrimacyInput,
): AerialPrimacyEvaluation {
  const reasons: string[] = [];

  const rasterOk = typeof args.rasterUrl === "string" && args.rasterUrl.length > 0;
  if (!rasterOk) reasons.push("missing_raster_url");

  const transformOk = args.geoToRasterTransform != null &&
    typeof args.geoToRasterTransform === "object";
  if (!transformOk) reasons.push("missing_geo_to_raster_transform");

  const perimPx = ringLen(args.perimeterTopologySnapshot?.perimeter_ring_px);
  const perimGeo = ringLen(args.perimeterTopologySnapshot?.perimeter_ring_geo);
  if (perimPx < 4) reasons.push("perimeter_ring_px_too_small");
  if (perimGeo < 4) reasons.push("perimeter_ring_geo_too_small");

  const iou = num(
    args.perimeterTopologySnapshot?.perimeter_vs_mask_iou ??
      args.targetMaskIsolation?.perimeter_vs_mask_iou,
  );
  const overlap = num(
    args.perimeterTopologySnapshot?.target_mask_overlap_with_perimeter ??
      args.targetMaskIsolation?.target_mask_overlap_with_perimeter ??
      args.targetMaskIsolation?.target_mask_overlap,
  );

  // Pass thresholds: IoU ≥ 0.75, OR IoU ≥ 0.70 when overlap ≥ 0.95
  let iouOk = false;
  if (iou != null) {
    if (iou >= 0.75) iouOk = true;
    else if (iou >= 0.70 && overlap != null && overlap >= 0.95) iouOk = true;
  }
  if (!iouOk) reasons.push("perimeter_vs_mask_iou_below_threshold");

  const source = typeof args.footprintSource === "string"
    ? args.footprintSource
    : "";
  const sourceOk = !FORBIDDEN_FOOTPRINT_SOURCES.has(source);
  if (!sourceOk) reasons.push("footprint_source_not_allowed");

  const aerial_primary_ready = rasterOk && transformOk &&
    perimPx >= 4 && perimGeo >= 4 && iouOk && sourceOk;

  return {
    aerial_primary_ready,
    reasons,
    perimeter_point_count: perimPx,
    mask_iou: iou,
    mask_overlap: overlap,
    footprint_source: source || null,
  };
}
