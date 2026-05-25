// ============================================================================
// overlayCoordinateFrame
// ----------------------------------------------------------------------------
// Single source of truth for resolving the raster pixel frame a debug polygon
// was authored in, and projecting that polygon into the actual displayed image
// rectangle on screen.
//
// Bug class this prevents: polygon authored in 1280x1280 raster_px gets drawn
// against an SVG viewBox/canvas using a different (or guessed) raster size,
// putting the geometry in the wrong corner of the aerial tile.
//
// Used by:
//   - MeasurementVisualQAOverlay (canvas)
//   - AIMeasurement3DDebugViewer (SVG over <img object-contain>)
//
// This file does NOT change persisted geometry, gates, or DSM logic. It is a
// pure rendering helper.
// ============================================================================

export type Pt = [number, number];

export type CoordinateSpace = 'raster_px' | 'dsm_px' | 'unknown';

export type RasterSizeSource =
  | 'overlay_debug'
  | 'geometry_report_json'
  | 'analysis_image_size'
  | 'parsed_from_url'
  | 'image_natural'
  | 'unresolved';

export interface ResolvedRasterSize {
  width: number | null;
  height: number | null;
  source: RasterSizeSource;
}

export interface DisplayedImageSize {
  width: number;
  height: number;
}

export interface DisplayTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  fit: 'contain' | 'fill';
  /** Whether the transform was computed from a valid raster size. */
  resolved: boolean;
}

/** Parse Google Static Maps style ?size=WxH&scale=N urls. */
export function parseRasterSizeFromUrl(
  url?: string | null,
): { width: number; height: number } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const size = parsed.searchParams.get('size');
    const scale = Number(parsed.searchParams.get('scale') || 1);
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (match) {
      return { width: Number(match[1]) * scale, height: Number(match[2]) * scale };
    }
  } catch {
    /* noop */
  }
  return null;
}

function readSize(v: any): { width: number; height: number } | null {
  if (!v) return null;
  const w = Number(v.width);
  const h = Number(v.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return null;
}

/**
 * Resolve the source raster size a px polygon was authored against.
 *
 * Order of precedence (no hardcoded final fallback):
 *   1. overlay_debug.raster_size
 *   2. geometry_report_json.raster_size
 *   3. measurement.analysis_image_size
 *   4. parsed from rasterUrl query string
 *   5. loaded image naturalWidth/Height
 *
 * Returns { width: null, height: null, source: 'unresolved' } if nothing is
 * available — callers MUST render a banner and skip projection rather than
 * guessing 800x800 or 1280x1280.
 */
export function resolveSourceRasterSize(
  measurement: any,
  rasterUrl?: string | null,
  imageNatural?: { width: number; height: number } | null,
): ResolvedRasterSize {
  const grj = measurement?.geometry_report_json || {};
  const overlayDbg = grj.overlay_debug || {};

  const fromOverlay = readSize(overlayDbg?.raster_size);
  if (fromOverlay) return { ...fromOverlay, source: 'overlay_debug' };

  const fromGrj = readSize(grj?.raster_size);
  if (fromGrj) return { ...fromGrj, source: 'geometry_report_json' };

  const fromAnalysis = readSize(measurement?.analysis_image_size);
  if (fromAnalysis) return { ...fromAnalysis, source: 'analysis_image_size' };

  const fromUrl = parseRasterSizeFromUrl(rasterUrl);
  if (fromUrl) return { ...fromUrl, source: 'parsed_from_url' };

  const fromNatural = readSize(imageNatural);
  if (fromNatural) return { ...fromNatural, source: 'image_natural' };

  return { width: null, height: null, source: 'unresolved' };
}

const RASTER_FIELDS = new Set([
  'raw_perimeter_px',
  'debug_layers.raw_perimeter_px',
  'perimeter_topology.perimeter_ring_px',
  'phase3_5.raw_perimeter_px',
  'phase3_5.refined_perimeter_px',
  'phase3A_5.raw_perimeter_px',
  'phase3A_5.refined_perimeter_px',
  'aerial_candidate_roof_graph.perimeter_ring_px',
  'debug_layers.aerial_candidate_roof_graph.perimeter_ring_px',
  'true_outer_roof_perimeter_px',
  'footprint_px',
  'debug_layers.selected_perimeter_px',
  'target_mask_polygon_px',
  'target_mask_polygons_px',
  'target_mask_contour_px',
  'target_roof_mask_px',
  'global_mask_polygons_px',
  'global_mask_contours_px',
  'global_mask_px',
  'long_segment_corner_cut_midpoints_px',
]);

/** Decide which coordinate space a debug field lives in. */
export function classifyCoordinateSpace(fieldPath: string): CoordinateSpace {
  const path = String(fieldPath || '');
  if (RASTER_FIELDS.has(path)) return 'raster_px';
  if (/dsm[._]/i.test(path) || path.endsWith('.edges_px') || path === 'overlay_debug.edges_px') {
    return 'dsm_px';
  }
  if (path.endsWith('_px')) return 'raster_px';
  return 'unknown';
}

/** Whether persisted state includes a DSM→raster transform safe for rendering. */
export function hasDsmToRasterTransform(measurement: any): boolean {
  const grj = measurement?.geometry_report_json || {};
  const overlayDbg = grj.overlay_debug || {};
  const t =
    overlayDbg?.dsm_to_raster_transform ||
    grj?.dsm_to_raster_transform ||
    grj?.dsm_pixel_transform ||
    null;
  return !!t && typeof t === 'object';
}

/**
 * Compute the transform from source raster pixel space into a displayed
 * image rectangle. Mirrors the math used by `object-fit: contain` so the
 * SVG overlay and the underlying <img> line up exactly.
 */
export function computeDisplayTransform(args: {
  sourceRasterSize: { width: number | null; height: number | null };
  displayedImageSize: DisplayedImageSize;
  fit?: 'contain' | 'fill';
}): DisplayTransform {
  const sW = Number(args.sourceRasterSize?.width || 0);
  const sH = Number(args.sourceRasterSize?.height || 0);
  const dW = Math.max(0, Number(args.displayedImageSize?.width || 0));
  const dH = Math.max(0, Number(args.displayedImageSize?.height || 0));
  const fit = args.fit || 'contain';

  if (!(sW > 0 && sH > 0 && dW > 0 && dH > 0)) {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, fit, resolved: false };
  }

  if (fit === 'fill') {
    return {
      scaleX: dW / sW,
      scaleY: dH / sH,
      offsetX: 0,
      offsetY: 0,
      fit,
      resolved: true,
    };
  }

  // contain
  const scale = Math.min(dW / sW, dH / sH);
  const drawnW = sW * scale;
  const drawnH = sH * scale;
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (dW - drawnW) / 2,
    offsetY: (dH - drawnH) / 2,
    fit,
    resolved: true,
  };
}

