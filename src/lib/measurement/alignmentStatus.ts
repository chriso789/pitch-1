// ============================================================================
// alignmentStatus — pure helper that splits "displacement" into two distinct
// statuses for the Visual QA UI:
//
//   raster_overlay_displacement: "ok" | "unknown" | "mismatch"
//   dsm_registration_displacement: "missing" | "invalid" | "validated"
//
// Why: prior UI conflated raster overlay drift with missing DSM registration
// and showed "Coordinate frame mismatch — overlay not eligible for manual
// approval" even when the aerial perimeter projects cleanly into the Roof
// Focus crop. This helper isolates the two failures so banners and lock
// reasons reflect the real cause.
//
// Pure / no side effects. No backend, no geometry mutation.
// ============================================================================

import { resolveFrameMismatch } from "./resolveFrameMismatch";

export type RasterOverlayDisplacement = "ok" | "unknown" | "mismatch";
export type DsmRegistrationDisplacement = "missing" | "invalid" | "validated";
export type ManualApprovalLockReason =
  | "dsm_registration_missing"
  | "frame_mismatch"
  | "target_unconfirmed"
  | null;

export interface AlignmentMetrics {
  perimeter_bbox_center_src: [number, number] | null;
  confirmed_center_src: [number, number] | null;
  raster_center_offset_px: number | null;
  target_mask_overlap: number | null;
  perimeter_vs_mask_iou: number | null;
  legacy_centroid_offset_px: number | null;
}

export interface AlignmentBanner {
  title: string;
  body: string;
}

export interface AlignmentStatus {
  raster_overlay_displacement: RasterOverlayDisplacement;
  dsm_registration_displacement: DsmRegistrationDisplacement;
  manual_approval_lock_reason: ManualApprovalLockReason;
  banner: AlignmentBanner | null;
  metrics: AlignmentMetrics;
}

/**
 * Already-resolved Overlay Transform diagnostics object as rendered by the
 * "Overlay transform" diagnostics card in MeasurementVisualQAOverlay. Passing
 * this in lets the helper trust the same crop-valid evidence the UI displays,
 * instead of re-deriving partial values from geometry_report_json.
 */
export interface ResolvedOverlayTransform {
  coord_space?: string | null;
  source_px?: { width: number; height: number } | null;
  crop_bbox_px?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  display_px_within_crop?: { width: number; height: number } | null;
  first_pt_disp?: [number, number] | null;
  bbox_center_disp?: [number, number] | null;
  target_mask_overlap?: number | null;
}

export interface ComputeAlignmentStatusOptions {
  overlayTransform?: ResolvedOverlayTransform | null;
}


const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function dig(root: any, path: string): unknown {
  if (!root) return undefined;
  let cur: any = root;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

function asPoint(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])) {
    return [v[0] as number, v[1] as number];
  }
  if (v && typeof v === "object") {
    const o = v as any;
    const x = o.x ?? o[0];
    const y = o.y ?? o[1];
    if (isNum(x) && isNum(y)) return [x, y];
  }
  return null;
}

function asBbox(v: unknown): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as any;
  const minX = o.minX ?? o.x0 ?? o.min_x ?? o[0]?.[0];
  const minY = o.minY ?? o.y0 ?? o.min_y ?? o[0]?.[1];
  const maxX = o.maxX ?? o.x1 ?? o.max_x ?? o[1]?.[0];
  const maxY = o.maxY ?? o.y1 ?? o.max_y ?? o[1]?.[1];
  if (isNum(minX) && isNum(minY) && isNum(maxX) && isNum(maxY)) {
    return { minX, minY, maxX, maxY };
  }
  return null;
}

/** True when point is inside the crop bbox (inclusive). */
function pointInBbox(p: [number, number] | null, bb: ReturnType<typeof asBbox>): boolean {
  if (!p || !bb) return false;
  return p[0] >= bb.minX && p[0] <= bb.maxX && p[1] >= bb.minY && p[1] <= bb.maxY;
}

/**
 * computeAlignmentStatus
 * ----------------------
 * Reads geometry_report_json and derives the split displacement statuses,
 * the manual-approval lock reason, the banner copy, and the explicit metric
 * block the Visual QA UI renders.
 */
