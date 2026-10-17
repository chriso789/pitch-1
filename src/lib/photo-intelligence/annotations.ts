/**
 * Photo Intelligence annotation model (Phase 3).
 *
 * Annotations are pure geometry in NORMALIZED image coordinates (0..1),
 * stored separately from the photo. The original image is never modified;
 * annotations render as an SVG/canvas overlay and can be re-edited losslessly.
 *
 * Every annotation may link to a building, roof plane/elevation, component and
 * damage category, and may be attached to one finding. One finding can have
 * annotations on many photographs (via photo_finding_evidence rows).
 */

export type AnnotationKind = 'polygon' | 'bbox' | 'circle' | 'arrow' | 'callout';

export interface Point {
  x: number; // 0..1 across image width
  y: number; // 0..1 down image height
}

export interface AnnotationBase {
  id: string;
  kind: AnnotationKind;
  /** Numbered callout label (1-based) shown on the overlay and in reports. */
  label?: number;
  color: string;
  buildingLabel?: string | null;
  roofPlane?: string | null;
  elevation?: string | null;
  component?: string | null;
  damageCategory?: string | null;
  /** Finding this annotation evidences (photo_findings.id). */
  findingId?: string | null;
  notes?: string | null;
}

export interface PolygonAnnotation extends AnnotationBase {
  kind: 'polygon';
  points: Point[]; // >= 3
}

export interface BboxAnnotation extends AnnotationBase {
  kind: 'bbox';
  origin: Point; // top-left
  size: Point; // width/height as fractions
}

export interface CircleAnnotation extends AnnotationBase {
  kind: 'circle';
  center: Point;
  radius: number; // fraction of image width
}

export interface ArrowAnnotation extends AnnotationBase {
  kind: 'arrow';
  from: Point;
  to: Point;
}

export interface CalloutAnnotation extends AnnotationBase {
  kind: 'callout';
  at: Point; // where the numbered marker sits
  target?: Point | null; // optional arrowhead target
}

export type Annotation =
  | PolygonAnnotation
  | BboxAnnotation
  | CircleAnnotation
  | ArrowAnnotation
  | CalloutAnnotation;

export const ANNOTATION_COLORS = ['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#f97316', '#a855f7'] as const;

export const DAMAGE_CATEGORIES = [
  'Impact damage',
  'Wind damage',
  'Cracking / splitting',
  'Granule loss',
  'Punctures / tears',
  'Membrane blistering',
  'Flashing failure',
  'Sealant failure',
  'Corrosion / rust',
  'Ponding / drainage',
  'Vegetation / debris',
  'Previous repair',
  'Wear / aging',
  'No visible damage',
  'Other',
] as const;

