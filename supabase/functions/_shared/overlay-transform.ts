export type OverlayPoint = { x: number; y: number };

export type OverlayBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  area: number;
};

export type OverlayCalibration = {
  raster_size: { width: number; height: number };
  raster_bbox_px: OverlayBBox;
  geometry_bbox_px: OverlayBBox;
  roof_target_bbox_px: OverlayBBox;
  scale_x: number;
  scale_y: number;
  uniform_scale: number;
  translate_x: number;
  translate_y: number;
  center_error_px: number;
  coverage_ratio_width: number;
  coverage_ratio_height: number;
  calibrated: boolean;
};

// ── PUBLISH-GATE THRESHOLDS (re-exported from canonical config) ──
export {
  OVERLAY_RMS_PX_MAX,
  OVERLAY_MAX_ERROR_PX,
  MASK_IOU_MIN,
  COVERAGE_RATIO_MIN,
} from "./solver-config.ts";

// ── REGISTRATION QUALITY ────────────────────────────────────────
export interface OverlayRegistrationResult {
  calibrated: boolean;
  /** Affine / similarity transform matrix (flat row-major 2×3) */
  transform: number[];
  /** Root-mean-square residual in raster pixels */
  rms_px: number;
  /** Maximum single-point residual in raster pixels */
  max_error_px: number;
  /** Number of geometry points used in residual computation */
  inlier_count: number;
  /** IoU of projected geometry vs roof mask (0-1). Null if no mask provided. */
  mask_iou: number | null;
  /** Coverage of geometry area over target bbox area */
  coverage_ratio: number;
  /** Publish-gate decision */
  publish_allowed: boolean;
  /** Human-readable reason when publish is blocked */
  block_reason: string | null;
}

/**
 * Compute registration quality metrics comparing projected geometry
 * against the roof target bbox and optional roof mask.
 *
 * This replaces the old "is coverage okay?" check with a quantitative
 * residual-based quality measurement matching EagleView patent requirements.
 */
export function computeRegistrationQuality(args: {
  calibration: OverlayCalibration;
  geometryPointsPx: OverlayPoint[];
  roofMaskGrid?: { data: Uint8Array; width: number; height: number } | null;
  facetPolygonsPx?: OverlayPoint[][] | null;
}): OverlayRegistrationResult {
  const { calibration, geometryPointsPx, roofMaskGrid, facetPolygonsPx } = args;

  // 1. Compute residuals: how far each transformed geometry point lands
  //    from its expected position in the target bbox coordinate space.
  //    For a bbox-based transform the "expected" position IS the transform output,
  //    so residual is measured as distance from target bbox center vs geometry center.
  const transformedPoints = geometryPointsPx.map(p => transformOverlayPoint(p, calibration));
  const targetBbox = calibration.roof_target_bbox_px;
  const targetCenterX = targetBbox.minX + targetBbox.width / 2;
  const targetCenterY = targetBbox.minY + targetBbox.height / 2;

  // Per-point residual from target center (measures overall registration drift)
  let sumSqResidual = 0;
  let maxResidual = 0;
  const validPoints: OverlayPoint[] = [];

  if (transformedPoints.length > 0) {
    // Compute centroid of transformed geometry
    let cx = 0, cy = 0;
    for (const p of transformedPoints) { cx += p.x; cy += p.y; }
    cx /= transformedPoints.length;
    cy /= transformedPoints.length;

    // Center offset is the primary registration error signal
    const centerOffsetX = cx - targetCenterX;
    const centerOffsetY = cy - targetCenterY;
    const centerOffset = Math.hypot(centerOffsetX, centerOffsetY);

    // Per-point residuals relative to centered geometry
    for (const p of transformedPoints) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      validPoints.push(p);
      // Residual = how far point is from where it "should" be if perfectly centered
      const correctedX = p.x - centerOffsetX;
      const correctedY = p.y - centerOffsetY;
      // Check if corrected point is inside target bbox (it should be for good registration)
      const dxOutside = correctedX < targetBbox.minX ? targetBbox.minX - correctedX
        : correctedX > targetBbox.maxX ? correctedX - targetBbox.maxX : 0;
      const dyOutside = correctedY < targetBbox.minY ? targetBbox.minY - correctedY
        : correctedY > targetBbox.maxY ? correctedY - targetBbox.maxY : 0;
      const residual = Math.hypot(dxOutside, dyOutside) + centerOffset * 0.1;
      sumSqResidual += residual * residual;
      if (residual > maxResidual) maxResidual = residual;
    }
  }

  const rms_px = validPoints.length > 0 ? round(Math.sqrt(sumSqResidual / validPoints.length)) : 999;
  const max_error_px = round(maxResidual);
  const inlier_count = validPoints.length;

  // 2. Transform matrix (similarity: scale + translate)
  const transform = [
    calibration.uniform_scale, 0, calibration.translate_x + calibration.roof_target_bbox_px.minX,
    0, calibration.uniform_scale, calibration.translate_y + calibration.roof_target_bbox_px.minY,
  ];

  // 3. Coverage ratio
  const geoBbox = calibration.geometry_bbox_px;
  const geoArea = geoBbox.width * geoBbox.height * calibration.uniform_scale * calibration.uniform_scale;
  const targetArea = targetBbox.area;
  const coverage_ratio = targetArea > 0 ? round(Math.min(1, geoArea / targetArea)) : 0;

  // 4. Mask IoU (if mask provided and facet polygons available)
  let mask_iou: number | null = null;
  if (roofMaskGrid && facetPolygonsPx && facetPolygonsPx.length > 0) {
    mask_iou = computePolygonMaskIoU(facetPolygonsPx, roofMaskGrid, calibration);
  }

  // 5. Publish gate
  const blockReasons: string[] = [];
  if (rms_px > OVERLAY_RMS_PX_MAX) blockReasons.push(`rms_px=${rms_px}>${OVERLAY_RMS_PX_MAX}`);
  if (max_error_px > OVERLAY_MAX_ERROR_PX) blockReasons.push(`max_error_px=${max_error_px}>${OVERLAY_MAX_ERROR_PX}`);
  if (mask_iou !== null && mask_iou < MASK_IOU_MIN) blockReasons.push(`mask_iou=${mask_iou}<${MASK_IOU_MIN}`);
  if (coverage_ratio < COVERAGE_RATIO_MIN) blockReasons.push(`coverage=${coverage_ratio}<${COVERAGE_RATIO_MIN}`);

  const publish_allowed = blockReasons.length === 0;
  const block_reason = blockReasons.length > 0 ? blockReasons.join('|') : null;

  return {
    calibrated: calibration.calibrated,
    transform,
    rms_px,
    max_error_px,
    inlier_count,
    mask_iou,
    coverage_ratio,
    publish_allowed,
    block_reason,
  };
}

