import { describe, it, expect } from 'vitest';
import {
  validateAnnotation,
  polygonArea,
  movePolygonVertex,
  insertPolygonVertex,
  deletePolygonVertex,
  pointInPolygon,
  hitTest,
  translateAnnotation,
  nextCalloutLabel,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  serializeAnnotations,
  parseAnnotationSet,
  type PolygonAnnotation,
  type Annotation,
} from '@/lib/photo-intelligence/annotations';

const tri: PolygonAnnotation = {
  id: 'a1',
  kind: 'polygon',
  color: '#ef4444',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.3, y: 0.5 },
  ],
};

describe('annotation validation', () => {
  it('rejects a polygon with fewer than 3 points', () => {
    expect(validateAnnotation({ ...tri, points: tri.points.slice(0, 2) })).toMatch(/3 points/);
  });
  it('rejects a degenerate zero-area polygon', () => {
    const flat = { ...tri, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.3, y: 0.1 }] };
    expect(validateAnnotation(flat)).toMatch(/area/);
  });
  it('rejects a zero-size box and a zero-radius circle', () => {
    expect(validateAnnotation({ id: 'b', kind: 'bbox', color: '#fff', origin: { x: 0, y: 0 }, size: { x: 0, y: 0.5 } })).toBeTruthy();
    expect(validateAnnotation({ id: 'c', kind: 'circle', color: '#fff', center: { x: 0.5, y: 0.5 }, radius: 0 })).toBeTruthy();
  });
  it('accepts a valid polygon', () => {
    expect(validateAnnotation(tri)).toBeNull();
  });
});

describe('polygon geometry', () => {
  it('computes the shoelace area of a unit square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(polygonArea(square)).toBeCloseTo(1);
  });
  it('pointInPolygon hits the centroid and misses outside', () => {
    expect(pointInPolygon({ x: 0.3, y: 0.2 }, tri.points)).toBe(true);
    expect(pointInPolygon({ x: 0.9, y: 0.9 }, tri.points)).toBe(false);
  });
  it('moves a vertex and clamps it into the image', () => {
    const moved = movePolygonVertex(tri, 0, { x: -5, y: 2 });
    expect(moved.points[0]).toEqual({ x: 0, y: 1 });
    expect(moved.points[1]).toEqual(tri.points[1]);
  });
  it('inserts a vertex on the nearest edge', () => {
    const grown = insertPolygonVertex(tri, { x: 0.3, y: 0.1 });
    expect(grown.points).toHaveLength(4);
    // nearest edge is the top edge between points 0 and 1
    expect(grown.points[1]).toEqual({ x: 0.3, y: 0.1 });
  });
  it('never deletes below 3 vertices', () => {
    const same = deletePolygonVertex(tri, 0);
    expect(same.points).toHaveLength(3);
  });
});

describe('hit testing and translation', () => {
  it('hit-tests inside a bbox and on a circle edge', () => {
    const bbox: Annotation = { id: 'b', kind: 'bbox', color: '#fff', origin: { x: 0.2, y: 0.2 }, size: { x: 0.3, y: 0.3 } };
    expect(hitTest(bbox, { x: 0.3, y: 0.3 })).toBe(true);
    expect(hitTest(bbox, { x: 0.9, y: 0.9 })).toBe(false);
    const circle: Annotation = { id: 'c', kind: 'circle', color: '#fff', center: { x: 0.5, y: 0.5 }, radius: 0.2 };
    expect(hitTest(circle, { x: 0.7, y: 0.5 })).toBe(true);
  });
  it('translates an arrow and clamps into the image', () => {
    const arrow: Annotation = { id: 'a', kind: 'arrow', color: '#fff', from: { x: 0.9, y: 0.9 }, to: { x: 1, y: 1 } };
    const moved = translateAnnotation(arrow, 0.5, -0.5) as any;
    expect(moved.from).toEqual({ x: 1, y: 0.4 });
    expect(moved.to).toEqual({ x: 1, y: 0.5 });
  });
});

describe('numbered callouts', () => {
  it('assigns the next free label', () => {
    expect(nextCalloutLabel([])).toBe(1);
    const anns: Annotation[] = [
      { id: '1', kind: 'callout', color: '#fff', at: { x: 0, y: 0 }, label: 1 },
      { id: '2', kind: 'callout', color: '#fff', at: { x: 0, y: 0 }, label: 3 },
    ];
    expect(nextCalloutLabel(anns)).toBe(4);
  });
});

describe('undo/redo history', () => {
  it('undoes and redoes edits in order', () => {
    let h = createHistory([tri]);
    const edited = { ...tri, notes: 'cracked shingle' };
    h = pushHistory(h, [edited]);
    expect(h.present).toEqual([edited]);
    expect(canUndo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present).toEqual([tri]);
    expect(canRedo(h)).toBe(true);
    h = redoHistory(h);
    expect(h.present).toEqual([edited]);
  });
  it('clears the redo stack on a new edit', () => {
    let h = createHistory([]);
    h = pushHistory(h, [tri]);
    h = undoHistory(h);
    h = pushHistory(h, [{ ...tri, id: 'other' }]);
    expect(canRedo(h)).toBe(false);
  });
  it('undo on an empty history is a no-op', () => {
    const h = createHistory([tri]);
    expect(undoHistory(h).present).toEqual([tri]);
  });
});

describe('persistence mapping', () => {
  it('round-trips an annotation set through JSON', () => {
    const set = serializeAnnotations([tri]);
    const parsed = parseAnnotationSet(JSON.parse(JSON.stringify(set)));
    expect(parsed).toEqual([tri]);
  });
  it('never stores image data — geometry only', () => {
    const json = JSON.stringify(serializeAnnotations([tri]));
    expect(json).not.toMatch(/data:image|base64/i);
  });
  it('parses garbage as an empty set', () => {
    expect(parseAnnotationSet(null)).toEqual([]);
    expect(parseAnnotationSet({ annotations: 'nope' })).toEqual([]);
  });
});
