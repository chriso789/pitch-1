// ============================================================================
// resolveFrameMismatch.ts
// ----------------------------------------------------------------------------
// Pure helper that resolves the authoritative `frame_mismatch` flag from the
// many places it can live on the runtime geometry payload, and falls back to
// raster-registration evidence when no explicit string is present.
//
// Why this exists:
//   The early derived-DSM registration gate previously read frame_mismatch
//   only from dsmCoordinateMatchDebug, which on Fonsica-shaped runs is null
//   even though the overlay transform clearly says frame_mismatch === "ok".
//   That mismatch caused early derived DSM registration to skip with
//   `frame_mismatch_not_ok`, blocking DSM-derived bounds production.
//
// Contract:
//   • Pure: no I/O, never throws.
//   • Returns { frame_mismatch_ok, frame_mismatch_source, frame_mismatch_raw,
//               raster_registration_evidence }.
//   • An explicit string from any priority source wins. "ok" → true; anything
//     else → false.
//   • If no explicit string is found, the function MAY infer
//     frame_mismatch_ok=true when raster evidence is strong (see below).
// ============================================================================

export interface ResolveFrameMismatchResult {
  frame_mismatch_ok: boolean;
  frame_mismatch_source: string | null;
  frame_mismatch_raw: string | null;
  raster_registration_evidence: Record<string, unknown>;
}

const PRIORITY_PATHS: ReadonlyArray<string> = [
  "overlay_transform.frame_mismatch",
  "overlayCoordinateFrame.frame_mismatch",
  "visual_qa.overlay_transform.frame_mismatch",
  "overlay_debug.frame_mismatch",
  "registration.overlay_transform.frame_mismatch",
  "registration.transform_package.frame_mismatch",
  "registration_gate.overlay_transform.frame_mismatch",
  "registration_gate.transform_package.frame_mismatch",
  "frame_mismatch",
];

