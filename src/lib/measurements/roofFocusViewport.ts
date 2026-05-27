// ============================================================================
// roofFocusViewport
// ----------------------------------------------------------------------------
// Single shared helper for "Roof Focus" viewport math used across all aerial
// overlays (MeasurementVisualQAOverlay, RasterOverlayDebugView, PDF export).
//
// Pure / display-only. Does NOT touch persisted geometry, gates, DSM logic,
// or any backend value. It computes a crop window in source raster pixels and
// a projection from source raster px -> display px inside that crop.
//
// Rationale: previously the Roof Focus math lived inline inside
// MeasurementVisualQAOverlay, so the first aerial diagram (RasterOverlayDebugView)
// rendered at full-tile zoom while the second was roof-focused. This helper
// centralises the math so every aerial visual uses the same crop and the
// printed diagnostics (crop_bbox_px, display_px_within_crop, first_pt_disp,
// bbox_center_disp) reflect what is actually drawn.
// ============================================================================

export type Pt = [number, number];

export interface RoofFocusInput {
  rasterSize: { width: number; height: number };
  /** Perimeter ring in source raster px. Caller decides priority. */
  perimeterPx: Pt[];
  /** Display width (CSS px) the panel will render at. */
  displayWidth: number;
  /** Pad fraction of bbox max dimension. Default 0.15. */
  padFraction?: number;
  /** Min padding clamp (px). Default 80. */
  minPadPx?: number;
  /** Max padding clamp (px). Default 120. */
  maxPadPx?: number;
}

export interface RoofFocusCropBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

export interface RoofFocusViewport {
  /** Crop window in source raster px. */
  cropBboxPx: RoofFocusCropBbox;
  /** displayWidth / cropBboxPx.w. Square pixels. */
  cropScale: number;
  /** Offset (display px) applied to source px to produce display px. */
  cropOffset: { x: number; y: number };
  /** Final rendered viewport size in display px. */
  displayPxWithinCrop: { width: number; height: number };
  /** Project a source raster px point into display px inside the crop. */
  project: (pt: Pt) => Pt;
  /** SVG viewBox string for the crop ("minX minY w h"). */
  viewBox: string;
  /** False when perimeter is empty/degenerate — full-tile viewport returned. */
  isFocused: boolean;
}

function bboxOfRing(ring: Pt[]): RoofFocusCropBbox | null {
  if (!ring || ring.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    if (!pt || pt.length < 2) continue;
    const [x, y] = pt;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function fullTileViewport(
  rasterSize: { width: number; height: number },
  displayWidth: number,
): RoofFocusViewport {
  const w = Math.max(1, rasterSize.width || 1);
  const h = Math.max(1, rasterSize.height || 1);
  const scale = displayWidth > 0 && w > 0 ? displayWidth / w : 1;
  const cropBboxPx: RoofFocusCropBbox = {
    minX: 0,
    minY: 0,
    maxX: w,
    maxY: h,
    w,
    h,
  };
  return {
    cropBboxPx,
    cropScale: scale,
    cropOffset: { x: 0, y: 0 },
    displayPxWithinCrop: { width: w * scale, height: h * scale },
    project: ([x, y]) => [x * scale, y * scale],
    viewBox: `0 0 ${w} ${h}`,
    isFocused: false,
  };
}

/**
 * Compute the Roof Focus viewport. When the perimeter is empty/degenerate or
 * the raster size is invalid, returns a full-tile viewport with isFocused=false
 * so callers can render without special-casing.
 */
export function roofFocusViewport(input: RoofFocusInput): RoofFocusViewport {
  const {
    rasterSize,
    perimeterPx,
    displayWidth,
    padFraction = 0.15,
    minPadPx = 80,
    maxPadPx = 120,
  } = input;

  const fullW = Math.max(0, rasterSize?.width || 0);
  const fullH = Math.max(0, rasterSize?.height || 0);
  if (fullW <= 0 || fullH <= 0 || !(displayWidth > 0)) {
    return fullTileViewport(
      { width: fullW || 1, height: fullH || 1 },
      displayWidth || 1,
    );
  }

  const bb = bboxOfRing(perimeterPx);
  if (!bb) return fullTileViewport({ width: fullW, height: fullH }, displayWidth);

  const padRaw = Math.max(bb.w, bb.h) * padFraction;
  const pad = Math.max(minPadPx, Math.min(maxPadPx, Math.round(padRaw)));
  const minX = Math.max(0, bb.minX - pad);
  const minY = Math.max(0, bb.minY - pad);
  const maxX = Math.min(fullW, bb.maxX + pad);
  const maxY = Math.min(fullH, bb.maxY + pad);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const cropBboxPx: RoofFocusCropBbox = { minX, minY, maxX, maxY, w, h };

  const scale = displayWidth / w;
  const cropOffset = { x: -minX * scale, y: -minY * scale };
  const project = ([x, y]: Pt): Pt => [
    (x - minX) * scale,
    (y - minY) * scale,
  ];

  return {
    cropBboxPx,
    cropScale: scale,
    cropOffset,
    displayPxWithinCrop: { width: w * scale, height: h * scale },
    project,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    isFocused: true,
  };
}

/**
 * Pick the best perimeter to focus on, in priority order:
 *   selected -> refined -> raw -> footprint
 * Empty/degenerate inputs are skipped.
 */
export function pickFocusPerimeter(
  candidates: Array<Pt[] | null | undefined>,
): Pt[] {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length >= 3) return c as Pt[];
  }
  return [];
}
