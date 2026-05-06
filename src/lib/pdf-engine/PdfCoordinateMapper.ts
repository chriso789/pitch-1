/**
 * PITCH PDF Coordinate Mapper
 * Maps between PDF coordinate space, canvas space, and screen space.
 * PDF uses bottom-left origin; canvas/screen use top-left.
 */

export interface CoordinateMapping {
  pdfWidth: number;
  pdfHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  rotation: number;
}

/**
 * Convert PDF coordinates (bottom-left origin) to canvas coordinates (top-left origin).
 */
export function pdfToCanvas(
  pdfX: number,
  pdfY: number,
  mapping: CoordinateMapping
): { x: number; y: number } {
  const { pdfHeight, scale } = mapping;
  return {
    x: pdfX * scale,
    y: (pdfHeight - pdfY) * scale,
  };
}

/**
 * Convert canvas coordinates to PDF coordinates.
 */
export function canvasToPdf(
  canvasX: number,
  canvasY: number,
  mapping: CoordinateMapping
): { x: number; y: number } {
  const { pdfHeight, scale } = mapping;
  return {
    x: canvasX / scale,
    y: pdfHeight - (canvasY / scale),
  };
}

/**
 * Scale bounds from PDF space to canvas space.
 */
export function scaleBounds(
  bounds: { x: number; y: number; width: number; height: number },
  mapping: CoordinateMapping
): { x: number; y: number; width: number; height: number } {
  const { scale, pdfHeight } = mapping;
  return {
    x: bounds.x * scale,
    y: (pdfHeight - bounds.y - bounds.height) * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}

/**
 * Create a coordinate mapping for a given page.
 */
export function createMapping(
  pdfWidth: number,
  pdfHeight: number,
  scale: number,
  rotation = 0
): CoordinateMapping {
  return {
    pdfWidth,
    pdfHeight,
    canvasWidth: pdfWidth * scale,
    canvasHeight: pdfHeight * scale,
    scale,
    rotation,
  };
}
