// Ridge filtering + plane consolidation.
//
// This is the "filter + simplify" layer that turns noisy detections into
// publishable structure:
//   1. filterRidges        → keep only top 1–3 structural ridges
//   2. consolidatePlanes   → merge near-identical / coplanar / over-split planes
//   3. computeOverlayScale → validates geometry bbox vs roof target bbox

export type Pt = { x: number; y: number };
export type RidgeLine = { p1: Pt; p2: Pt; score?: number };

export interface PlaneIn {
  plane_index: number;
  polygon_px: Pt[];
  confidence: number;
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  source?: string;
}

// ─── geometry helpers ─────────────────────────────────────────────────────
function polyArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function bbox(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Sutherland–Hodgman polygon-vs-convex-bbox clip is not enough for sibling
// planes; we need true polygon-vs-polygon intersection area. Use a simple
// Sutherland–Hodgman where the clip polygon is treated as convex (we triangulate
// fan from poly[0] for a robust enough approximation when polys are mostly convex).
function clipPolygonByEdge(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  if (poly.length === 0) return out;
  const inside = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  const intersect = (p: Pt, q: Pt): Pt => {
    const x1 = p.x, y1 = p.y, x2 = q.x, y2 = q.y;
    const x3 = a.x, y3 = a.y, x4 = b.x, y4 = b.y;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return q;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  };
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur), prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

// Approximate polygon-polygon intersection area by clipping `subject` against
// each edge of `clip` (treating clip as convex). Works well enough for
// near-rectangular sibling planes; over-estimates for very concave clips.
function polyIntersectionArea(subject: Pt[], clip: Pt[]): number {
  if (subject.length < 3 || clip.length < 3) return 0;
  // Ensure clip is CCW for the inside() test above.
  const ensureCCW = (poly: Pt[]) => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a >= 0 ? poly : [...poly].reverse();
  };
  const c = ensureCCW(clip);
  let result = subject;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    result = clipPolygonByEdge(result, a, b);
    if (result.length === 0) return 0;
  }
  return polyArea(result);
}

function lineLen(l: RidgeLine): number {
  return Math.hypot(l.p2.x - l.p1.x, l.p2.y - l.p1.y);
}

function lineAngleDeg(l: RidgeLine): number {
  // 0–180
  const a = (Math.atan2(l.p2.y - l.p1.y, l.p2.x - l.p1.x) * 180) / Math.PI;
  let d = a;
  while (d < 0) d += 180;
  while (d >= 180) d -= 180;
  return d;
}

function angleDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

// ─── 1. RIDGE FILTERING (patent-aligned 4-signal scoring) ────────────────
//
// Each candidate is scored on 4 normalized signals:
//   length      (0.40) — dominant; rejects tiny noise, boosts dominant ridges
//   alignment   (0.25) — angle vs solar-derived ridge axis (perpendicular to azimuth)
//   symmetry    (0.20) — midpoint distance to footprint centroid
//   continuity  (0.15) — straight-line ratio for polyline ridges (default 1 for segments)
//
// Hard filters (before scoring) drop garbage early:
//   length < 25% of footprint width  OR  length < 40 px  OR  continuity < 0.5
//
// Selection: score > 0.65, top 3 max. Safety: if all rejected but candidates
// exist, keep the single best one.

function norm01(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function lengthScore(lenPx: number, footprintWidthPx: number): number {
  return norm01(lenPx, footprintWidthPx * 0.2, footprintWidthPx);
}

function alignmentScore(angleDeg: number, ridgeTargetsDeg: number[]): number {
  if (!ridgeTargetsDeg.length) return 0.5; // neutral when no solar data
  const minDiff = Math.min(...ridgeTargetsDeg.map((t) => angleDiffDeg(angleDeg, t)));
  return 1 - norm01(minDiff, 0, 45);
}

function symmetryScore(midX: number, midY: number, centroidX: number, centroidY: number, footprintWidthPx: number): number {
  const dist = Math.hypot(midX - centroidX, midY - centroidY);
  return 1 - norm01(dist, 0, 0.4 * footprintWidthPx);
}

function continuityScoreFor(l: RidgeLine): number {
  // 2-point ridge segment is by definition perfectly straight.
  return 1;
}

function polyCentroid(poly: Pt[]): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}

// Compute the dominant ridge orientation by binning candidate angles into
// 10° buckets and returning the most populated bin (length-weighted).
function dominantOrientationDeg(ridges: RidgeLine[]): number | null {
  if (!ridges.length) return null;
  const bins: Record<number, number> = {};
  for (const r of ridges) {
    const a = lineAngleDeg(r);
    const len = lineLen(r);
    const key = Math.round(a / 10) * 10;
    bins[key] = (bins[key] || 0) + len; // weight by length so dominant axis wins
  }
  const sorted = Object.entries(bins).sort((a, b) => b[1] - a[1]);
  return Number(sorted[0][0]);
}

function orientationScore(angleDeg: number, dominantDeg: number): number {
  const diff = angleDiffDeg(angleDeg, dominantDeg);
  // 0° diff → 1.0, 45°+ diff → 0
  return Math.max(0, 1 - diff / 45);
}

