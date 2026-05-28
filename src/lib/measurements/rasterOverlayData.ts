// ============================================================================
// rasterOverlayData
// ----------------------------------------------------------------------------
// Shared, display-only helpers for picking the aerial raster + overlay geometry
// + Roof Focus perimeter from a measurement row. Extracted from
// MeasurementReportDialog so both the live dialog and the PDF-only export
// section read the SAME priority order.
//
// Pure / display-only. Does NOT touch persisted geometry, gates, DSM logic,
// or any backend value.
// ============================================================================

export type Pt = [number, number];

export const parseRasterSizeFromUrl = (
  url?: string | null,
): { width: number; height: number } | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const size = parsed.searchParams.get("size");
    const scale = Number(parsed.searchParams.get("scale") || 1);
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (match) {
      return {
        width: Number(match[1]) * scale,
        height: Number(match[2]) * scale,
      };
    }
  } catch {
    // Non-standard image URLs can still render; fall through to default below.
  }
  return { width: 1280, height: 1280 };
};

export interface RasterOverlayData {
  grj: any;
  rasterUrl: string | null;
  rasterSize: { width: number; height: number } | null;
  planes_px: Array<{ polygon: Pt[] }>;
  edges_px: Array<{ type: string; p1: Pt; p2: Pt }>;
  footprint_px: Pt[];
  focusPerimeterPx: Pt[];
  hasRasterOverlay: boolean;
}

const asRing = (v: any): Pt[] => {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v) {
    if (
      Array.isArray(p) && p.length >= 2 &&
      Number.isFinite(p[0]) && Number.isFinite(p[1])
    ) {
      out.push([Number(p[0]), Number(p[1])]);
    }
  }
  return out;
};

export const getRasterOverlayData = (measurement: any): RasterOverlayData => {
  const grj = measurement?.geometry_report_json || {};
  if (grj?.registration_precedence_applied === true) {
    return {
      grj,
      rasterUrl: null,
      rasterSize: null,
      planes_px: [],
      edges_px: [],
      footprint_px: [],
      focusPerimeterPx: [],
      hasRasterOverlay: false,
    };
  }
  const overlayDbg = grj?.overlay_debug || {};
  const rasterUrl: string | null = overlayDbg?.raster_url ||
    measurement?.satellite_overlay_url ||
    measurement?.google_maps_image_url ||
    measurement?.mapbox_image_url ||
    grj?.raster_image_url ||
    null;
  const rasterSize = overlayDbg?.raster_size ||
    grj?.raster_size ||
    measurement?.analysis_image_size ||
    parseRasterSizeFromUrl(rasterUrl);
  const planes_px = Array.isArray(grj?._debug_only_planes_px)
    ? grj._debug_only_planes_px
    : Array.isArray(grj?.planes_px)
    ? grj.planes_px
    : [];
  const edges_px = Array.isArray(grj?._debug_only_edges_px)
    ? grj._debug_only_edges_px
    : Array.isArray(grj?.edges_px)
    ? grj.edges_px
    : [];
  const footprint_px: Pt[] = Array.isArray(overlayDbg?.footprint_px)
    ? overlayDbg.footprint_px
    : Array.isArray(grj?.footprint_px)
    ? grj.footprint_px
    : [];
  const hasRasterOverlay = Boolean(
    rasterUrl && rasterSize &&
      (planes_px.length > 0 || edges_px.length > 0 || footprint_px.length > 0),
  );

  const aerialCandidateGraph = grj?.aerial_candidate_roof_graph ??
    grj?.debug_layers?.aerial_candidate_roof_graph;
  const focusPerimeterPx: Pt[] =
    asRing(grj?.selected_perimeter_px).length >= 3
      ? asRing(grj?.selected_perimeter_px)
      : asRing(grj?.phase3_5?.refined_perimeter_px).length >= 3
      ? asRing(grj?.phase3_5?.refined_perimeter_px)
      : asRing(aerialCandidateGraph?.perimeter_ring_px).length >= 3
      ? asRing(aerialCandidateGraph?.perimeter_ring_px)
      : asRing(grj?.phase3_5?.raw_perimeter_px).length >= 3
      ? asRing(grj?.phase3_5?.raw_perimeter_px)
      : asRing(grj?.perimeter_topology?.perimeter_ring_px).length >= 3
      ? asRing(grj?.perimeter_topology?.perimeter_ring_px)
      : asRing(footprint_px);

  return {
    grj,
    rasterUrl,
    rasterSize,
    planes_px,
    edges_px,
    footprint_px,
    focusPerimeterPx,
    hasRasterOverlay,
  };
};