export function computeAlignmentStatus(measurement: any): AlignmentStatus {
  const grj = (measurement?.geometry_report_json ?? {}) as any;

  // --- inputs ------------------------------------------------------------
  const resolved = resolveFrameMismatch(grj);

  const coordSpace =
    (dig(grj, "overlay_transform.coord_space") as string | undefined) ??
    (dig(grj, "coordinate_space_candidate") as string | undefined) ??
    (dig(grj, "overlay_debug.coord_space") as string | undefined) ??
    null;

  const sourcePx =
    dig(grj, "overlay_transform.source_raster_px") ??
    dig(grj, "source_raster_px") ??
    dig(grj, "raster_size_px") ??
    null;

  const cropBbox =
    asBbox(dig(grj, "overlay_transform.crop_bbox_px")) ??
    asBbox(dig(grj, "crop_bbox_px")) ??
    asBbox(dig(grj, "overlay_debug.crop_bbox_px"));

  const bboxCenterSrc =
    asPoint(dig(grj, "overlay_transform.perimeter_bbox_center_src")) ??
    asPoint(dig(grj, "perimeter_bbox_center_src")) ??
    asPoint(dig(grj, "overlay_debug.bbox_center_src"));

  const confirmedCenterSrc =
    asPoint(dig(grj, "confirmed_roof_center_px")) ??
    asPoint(dig(grj, "registration.confirmed_roof_center_px")) ??
    asPoint(dig(grj, "registration.transform_package.confirmed_roof_center_px"));

  const targetMaskOverlap =
    (dig(grj, "target_mask_overlap_with_perimeter") as number | undefined) ??
    (dig(grj, "target_mask_isolation.target_mask_overlap_with_perimeter") as number | undefined) ??
    (dig(grj, "overlay_debug.target_mask_overlap") as number | undefined) ??
    null;

  const perimeterVsMaskIoU =
    (dig(grj, "perimeter_vs_mask_iou") as number | undefined) ??
    (dig(grj, "target_mask_isolation.perimeter_vs_mask_iou") as number | undefined) ??
    (dig(grj, "overlay_debug.perimeter_vs_mask_iou") as number | undefined) ??
    null;

  const legacyCentroidOffset =
    (dig(grj, "perimeter_centroid_offset_px") as number | undefined) ??
    (dig(grj, "overlay_debug.perimeter_centroid_offset_px") as number | undefined) ??
    null;

  const selectedPerimeterPresent =
    Array.isArray(dig(grj, "selected_perimeter_px")) &&
    (dig(grj, "selected_perimeter_px") as unknown[]).length >= 3;

  // --- raster overlay displacement --------------------------------------
  const hasCoordSpace = coordSpace === "raster_px";
  const hasSource = !!sourcePx;
  const hasCrop = !!cropBbox;
  const overlapOk = isNum(targetMaskOverlap) && (targetMaskOverlap as number) >= 0.9;
  const perimeterProjectsInside =
    pointInBbox(bboxCenterSrc, cropBbox) || selectedPerimeterPresent;

  const frameRawMismatch =
    typeof resolved.frame_mismatch_raw === "string" &&
    resolved.frame_mismatch_raw.toLowerCase() !== "ok" &&
    !!resolved.frame_mismatch_source;

  let rasterOverlayDisplacement: RasterOverlayDisplacement;
  if (resolved.frame_mismatch_ok) {
    rasterOverlayDisplacement = "ok";
  } else if (
    hasCoordSpace &&
    hasSource &&
    hasCrop &&
    perimeterProjectsInside &&
    (overlapOk || selectedPerimeterPresent)
  ) {
    rasterOverlayDisplacement = "ok";
  } else if (
    // Crop-valid evidence: the Overlay Transform card already proves the
    // crop math is valid and raster-aligned. When the overlay transform
    // exposes a valid crop bbox AND either (a) the selected perimeter is
    // surfaced or (b) the perimeter bbox center projects inside the crop,
    // treat the aerial overlay as aligned even if coord_space wasn't
    // explicitly the literal string "raster_px". This stops the UI from
    // reporting "unknown" while the diagnostics show a valid crop.
    hasCrop &&
    (selectedPerimeterPresent || pointInBbox(bboxCenterSrc, cropBbox)) &&
    !frameRawMismatch
  ) {
    rasterOverlayDisplacement = "ok";
  } else if (frameRawMismatch) {
    rasterOverlayDisplacement = "mismatch";
  } else {
    rasterOverlayDisplacement = "unknown";
  }

  // --- DSM registration displacement -------------------------------------
  const geoToDsm = dig(grj, "geo_to_dsm_transform");
  const dsmToRaster = dig(grj, "dsm_to_raster_transform");
  const confirmedCenterDsm = dig(grj, "confirmed_roof_center_dsm_px");
  const dsmValid = grj?.dsm_pixel_transform_valid === true;

  let dsmRegistrationDisplacement: DsmRegistrationDisplacement;
  if (dsmValid) {
    dsmRegistrationDisplacement = "validated";
  } else if (
    geoToDsm == null &&
    dsmToRaster == null &&
    confirmedCenterDsm == null
  ) {
    dsmRegistrationDisplacement = "missing";
  } else {
    dsmRegistrationDisplacement = "invalid";
  }

  // --- target confirmation ----------------------------------------------
  const targetConfirmed =
    grj?.user_confirmed_roof_target === true ||
    grj?.roof_target_admin_override === true ||
    grj?.user_confirmed_roof_target == null; // legacy rows — don't claim unconfirmed

  // --- lock reason -------------------------------------------------------
  let manualApprovalLockReason: ManualApprovalLockReason = null;
  if (grj?.user_confirmed_roof_target === false) {
    manualApprovalLockReason = "target_unconfirmed";
  } else if (rasterOverlayDisplacement === "mismatch") {
    manualApprovalLockReason = "frame_mismatch";
  } else if (dsmRegistrationDisplacement !== "validated") {
    manualApprovalLockReason = "dsm_registration_missing";
  }

  // --- banner ------------------------------------------------------------
  let banner: AlignmentBanner | null = null;
  if (manualApprovalLockReason === "target_unconfirmed") {
    banner = {
      title: "Roof target not confirmed — re-place PIN to continue",
      body:
        "The AI measurement cannot proceed until the operator confirms which roof to measure. Re-open Structure Selection and drop the PIN on the target building.",
    };
  } else if (manualApprovalLockReason === "frame_mismatch") {
    banner = {
      title: "Coordinate frame mismatch — overlay not eligible for manual approval",
      body:
        "The displayed perimeter may be drawn over the wrong house or in a different coordinate frame than the aerial image. Re-run AI Measurement after re-placing the PIN on the actual roof.",
    };
  } else if (manualApprovalLockReason === "dsm_registration_missing") {
    banner = {
      title: "DSM registration incomplete — manual approval locked",
      body:
        "The aerial perimeter is aligned to the satellite image, but DSM georegistration is missing. Manual approval is locked because the system cannot safely validate pitch/topology until geo→DSM and DSM→raster transforms are available.",
    };
  }

  // --- metrics -----------------------------------------------------------
  let rasterCenterOffsetPx: number | null = null;
  if (bboxCenterSrc && confirmedCenterSrc) {
    const dx = bboxCenterSrc[0] - confirmedCenterSrc[0];
    const dy = bboxCenterSrc[1] - confirmedCenterSrc[1];
    rasterCenterOffsetPx = Math.sqrt(dx * dx + dy * dy);
  }

  // Silence unused-var lint for targetConfirmed in default lock branch.
  void targetConfirmed;

  return {
    raster_overlay_displacement: rasterOverlayDisplacement,
    dsm_registration_displacement: dsmRegistrationDisplacement,
    manual_approval_lock_reason: manualApprovalLockReason,
    banner,
    metrics: {
      perimeter_bbox_center_src: bboxCenterSrc,
      confirmed_center_src: confirmedCenterSrc,
      raster_center_offset_px: rasterCenterOffsetPx,
      target_mask_overlap: isNum(targetMaskOverlap) ? (targetMaskOverlap as number) : null,
      perimeter_vs_mask_iou: isNum(perimeterVsMaskIoU) ? (perimeterVsMaskIoU as number) : null,
      legacy_centroid_offset_px: isNum(legacyCentroidOffset)
        ? (legacyCentroidOffset as number)
        : null,
    },
  };
}