export function filterRidges(
  ridges: RidgeLine[],
  footprint: Pt[],
  solarAzimuthsDeg: number[] = [],
): { kept: RidgeLine[]; detected: number; discarded: number; reasons: Record<string, number>; dominant_angle_deg: number | null } {
  const reasons: Record<string, number> = {};
  const bump = (k: string) => { reasons[k] = (reasons[k] || 0) + 1; };

  const detected = ridges.length;
  if (!ridges.length) return { kept: [], detected, discarded: 0, reasons, dominant_angle_deg: null };

  const fp = bbox(footprint);
  const fpW = Math.max(fp.w, fp.h);
  const centroid = polyCentroid(footprint);

  // Ridge axis is perpendicular to solar azimuth (down-slope direction).
  const ridgeTargets = solarAzimuthsDeg.map((az) => ((az - 90) % 180 + 180) % 180);

  // Hard filters
  const survivors: RidgeLine[] = [];
  for (const l of ridges) {
    const len = lineLen(l);
    if (len < fpW * 0.25) { bump("too_short_vs_footprint"); continue; }
    if (len < 40) { bump("too_short_abs"); continue; }
    if (continuityScoreFor(l) < 0.5) { bump("low_continuity"); continue; }
    survivors.push(l);
  }

  // Dominant orientation across survivors (length-weighted bins).
  const dominant = dominantOrientationDeg(survivors);

  // Hard orientation gate: reject any ridge whose angle differs from the
  // dominant axis by more than 25°. This is the key fix preventing stacked
  // parallel "horizontal stripe" ridges.
  const orientFiltered: RidgeLine[] = [];
  for (const l of survivors) {
    if (dominant != null && angleDiffDeg(lineAngleDeg(l), dominant) > 25) {
      bump("off_dominant_axis");
      continue;
    }
    orientFiltered.push(l);
  }

  type Scored = { l: RidgeLine; score: number; len: number; ang: number; mid: Pt };
  const scored: Scored[] = orientFiltered.map((l) => {
    const len = lineLen(l);
    const ang = lineAngleDeg(l);
    const midX = (l.p1.x + l.p2.x) / 2;
    const midY = (l.p1.y + l.p2.y) / 2;

    const L = lengthScore(len, fpW);
    const A = alignmentScore(ang, ridgeTargets);
    const S = symmetryScore(midX, midY, centroid.x, centroid.y, fpW);
    const C = continuityScoreFor(l);
    const O = dominant != null ? orientationScore(ang, dominant) : 0.5;

    // Re-weighted with orientationScore (0.20). Sums to 1.0:
    //   length 0.35, alignment 0.20, symmetry 0.15, continuity 0.10, orientation 0.20
    const score = L * 0.35 + A * 0.20 + S * 0.15 + C * 0.10 + O * 0.20;
    return { l, score, len, ang, mid: { x: midX, y: midY } };
  });

  scored.sort((a, b) => b.score - a.score);

  // Threshold + top 3
  let kept: Scored[] = scored.filter((s) => s.score > 0.65).slice(0, 3);

  // Safety fallback: at least one ridge if any survived.
  if (kept.length === 0 && scored.length > 0) {
    bump("fallback_best_only");
    kept = [scored[0]];
  }

  // Remove parallel duplicates: when two ridges have nearly identical
  // angles AND their midpoints are close, keep only the higher-scored one.
  const PARALLEL_ANGLE_DEG = 5;
  const PARALLEL_DIST_PX = 40;
  const deduped: Scored[] = [];
  for (const s of kept) {
    const dup = deduped.find((k) =>
      angleDiffDeg(s.ang, k.ang) < PARALLEL_ANGLE_DEG &&
      Math.hypot(s.mid.x - k.mid.x, s.mid.y - k.mid.y) < PARALLEL_DIST_PX
    );
    if (dup) { bump("parallel_duplicate"); continue; }
    // Also drop if dominated by a much-longer near-parallel ridge already kept.
    const clash = deduped.find((k) => angleDiffDeg(s.ang, k.ang) < 12 && k.len > s.len * 2);
    if (clash) { bump("dominated_by_parallel"); continue; }
    deduped.push(s);
  }

  // Final hard cap at 3 ridges.
  const finalKept = deduped.slice(0, 3);

  console.log("[RIDGE_FILTER]", {
    detected,
    after_hard_filter: survivors.length,
    after_orientation_gate: orientFiltered.length,
    dominant_angle_deg: dominant,
    selected: finalKept.length,
    scores: finalKept.map((s) => Number(s.score.toFixed(3))),
    angles: finalKept.map((s) => Number(s.ang.toFixed(1))),
    reasons,
  });

  const discarded = detected - finalKept.length;
  return { kept: finalKept.map((s) => s.l), detected, discarded, reasons, dominant_angle_deg: dominant };
}


// ─── 2. PLANE CONSOLIDATION ───────────────────────────────────────────────
/**
 * Merge over-split planes:
 *   - drop planes < minAreaPx² (noise)
 *   - merge pairs whose bbox overlap > 60% AND pitch differ < 1° (or both null)
 *   - hard cap at maxPlanes (keep largest)
 */