let idCounter = 0;
export function newAnnotationId(): string {
  idCounter += 1;
  return `ann_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clampPoint = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });

/** Validate an annotation; returns a human-readable problem or null. */
export function validateAnnotation(a: Annotation): string | null {
  switch (a.kind) {
    case 'polygon': {
      if (a.points.length < 3) return 'A polygon needs at least 3 points';
      if (a.points.some((p) => !isFinite(p.x) || !isFinite(p.y))) return 'Polygon has an invalid point';
      if (polygonArea(a.points) < 1e-6) return 'Polygon area is effectively zero';
      return null;
    }
    case 'bbox':
      if (a.size.x <= 0 || a.size.y <= 0) return 'A box needs a positive width and height';
      return null;
    case 'circle':
      if (!(a.radius > 0)) return 'A circle needs a positive radius';
      return null;
    case 'arrow':
      if (distance(a.from, a.to) < 1e-4) return 'An arrow needs distinct start and end points';
      return null;
    case 'callout':
      return null;
  }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shoelace area of a normalized polygon (fraction of image area). */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** Move a polygon vertex; the polygon is returned clamped into the image. */
export function movePolygonVertex(poly: PolygonAnnotation, index: number, to: Point): PolygonAnnotation {
  if (index < 0 || index >= poly.points.length) return poly;
  const points = poly.points.slice();
  points[index] = clampPoint(to);
  return { ...poly, points };
}

/** Insert a vertex on the nearest polygon edge to `p`; returns the new polygon. */
export function insertPolygonVertex(poly: PolygonAnnotation, p: Point): PolygonAnnotation {
  const pts = poly.points;
  let bestEdge = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pointToSegmentDistance(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < bestDist) {
      bestDist = d;
      bestEdge = i;
    }
  }
  const points = pts.slice();
  points.splice(bestEdge + 1, 0, clampPoint(p));
  return { ...poly, points };
}

export function deletePolygonVertex(poly: PolygonAnnotation, index: number): PolygonAnnotation {
  if (poly.points.length <= 3) return poly; // never drop below a triangle
  const points = poly.points.slice();
  points.splice(index, 1);
  return { ...poly, points };
}

export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Point-in-polygon (ray casting) in normalized coordinates. */
export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Does the pointer hit this annotation (tolerance in normalized units)? */
export function hitTest(a: Annotation, p: Point, tolerance = 0.02): boolean {
  switch (a.kind) {
    case 'polygon':
      return pointInPolygon(p, a.points) || a.points.some((_, i) => pointToSegmentDistance(p, a.points[i], a.points[(i + 1) % a.points.length]) <= tolerance);
    case 'bbox':
      return p.x >= a.origin.x - tolerance && p.x <= a.origin.x + a.size.x + tolerance && p.y >= a.origin.y - tolerance && p.y <= a.origin.y + a.size.y + tolerance;
    case 'circle': {
      const d = distance(p, a.center);
      return Math.abs(d - a.radius) <= tolerance || d <= tolerance;
    }
    case 'arrow':
      return pointToSegmentDistance(p, a.from, a.to) <= tolerance;
    case 'callout':
      return distance(p, a.at) <= tolerance * 1.5;
  }
}

/** Translate an entire annotation by (dx, dy), clamped into the image. */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  const mv = (p: Point): Point => clampPoint({ x: p.x + dx, y: p.y + dy });
  switch (a.kind) {
    case 'polygon':
      return { ...a, points: a.points.map(mv) };
    case 'bbox':
      return { ...a, origin: mv(a.origin) };
    case 'circle':
      return { ...a, center: mv(a.center) };
    case 'arrow':
      return { ...a, from: mv(a.from), to: mv(a.to) };
    case 'callout':
      return { ...a, at: mv(a.at), target: a.target ? mv(a.target) : a.target };
  }
}

/** Assign the next free numbered-callout label (1-based) for a photo's annotations. */
export function nextCalloutLabel(annotations: Annotation[]): number {
  let max = 0;
  for (const a of annotations) if (a.label != null && a.label > max) max = a.label;
  return max + 1;
}

// ---------------------------------------------------------------------------
// Undo/redo history
// ---------------------------------------------------------------------------

export interface AnnotationHistory {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
}

export function createHistory(initial: Annotation[] = []): AnnotationHistory {
  return { past: [], present: initial, future: [] };
}

/** Push a new state; clears the redo stack. No-ops if nothing changed. */
export function pushHistory(h: AnnotationHistory, next: Annotation[]): AnnotationHistory {
  if (next === h.present) return h;
  return { past: [...h.past, h.present], present: next, future: [] };
}

export function undoHistory(h: AnnotationHistory): AnnotationHistory {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory(h: AnnotationHistory): AnnotationHistory {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = (h: AnnotationHistory) => h.past.length > 0;
export const canRedo = (h: AnnotationHistory) => h.future.length > 0;

// ---------------------------------------------------------------------------
// Persistence mapping (photo_finding_evidence.annotation JSONB)
// ---------------------------------------------------------------------------

export interface PhotoAnnotationSet {
  version: 1;
  /** Never the image bytes — geometry only. */
  annotations: Annotation[];
}

export function serializeAnnotations(annotations: Annotation[]): PhotoAnnotationSet {
  return { version: 1, annotations };
}

export function parseAnnotationSet(raw: unknown): Annotation[] {
  if (!raw || typeof raw !== 'object') return [];
  const v = (raw as PhotoAnnotationSet).annotations;
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is Annotation => !!a && typeof a === 'object' && typeof (a as Annotation).kind === 'string');
}