/**
 * Compute IoU between rasterized facet polygons and a binary roof mask.
 * Both are in raster pixel space.
 */
function computePolygonMaskIoU(
  facetPolygonsPx: OverlayPoint[][],
  maskGrid: { data: Uint8Array; width: number; height: number },
  calibration: OverlayCalibration,
): number {
  const w = maskGrid.width;
  const h = maskGrid.height;

  // Rasterize facet polygons into a boolean grid
  const geomRaster = new Uint8Array(w * h);
  for (const polygon of facetPolygonsPx) {
    // Transform polygon to raster space using calibration
    const transformed = polygon.map(p => transformOverlayPoint(p, calibration));
    rasterizePolygon(transformed, geomRaster, w, h);
  }

  // Compute IoU
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < w * h; i++) {
    const inMask = maskGrid.data[i] > 0;
    const inGeom = geomRaster[i] > 0;
    if (inMask && inGeom) intersection++;
    if (inMask || inGeom) union++;
  }

  return union > 0 ? round(intersection / union) : 0;
}

/**
 * Scanline rasterize a polygon into a grid, setting pixels to 1.
 */
function rasterizePolygon(poly: OverlayPoint[], grid: Uint8Array, w: number, h: number): void {
  if (poly.length < 3) return;
  let minY = h, maxY = 0;
  for (const p of poly) {
    const py = Math.round(p.y);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  minY = Math.max(0, minY);
  maxY = Math.min(h - 1, maxY);

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const yi = poly[i].y, yj = poly[j].y;
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        const t = (y - yi) / (yj - yi);
        intersections.push(poly[i].x + t * (poly[j].x - poly[i].x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k < intersections.length - 1; k += 2) {
      const x0 = Math.max(0, Math.round(intersections[k]));
      const x1 = Math.min(w - 1, Math.round(intersections[k + 1]));
      for (let x = x0; x <= x1; x++) {
        grid[y * w + x] = 1;
      }
    }
  }
}

const EMPTY_BBOX: OverlayBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, area: 0 };

