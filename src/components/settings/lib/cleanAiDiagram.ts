/**
 * cleanAiDiagram
 * --------------
 * Pure client-side cleanup of the chaotic AI-generated `linear_features_wkt`.
 * The Gemini overlay generator emits lines in lat/lng with no snapping or
 * perimeter discipline, so visualizations end up as tangled X-shapes that
 * shoot well past the roof footprint (see 84 Andros Rd).
 *
 * This pass does NOT re-measure anything — it only sanitizes geometry that
 * the AI already produced:
 *
 *   1. Clip / discard lines whose midpoint sits well outside the perimeter
 *      bounding box (with a small buffer for hip/eave overhang).
 *   2. Snap endpoints that fall within ~1ft of another endpoint together so
 *      ridges/hips meet at vertices instead of floating.
 *   3. Drop near-duplicate segments and segments shorter than 1 ft.
 *   4. Re-emit canonical `LINESTRING(lng lat, lng lat)` WKT.
 *
 * Returns the cleaned feature list plus a stat block describing what was
 * pruned. If the input is unusable (no perimeter, <2 features) the original
 * list is returned unchanged.
 */

export type LinearFeature = {
  type: string;
  wkt: string;
  lengthFt?: number;
  [k: string]: any;
};

type LngLat = [number, number]; // [lng, lat]

const SNAP_TOL_DEG = 3e-6;       // ~0.3 ft at 30°N
const DUP_TOL_DEG = 5e-6;        // ~0.5 ft
const MIN_LENGTH_DEG = 1.5e-5;   // ~1.5 ft, drop slivers
const BBOX_BUFFER_RATIO = 0.15;  // allow 15% overhang past perimeter bbox

function parseLineString(wkt: string): LngLat[] | null {
  const m = /LINESTRING\s*\(([^)]+)\)/i.exec(wkt);
  if (!m) return null;
  const coords = m[1]
    .split(',')
    .map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map<LngLat>((p) => [p[0], p[1]]);
  return coords.length >= 2 ? coords : null;
}

function parsePolygonBounds(wkt: string | null | undefined) {
  if (!wkt) return null;
  const m = /POLYGON\s*\(\(([^)]+)\)\)/i.exec(wkt);
  if (!m) return null;
  const pts = m[1]
    .split(',')
    .map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) return null;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

function dist(a: LngLat, b: LngLat) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

function snapPoint(p: LngLat, anchors: LngLat[]): LngLat {
  for (const a of anchors) {
    if (dist(p, a) < SNAP_TOL_DEG) return a;
  }
  anchors.push(p);
  return p;
}

function segmentKey(a: LngLat, b: LngLat) {
  const r = (n: number) => Math.round(n / DUP_TOL_DEG);
  const k1 = `${r(a[0])},${r(a[1])}|${r(b[0])},${r(b[1])}`;
  const k2 = `${r(b[0])},${r(b[1])}|${r(a[0])},${r(a[1])}`;
  return k1 < k2 ? k1 : k2;
}

export interface CleanResult {
  cleaned: LinearFeature[];
  removed: number;
  snapped: number;
  duplicates: number;
  outside: number;
  total: number;
}

export function cleanAiDiagram(
  features: LinearFeature[] | null | undefined,
  perimeterWkt: string | null | undefined,
): CleanResult {
  const original = Array.isArray(features) ? features : [];
  const stats: CleanResult = {
    cleaned: original,
    removed: 0,
    snapped: 0,
    duplicates: 0,
    outside: 0,
    total: original.length,
  };
  if (original.length < 2) return stats;

  const bounds = parsePolygonBounds(perimeterWkt || undefined);
  let bbox: ReturnType<typeof parsePolygonBounds> = bounds;
  if (!bbox) {
    // Derive bbox from features themselves so we still get sane culling.
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of original) {
      const c = parseLineString(f.wkt);
      if (!c) continue;
      for (const [lng, lat] of c) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (Number.isFinite(minLng)) bbox = { minLng, maxLng, minLat, maxLat };
  }

  const anchors: LngLat[] = [];
  const seen = new Set<string>();
  const cleaned: LinearFeature[] = [];

  // Buffer the bbox a bit so eaves and hips that overhang aren't culled.
  const bufLng = bbox ? (bbox.maxLng - bbox.minLng) * BBOX_BUFFER_RATIO : 0;
  const bufLat = bbox ? (bbox.maxLat - bbox.minLat) * BBOX_BUFFER_RATIO : 0;
  const minLng = bbox ? bbox.minLng - bufLng : -Infinity;
  const maxLng = bbox ? bbox.maxLng + bufLng : Infinity;
  const minLat = bbox ? bbox.minLat - bufLat : -Infinity;
  const maxLat = bbox ? bbox.maxLat + bufLat : Infinity;

  for (const f of original) {
    const coords = parseLineString(f.wkt);
    if (!coords || coords.length < 2) {
      stats.removed++;
      continue;
    }
    // Use endpoints; intermediate vertices on AI lines are rare.
    let a = coords[0];
    let b = coords[coords.length - 1];

    // Cull if BOTH endpoints sit outside the buffered bbox.
    const aIn = a[0] >= minLng && a[0] <= maxLng && a[1] >= minLat && a[1] <= maxLat;
    const bIn = b[0] >= minLng && b[0] <= maxLng && b[1] >= minLat && b[1] <= maxLat;
    if (!aIn && !bIn) {
      stats.outside++;
      stats.removed++;
      continue;
    }

    // Drop slivers
    if (dist(a, b) < MIN_LENGTH_DEG) {
      stats.removed++;
      continue;
    }

    // Snap endpoints to existing anchors so ridges/hips actually meet.
    const aSnapped = snapPoint(a, anchors);
    const bSnapped = snapPoint(b, anchors);
    if (aSnapped !== a) stats.snapped++;
    if (bSnapped !== b) stats.snapped++;
    a = aSnapped;
    b = bSnapped;

    const key = segmentKey(a, b);
    if (seen.has(key)) {
      stats.duplicates++;
      stats.removed++;
      continue;
    }
    seen.add(key);

    cleaned.push({
      ...f,
      wkt: `LINESTRING(${a[0]} ${a[1]}, ${b[0]} ${b[1]})`,
    });
  }

  stats.cleaned = cleaned;
  return stats;
}