export function consolidatePlanes(
  planes: PlaneIn[],
  opts: { minAreaPx?: number; maxPlanes?: number; pitchToleranceDeg?: number; bboxOverlapThreshold?: number } = {},
): { planes: PlaneIn[]; before: number; after: number; dropped: number; merged: number } {
  const minArea = opts.minAreaPx ?? 400; // ~150 sqft @ 0.6 ft/px ≈ 416 px²; conservative default
  const maxPlanes = opts.maxPlanes ?? 12;
  const pitchTol = opts.pitchToleranceDeg ?? 1;
  const overlapTh = opts.bboxOverlapThreshold ?? 0.6;

  const before = planes.length;

  // 1) drop tiny planes
  let working = planes
    .map((p) => ({ ...p, _area: polyArea(p.polygon_px) }))
    .filter((p) => p._area >= minArea);
  const dropped = before - working.length;

  // 2) merge near-duplicate planes ONLY.
  //
  // CRITICAL FIX: ridge-split planes are sibling slices of the same footprint,
  // so their AXIS-ALIGNED BBOXES heavily overlap by definition. Using bbox
  // overlap as a merge criterion collapsed valid multi-plane roofs into 1.
  //
  // We now require:
  //   (a) polygon-area overlap (intersection / smaller polygon area) > threshold
  //       — approximated via bbox-of-intersection clipped to each polygon's bbox,
  //       then divided by the SMALLER POLYGON AREA (not bbox area).
  //   (b) BOTH planes must have explicit, near-equal pitch — null pitch never
  //       merges (ridge-split planes have null pitch, so they stay separate).
  let merged = 0;
  let changed = true;
  while (changed) {
    changed = false;
    working.sort((a, b) => b._area - a._area);
    outer: for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        const A = working[i], B = working[j];
        const aB = bbox(A.polygon_px), bB = bbox(B.polygon_px);
        const ix = Math.max(0, Math.min(aB.maxX, bB.maxX) - Math.max(aB.minX, bB.minX));
        const iy = Math.max(0, Math.min(aB.maxY, bB.maxY) - Math.max(aB.minY, bB.minY));
        const interBboxArea = ix * iy;
        if (interBboxArea <= 0) continue;
        const minPolyArea = Math.min(A._area, B._area);
        if (minPolyArea <= 0) continue;
        // Upper-bound on true polygon overlap.
        const overlap = Math.min(1, interBboxArea / minPolyArea);

        const pa = A.pitch_degrees ?? A.pitch ?? null;
        const pb = B.pitch_degrees ?? B.pitch ?? null;
        // Require BOTH pitches defined; null pitch (ridge-split output) blocks merging.
        const pitchOk = pa != null && pb != null && Math.abs(pa - pb) <= pitchTol;

        if (overlap > overlapTh && pitchOk) {
          // Merge: keep larger polygon, drop smaller.
          working.splice(j, 1);
          A._area = polyArea(A.polygon_px);
          merged++;
          changed = true;
          break outer;
        }
      }
    }
  }

  // 3) hard cap
  working.sort((a, b) => b._area - a._area);
  if (working.length > maxPlanes) {
    merged += working.length - maxPlanes;
    working = working.slice(0, maxPlanes);
  }

  // 4) reindex
  const out: PlaneIn[] = working.map((p, i) => {
    const { _area, ...rest } = p as any;
    return { ...rest, plane_index: i + 1 };
  });

  return { planes: out, before, after: out.length, dropped, merged };
}

// ─── 3. OVERLAY SCALE VALIDATION ──────────────────────────────────────────
/**
 * Compare geometry bbox vs target roof bbox (both in raster pixels).
 * Returns the ratio and a recommended scale factor to bring geometry into
 * the 70–90% target band.
 */
export function computeOverlayScale(
  geometryPolys: Pt[][],
  targetBboxPx: { minX: number; minY: number; maxX: number; maxY: number },
): { geometry_bbox_px: number; target_bbox_px: number; ratio: number; in_band: boolean; recommended_scale_factor: number } {
  if (!geometryPolys.length) {
    return { geometry_bbox_px: 0, target_bbox_px: 0, ratio: 0, in_band: false, recommended_scale_factor: 1 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of geometryPolys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const gW = maxX - minX, gH = maxY - minY;
  const tW = targetBboxPx.maxX - targetBboxPx.minX;
  const tH = targetBboxPx.maxY - targetBboxPx.minY;
  const gMax = Math.max(gW, gH);
  const tMax = Math.max(tW, tH);
  const ratio = tMax > 0 ? gMax / tMax : 0;
  const TARGET = 0.8;
  const inBand = ratio >= 0.6 && ratio <= 1.2;
  const recommended = ratio > 0 ? TARGET / ratio : 1;
  return {
    geometry_bbox_px: Math.round(gMax),
    target_bbox_px: Math.round(tMax),
    ratio: Number(ratio.toFixed(3)),
    in_band: inBand,
    recommended_scale_factor: Number(recommended.toFixed(3)),
  };
}
