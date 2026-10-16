/**
 * Orientation transforms for scan pages. Crop corners are stored in the untouched photo's
 * pixel space; rotation is applied after cleanup. These helpers map points and sizes between
 * the unrotated and rotated frames so previews, crops and PDF page size stay consistent in
 * portrait and landscape.
 */
export type Rotation = 0 | 90 | 180 | 270;
export interface Pt { x: number; y: number }

export function normalizeRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/** Size of a w×h frame after clockwise rotation. */
export function rotatedSize(w: number, h: number, rot: Rotation) {
  return rot === 90 || rot === 270 ? { width: h, height: w } : { width: w, height: h };
}

/** Map a point in the unrotated w×h frame into the clockwise-rotated frame. */
export function rotatePoint(p: Pt, w: number, h: number, rot: Rotation): Pt {
  switch (rot) {
    case 90: return { x: h - p.y, y: p.x };
    case 180: return { x: w - p.x, y: h - p.y };
    case 270: return { x: p.y, y: w - p.x };
    default: return { ...p };
  }
}

/** Inverse of rotatePoint: map a point in the rotated frame back to the unrotated w×h frame. */
export function unrotatePoint(p: Pt, w: number, h: number, rot: Rotation): Pt {
  switch (rot) {
    case 90: return { x: p.y, y: h - p.x };
    case 180: return { x: w - p.x, y: h - p.y };
    case 270: return { x: w - p.y, y: p.x };
    default: return { ...p };
  }
}

/** Page orientation used for the PDF page of a processed scan. */
export function pageOrientation(w: number, h: number): 'portrait' | 'landscape' {
  return w > h ? 'landscape' : 'portrait';
}

/** Map a preview-space point (displayed at dispW×dispH) to source pixel space. */
export function previewToSource(p: Pt, dispW: number, dispH: number, srcW: number, srcH: number): Pt {
  return { x: (p.x / dispW) * srcW, y: (p.y / dispH) * srcH };
}
