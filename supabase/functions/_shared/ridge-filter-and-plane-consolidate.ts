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

// ─── 1. RIDGE FILTERING ───────────────────────────────────────────────────
/**
 * Keep only the top 1–3 structural ridges.
 *
 * Score each ridge by: detector score, length, alignment with solar azimuth,
 * symmetry across the footprint. Discard:
 *   - shorter than 25% of footprint width
 *   - dominated by a sibling that's >2× longer + similar angle
 */
export function filterRidges(
  ridges: RidgeLine[],
  footprint: Pt[],
  solarAzimuthsDeg: number[] = [],
): { kept: RidgeLine[]; detected: number; discarded: number; reasons: Record<string, number> } {
  const reasons: Record<string, number> = {};
  const bump = (k: string) => { reasons[k] = (reasons[k] || 0) + 1; };

  const detected = ridges.length;
  if (!ridges.length) return { kept: [], detected, discarded: 0, reasons };

  const fp = bbox(footprint);
  const minLen = 0.25 * Math.max(fp.w, fp.h);

  // Solar azimuths → ridge orientation = perpendicular to slope direction.
  // Roof azimuth = down-slope; ridge runs perpendicular to it.
  const ridgeTargets = solarAzimuthsDeg.map((az) => {
    let t = (az - 90 + 360) % 180;
    return t;
  });

  type Scored = { l: RidgeLine; score: number; len: number; ang: number };
  const scored: Scored[] = [];

  for (const l of ridges) {
    const len = lineLen(l);
    if (len < minLen) { bump("too_short"); continue; }
    const ang = lineAngleDeg(l);

    let alignBonus = 0;
    if (ridgeTargets.length) {
      const minDiff = Math.min(...ridgeTargets.map((t) => angleDiffDeg(ang, t)));
      alignBonus = Math.max(0, 1 - minDiff / 30); // 0..1 within 30°
    }

    const lenScore = Math.min(1, len / Math.max(fp.w, fp.h));
    const detScore = Math.max(0, Math.min(1, l.score ?? 0.5));
    const total = detScore * 0.5 + lenScore * 0.35 + alignBonus * 0.15;
    scored.push({ l, score: total, len, ang });
  }

  scored.sort((a, b) => b.score - a.score);

  // Suppress siblings that are much shorter and near-parallel to a kept ridge.
  const kept: Scored[] = [];
  for (const s of scored) {
    let dominated = false;
    for (const k of kept) {
      if (angleDiffDeg(s.ang, k.ang) < 12 && k.len > s.len * 2) { dominated = true; break; }
    }
    if (dominated) { bump("dominated_by_parallel"); continue; }
    kept.push(s);
    if (kept.length >= 3) break;
  }

  const discarded = detected - kept.length;
  return { kept: kept.map((s) => s.l), detected, discarded, reasons };
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

  // 2) merge similar adjacent planes (greedy, area-descending)
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
        const inter = ix * iy;
        const minOwnArea = Math.min(aB.w * aB.h, bB.w * bB.h);
        if (minOwnArea <= 0) continue;
        const overlap = inter / minOwnArea;

        const pa = A.pitch_degrees ?? A.pitch ?? null;
        const pb = B.pitch_degrees ?? B.pitch ?? null;
        const pitchOk = pa == null || pb == null || Math.abs(pa - pb) <= pitchTol;

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