function dig(root: any, path: string): unknown {
  if (!root) return undefined;
  let cur: any = root;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Resolve frame_mismatch from the geometry payload (and optional legacy
 * dsmCoordinateMatchDebug).
 */
export function resolveFrameMismatch(
  geometry: unknown,
  legacyDsmCoordinateMatchDebug?: unknown,
): ResolveFrameMismatchResult {
  const g: any = geometry ?? {};

  // ── 1. Explicit string sources, in priority order ─────────────────
  for (const path of PRIORITY_PATHS) {
    const v = dig(g, path);
    if (isStr(v)) {
      return {
        frame_mismatch_ok: v.toLowerCase() === "ok",
        frame_mismatch_source: path,
        frame_mismatch_raw: v,
        raster_registration_evidence: {},
      };
    }
  }

  // Legacy dsmCoordinateMatchDebug (last priority before inference)
  const legacy: any = legacyDsmCoordinateMatchDebug ?? null;
  if (legacy) {
    const legacyRaw = isStr(legacy.frame_mismatch)
      ? legacy.frame_mismatch
      : isStr(legacy.match_status)
      ? legacy.match_status
      : legacy.is_valid === true
      ? "ok"
      : null;
    if (isStr(legacyRaw)) {
      return {
        frame_mismatch_ok: legacyRaw.toLowerCase() === "ok",
        frame_mismatch_source: "dsmCoordinateMatchDebug",
        frame_mismatch_raw: legacyRaw,
        raster_registration_evidence: {},
      };
    }
  }

  // ── 2. Inferred from raster-registration evidence ────────────────
  // Read coordinate-space + raster-size evidence from BOTH legacy
  // `overlay_transform.*` paths AND the live runtime
  // `registration.transform_package.*` paths the report JSON uses today.
  const coordSpaceCandidate =
    dig(g, "overlay_transform.coord_space") ??
    dig(g, "coordinate_space_candidate") ??
    dig(g, "overlay_debug.coord_space") ??
    dig(g, "registration.transform_package.coordinate_space_candidate") ??
    dig(g, "registration.coordinate_space_candidate") ??
    dig(g, "registration_gate.transform_package.coordinate_space_candidate");
  const coordSpaceRenderer =
    dig(g, "overlay_transform.renderer_coord_space") ??
    dig(g, "coordinate_space_renderer") ??
    dig(g, "overlay_debug.renderer_coord_space") ??
    dig(g, "registration.transform_package.coordinate_space_renderer") ??
    dig(g, "registration.coordinate_space_renderer") ??
    dig(g, "registration_gate.transform_package.coordinate_space_renderer");
  const sourceRasterPx =
    dig(g, "overlay_transform.source_raster_px") ??
    dig(g, "source_raster_px") ??
    dig(g, "raster_size_px") ??
    dig(g, "registration.transform_package.source_raster_px") ??
    dig(g, "registration.transform_package.raster_size_px") ??
    dig(g, "registration.raster_size_px");
  const confirmedCenterPx =
    dig(g, "confirmed_roof_center_px") ??
    dig(g, "registration.confirmed_roof_center_px") ??
    dig(g, "registration.transform_package.confirmed_roof_center_px");
  const rasterContainsCenter =
    dig(g, "raster_bounds_contain_confirmed_center") ??
    dig(g, "registration.raster_bounds_contain_confirmed_center") ??
    dig(g, "registration.transform_package.raster_bounds_contain_confirmed_center");
  const selectedPolyPxPresent =
    dig(g, "selected_candidate_polygon_px_present") ??
    dig(g, "registration.selected_candidate_polygon_px_present") ??
    (Array.isArray(dig(g, "selected_candidate_polygon_px"))
      ? (dig(g, "selected_candidate_polygon_px") as unknown[]).length >= 3
      : undefined);
  const targetOverlap =
    dig(g, "target_mask_overlap_with_perimeter") ??
    dig(g, "target_mask_isolation.target_mask_overlap_with_perimeter") ??
    dig(g, "perimeter_phase0.target_mask_overlap_with_perimeter") ??
    dig(g, "registration.target_mask_overlap_with_perimeter");

  const evidence: Record<string, unknown> = {
    coordinate_space_candidate: coordSpaceCandidate ?? null,
    coordinate_space_renderer: coordSpaceRenderer ?? null,
    source_raster_px_present: !!sourceRasterPx,
    confirmed_center_px_present: !!confirmedCenterPx,
    raster_bounds_contain_confirmed_center: rasterContainsCenter ?? null,
    selected_candidate_polygon_px_present: selectedPolyPxPresent ?? null,
    target_mask_overlap_with_perimeter: isNum(targetOverlap)
      ? targetOverlap
      : null,
  };

  // Full evidence path — every raster-registration signal aligns.
  const allEvidenceOk =
    coordSpaceCandidate === "raster_px" &&
    coordSpaceRenderer === "raster_px" &&
    !!sourceRasterPx &&
    !!confirmedCenterPx &&
    rasterContainsCenter === true &&
    selectedPolyPxPresent === true &&
    isNum(targetOverlap) &&
    (targetOverlap as number) >= 0.9;

  if (allEvidenceOk) {
    return {
      frame_mismatch_ok: true,
      frame_mismatch_source: "inferred_from_raster_registration_evidence",
      frame_mismatch_raw: null,
      raster_registration_evidence: evidence,
    };
  }

  // Live overlay-transform evidence path — the report's Overlay transform
  // table already renders frame_mismatch=ok from this exact shape
  // (raster_px coordinate spaces on both ends, source raster size present,
  // target_mask_overlap >= 0.90), even when explicit per-flag fields like
  // `raster_bounds_contain_confirmed_center` / `selected_candidate_polygon_px_present`
  // were not persisted on this run. Honor that truth so the backend early
  // DSM gate stops disagreeing with the visible overlay transform.
  const liveOverlayOk =
    coordSpaceCandidate === "raster_px" &&
    coordSpaceRenderer === "raster_px" &&
    !!sourceRasterPx &&
    isNum(targetOverlap) &&
    (targetOverlap as number) >= 0.9;
  if (liveOverlayOk) {
    return {
      frame_mismatch_ok: true,
      frame_mismatch_source: "inferred_from_live_overlay_transform_evidence",
      frame_mismatch_raw: null,
      raster_registration_evidence: evidence,
    };
  }

  return {
    frame_mismatch_ok: false,
    frame_mismatch_source: null,
    frame_mismatch_raw: null,
    raster_registration_evidence: evidence,
  };
}