export function projectPxPoint(point: Pt, t: DisplayTransform): Pt {
  return [point[0] * t.scaleX + t.offsetX, point[1] * t.scaleY + t.offsetY];
}

export function bboxOf(points: Pt[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} | null {
  if (!points?.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * Sanity check: after projection, does the polygon's bbox center land near
 * the projected confirmed roof center? If not, the overlay is almost certainly
 * being drawn against the wrong source raster size (the Fonsica bottom-right
 * bug). This is a warning only — it does not flip any gate.
 */
export function detectFrameMismatch(args: {
  perimeterPxSource: Pt[];
  confirmedCenterPxSource?: Pt | null;
  sourceRasterSize: { width: number | null; height: number | null };
  transform: DisplayTransform;
  toleranceFraction?: number;
}): { mismatch: boolean; distancePx: number; tolerancePx: number } {
  const tol = args.toleranceFraction ?? 0.15;
  const sW = Number(args.sourceRasterSize.width || 0);
  const sH = Number(args.sourceRasterSize.height || 0);
  const fallbackCenter: Pt = sW > 0 && sH > 0 ? [sW / 2, sH / 2] : [0, 0];
  const center = args.confirmedCenterPxSource || fallbackCenter;

  const bb = bboxOf(args.perimeterPxSource);
  if (!bb) return { mismatch: false, distancePx: 0, tolerancePx: 0 };

  const projectedBbox = projectPxPoint([bb.cx, bb.cy], args.transform);
  const projectedCenter = projectPxPoint(center, args.transform);
  const dx = projectedBbox[0] - projectedCenter[0];
  const dy = projectedBbox[1] - projectedCenter[1];
  const distancePx = Math.hypot(dx, dy);

  // Tolerance in projected (display) pixels.
  const projectedDim =
    Math.min(sW * args.transform.scaleX, sH * args.transform.scaleY) || 1;
  const tolerancePx = projectedDim * tol;

  return { mismatch: distancePx > tolerancePx, distancePx, tolerancePx };
}
