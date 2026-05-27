// ============================================================================
// resolveFrameMismatch (frontend mirror)
// ----------------------------------------------------------------------------
// Mirrors supabase/functions/_shared/resolveFrameMismatch.ts so the Visual QA
// banner reads frame_mismatch from the same set of paths the backend gate uses.
// Keep these two files in sync.
// ============================================================================

export interface ResolveFrameMismatchResult {
  frame_mismatch_ok: boolean;
  frame_mismatch_source: string | null;
  frame_mismatch_raw: string | null;
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

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function resolveFrameMismatch(geometry: unknown): ResolveFrameMismatchResult {
  const g: any = geometry ?? {};
  for (const path of PRIORITY_PATHS) {
    const v = dig(g, path);
    if (isStr(v)) {
      return {
        frame_mismatch_ok: v.toLowerCase() === "ok",
        frame_mismatch_source: path,
        frame_mismatch_raw: v,
      };
    }
  }
  // Inference fallback (mirror of backend)
  const coordSpaceCandidate =
    dig(g, "overlay_transform.coord_space") ??
    dig(g, "coordinate_space_candidate") ??
    dig(g, "overlay_debug.coord_space");
  const coordSpaceRenderer =
    dig(g, "overlay_transform.renderer_coord_space") ??
    dig(g, "coordinate_space_renderer") ??
    dig(g, "overlay_debug.renderer_coord_space");
  const sourceRasterPx =
    dig(g, "overlay_transform.source_raster_px") ??
    dig(g, "source_raster_px") ??
    dig(g, "raster_size_px");
  const confirmedCenterPx =
    dig(g, "confirmed_roof_center_px") ??
    dig(g, "registration.confirmed_roof_center_px");
  const rasterContainsCenter =
    dig(g, "raster_bounds_contain_confirmed_center") ??
    dig(g, "registration.raster_bounds_contain_confirmed_center");
  const selectedPolyPxPresent =
    dig(g, "selected_candidate_polygon_px_present") ??
    (Array.isArray(dig(g, "selected_candidate_polygon_px"))
      ? (dig(g, "selected_candidate_polygon_px") as unknown[]).length >= 3
      : undefined);
  const overlap =
    dig(g, "target_mask_overlap_with_perimeter") ??
    dig(g, "target_mask_isolation.target_mask_overlap_with_perimeter");

  if (
    coordSpaceCandidate === "raster_px" &&
    coordSpaceRenderer === "raster_px" &&
    !!sourceRasterPx &&
    !!confirmedCenterPx &&
    rasterContainsCenter === true &&
    selectedPolyPxPresent === true &&
    isNum(overlap) &&
    (overlap as number) >= 0.9
  ) {
    return {
      frame_mismatch_ok: true,
      frame_mismatch_source: "inferred_from_raster_registration_evidence",
      frame_mismatch_raw: null,
    };
  }
  return {
    frame_mismatch_ok: false,
    frame_mismatch_source: null,
    frame_mismatch_raw: null,
  };
}
