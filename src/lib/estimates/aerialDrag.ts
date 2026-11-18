/**
 * Converts a drag on the aerial cover-photo preview into a change of the
 * aerial pan values used to build the Google Static Maps center.
 *
 * Pan contract (see EstimatePreviewPanel):
 *   centerLng = lng + (panX / 100) * (360 / 2^zoom) * PAN_TILES
 *   centerLat = lat - (panY / 100) * (170 / 2^zoom) * PAN_TILES
 * The static image is 800x400 logical map pixels; at zoom z one logical
 * pixel spans 360 / (256 * 2^z) degrees of longitude, so the zoom cancels out.
 */
export const AERIAL_PAN_TILES = 4;
export const AERIAL_IMAGE_LOGICAL_WIDTH = 800;
export const AERIAL_PAN_LIMIT = 400;

export interface AerialDragInput {
  /** Screen-pixel drag distance; positive dx = right, positive dy = down. */
  dx: number;
  dy: number;
  /** Rendered width of the 2:1 preview in CSS pixels. */
  displayWidth: number;
  /** Rotation applied to the preview image, in degrees clockwise. */
  rotationDeg: number;
  /** Property latitude (used for Mercator vertical scale). */
  lat: number;
}

export function aerialDragToPanDelta({ dx, dy, displayWidth, rotationDeg, lat }: AerialDragInput) {
  if (!displayWidth || displayWidth <= 0) return { dPanX: 0, dPanY: 0 };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The rotated preview is also scaled up so it still covers the frame.
  const coverScale = Math.abs(cos) + Math.abs(sin) || 1;
  // Undo the on-screen rotation so the drag is expressed in map directions.
  const ux = (dx * cos + dy * sin) / coverScale;
  const uy = (-dx * sin + dy * cos) / coverScale;
  const mapPxPerScreenPx = AERIAL_IMAGE_LOGICAL_WIDTH / displayWidth;
  const mx = ux * mapPxPerScreenPx;
  const my = uy * mapPxPerScreenPx;
  // Dragging the picture right reveals land to the west (center moves west).
  const dPanX = (-mx * 100) / (256 * AERIAL_PAN_TILES);
  // Dragging the picture down reveals land to the north (center moves north → panY decreases).
  const latFactor = Math.cos((lat * Math.PI) / 180);
  const dPanY = (-my * 360 * latFactor * 100) / (256 * 170 * AERIAL_PAN_TILES);
  return { dPanX, dPanY };
}

export function clampAerialPan(value: number) {
  return Math.max(-AERIAL_PAN_LIMIT, Math.min(AERIAL_PAN_LIMIT, value));
}