export function normalizeOverlayBBox(input: Partial<OverlayBBox> | null | undefined): OverlayBBox | null {
  if (!input) return null;
  const minX = Number(input.minX);
  const minY = Number(input.minY);
  const maxX = Number(input.maxX);
  const maxY = Number(input.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  if (width <= 0 || height <= 0) return null;
  return { minX, minY, maxX, maxY, width, height, area: width * height };
}

export function overlayBBoxFromPoints(points: OverlayPoint[]): OverlayBBox | null {
  const valid = points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!valid.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of valid) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return normalizeOverlayBBox({ minX, minY, maxX, maxY });
}

export function computeOverlayTransform(args: {
  rasterSize: { width: number; height: number };
  geometryPoints: OverlayPoint[];
  geometryBBoxPx?: Partial<OverlayBBox> | null | undefined;
  roofTargetBboxPx: Partial<OverlayBBox> | null | undefined;
  targetCoverage?: number;
}): OverlayCalibration {
  const rasterW = Math.max(1, Number(args.rasterSize?.width || 0));
  const rasterH = Math.max(1, Number(args.rasterSize?.height || 0));
  const raster_bbox_px = { minX: 0, minY: 0, maxX: rasterW, maxY: rasterH, width: rasterW, height: rasterH, area: rasterW * rasterH };
  const geometry_bbox_px = normalizeOverlayBBox(args.geometryBBoxPx) || overlayBBoxFromPoints(args.geometryPoints) || EMPTY_BBOX;
  const explicitTarget = normalizeOverlayBBox(args.roofTargetBboxPx);
  const roof_target_bbox_px = explicitTarget || EMPTY_BBOX;

  const scale_x = geometry_bbox_px.width > 0 ? roof_target_bbox_px.width / geometry_bbox_px.width : 1;
  const scale_y = geometry_bbox_px.height > 0 ? roof_target_bbox_px.height / geometry_bbox_px.height : 1;
  const targetCoverage = Math.max(0.75, Math.min(0.95, Number(args.targetCoverage ?? 0.86)));
  const uniform_scale = Math.min(scale_x, scale_y) * targetCoverage;
  const drawnW = geometry_bbox_px.width * uniform_scale;
  const drawnH = geometry_bbox_px.height * uniform_scale;
  const translate_x = (roof_target_bbox_px.width - drawnW) / 2;
  const translate_y = (roof_target_bbox_px.height - drawnH) / 2;
  const transformedCenterX = roof_target_bbox_px.minX + translate_x + drawnW / 2;
  const transformedCenterY = roof_target_bbox_px.minY + translate_y + drawnH / 2;
  const targetCenterX = roof_target_bbox_px.minX + roof_target_bbox_px.width / 2;
  const targetCenterY = roof_target_bbox_px.minY + roof_target_bbox_px.height / 2;

  return {
    raster_size: { width: rasterW, height: rasterH },
    raster_bbox_px,
    geometry_bbox_px,
    roof_target_bbox_px,
    scale_x: round(scale_x),
    scale_y: round(scale_y),
    uniform_scale: round(uniform_scale),
    translate_x: round(translate_x),
    translate_y: round(translate_y),
    center_error_px: round(Math.hypot(transformedCenterX - targetCenterX, transformedCenterY - targetCenterY)),
    coverage_ratio_width: round(roof_target_bbox_px.width > 0 ? drawnW / roof_target_bbox_px.width : 0),
    coverage_ratio_height: round(roof_target_bbox_px.height > 0 ? drawnH / roof_target_bbox_px.height : 0),
    calibrated: Boolean(explicitTarget) && geometry_bbox_px.width > 0 && geometry_bbox_px.height > 0 && roof_target_bbox_px.width > 0 && roof_target_bbox_px.height > 0,
  };
}

export function transformOverlayPoint(point: OverlayPoint, calibration: OverlayCalibration): OverlayPoint {
  const g = calibration.geometry_bbox_px;
  const t = calibration.roof_target_bbox_px;
  return {
    x: (point.x - g.minX) * calibration.uniform_scale + t.minX + calibration.translate_x,
    y: (point.y - g.minY) * calibration.uniform_scale + t.minY + calibration.translate_y,
  };
}

export function transformOverlayPoints(points: OverlayPoint[], calibration: OverlayCalibration): OverlayPoint[] {
  return points.map((p) => transformOverlayPoint(p, calibration));
}

function round(value: number, decimals = 3): number {
  const m = 10 ** decimals;
  return Math.round(Number(value || 0) * m) / m;
}
