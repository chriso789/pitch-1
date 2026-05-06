/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DEBUG-ONLY OVERLAY — NOT A GEOSPATIAL REGISTRATION SYSTEM         ║
 * ║                                                                    ║
 * ║  This bbox-fit transform is a VISUAL NORMALIZATION layer.          ║
 * ║  It makes geometry appear approximately centered on the house      ║
 * ║  even when the underlying geometry coordinates differ.             ║
 * ║                                                                    ║
 * ║  NEVER use this for:                                               ║
 * ║   - Customer-facing geometry certification                        ║
 * ║   - Area calculations or measurements                             ║
 * ║   - PDF reports sent to customers                                 ║
 * ║   - Any production output                                         ║
 * ║                                                                    ║
 * ║  Customer reports MUST use:                                        ║
 * ║   - Persisted footprint_px (authoritative boundary)               ║
 * ║   - Geo coordinates from the solver                               ║
 * ║   - Registered raster coordinates, NOT bbox-fitted coordinates    ║
 * ║                                                                    ║
 * ║  EagleView-style architecture: registration is part of geometric  ║
 * ║  reconstruction itself, not a post-hoc visual centering step.     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
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

function round(value: number, decimals = 3): number {
  const m = 10 ** decimals;
  return Math.round(Number(value || 0) * m) / m;
}