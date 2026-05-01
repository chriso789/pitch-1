// Snap footprint vertices to the strongest nearby raster roof edge using a
// Sobel-magnitude field. Designed to be conservative:
//   - Max snap distance: 12-20 px (configurable).
//   - Skip targets that look like shadow / vegetation (very dark or
//     strongly green pixels in the destination).
//   - Skip if the candidate has no clear edge support (low Sobel magnitude).
//   - Preserves overall solar bbox coverage by clamping each vertex move to
//     the configured search radius and keeping the vertex order intact.

export type Pt = { x: number; y: number };

export interface Raster {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, length = width*height*4
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function rgbaAt(r: Raster, x: number, y: number): [number, number, number, number] {
  const xi = clamp(Math.round(x), 0, r.width - 1);
  const yi = clamp(Math.round(y), 0, r.height - 1);
  const i = (yi * r.width + xi) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// True when pixel looks like shadow, water, vegetation or pool (reject).
function isVegOrShadow(r: number, g: number, b: number): boolean {
  const lum = luminance(r, g, b);
  if (lum < 28) return true;                      // deep shadow
  if (g > r + 20 && g > b + 10) return true;      // green vegetation
  if (b > r + 25 && b > g - 5) return true;       // pool / water
  return false;
}

// Sobel magnitude on a single luminance value derived from a 3x3 window.
function sobelMag(r: Raster, x: number, y: number): number {
  let gx = 0, gy = 0;
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  let k = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const [rr, gg, bb] = rgbaAt(r, x + dx, y + dy);
      const lum = luminance(rr, gg, bb);
      gx += lum * kx[k];
      gy += lum * ky[k];
      k++;
    }
  }
  return Math.hypot(gx, gy);
}

export interface SnapOptions {
  maxSnapPx?: number;         // 12-20 typical
  minEdgeMag?: number;        // sobel threshold to consider as "real edge"
  inwardBiasPx?: number;      // prefer pulling vertex slightly inward
}

export interface SnapResult {
  snapped: Pt[];
  moved_count: number;
  total_vertices: number;
  avg_move_px: number;
  perimeter_off_eave_ratio: number; // share of perimeter sample points >20px from any edge support
}

// Probe direction perpendicular to the edge between the previous and next
// vertex; we look ±maxSnapPx along that normal for the strongest non-veg edge.
function snapVertex(
  raster: Raster,
  prev: Pt, curr: Pt, next: Pt,
  opts: Required<SnapOptions>,
): { point: Pt; moved: number } {
  const ax = next.x - prev.x;
  const ay = next.y - prev.y;
  const tlen = Math.hypot(ax, ay) || 1;
  // Perpendicular unit vector (two-sided search)
  const nx = -ay / tlen;
  const ny = ax / tlen;

  let bestMag = 0;
  let best: Pt = curr;
  let bestDist = 0;

  for (let d = -opts.maxSnapPx; d <= opts.maxSnapPx; d++) {
    const px = curr.x + nx * d;
    const py = curr.y + ny * d;
    if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) continue;
    const [rr, gg, bb] = rgbaAt(raster, px, py);
    if (isVegOrShadow(rr, gg, bb)) continue;
    const mag = sobelMag(raster, px, py);
    // small inward bias: prefer d in (-opts.maxSnapPx, +inwardBias)
    const biased = mag + (d > 0 ? -opts.inwardBiasPx : 0);
    if (biased > bestMag && mag >= opts.minEdgeMag) {
      bestMag = biased;
      best = { x: px, y: py };
      bestDist = Math.abs(d);
    }
  }

  return { point: best, moved: bestDist };
}

// Distance from a sample point to nearest strong edge inside ±radius along
// the local outward normal. Used by perimeter QA.
function distanceToNearestEdge(
  raster: Raster,
  prev: Pt, curr: Pt, next: Pt,
  radius: number,
  minMag: number,
): number {
  const ax = next.x - prev.x;
  const ay = next.y - prev.y;
  const tlen = Math.hypot(ax, ay) || 1;
  const nx = -ay / tlen;
  const ny = ax / tlen;
  for (let d = 0; d <= radius; d++) {
    for (const sign of [-1, 1]) {
      const px = curr.x + nx * d * sign;
      const py = curr.y + ny * d * sign;
      if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) continue;
      const [rr, gg, bb] = rgbaAt(raster, px, py);
      if (isVegOrShadow(rr, gg, bb)) continue;
      if (sobelMag(raster, px, py) >= minMag) return d;
    }
  }
  return radius + 1;
}

export function snapFootprintToEaves(
  footprint: Pt[],
  raster: Raster | null,
  options: SnapOptions = {},
): SnapResult {
  const opts: Required<SnapOptions> = {
    maxSnapPx: options.maxSnapPx ?? 16,
    minEdgeMag: options.minEdgeMag ?? 60,
    inwardBiasPx: options.inwardBiasPx ?? 1,
  };

  if (!raster || !raster.data || footprint.length < 3) {
    return {
      snapped: footprint.slice(),
      moved_count: 0,
      total_vertices: footprint.length,
      avg_move_px: 0,
      perimeter_off_eave_ratio: 0,
    };
  }

  const out: Pt[] = [];
  let moved = 0;
  let totalMove = 0;
  for (let i = 0; i < footprint.length; i++) {
    const prev = footprint[(i - 1 + footprint.length) % footprint.length];
    const curr = footprint[i];
    const next = footprint[(i + 1) % footprint.length];
    const r = snapVertex(raster, prev, curr, next, opts);
    out.push(r.point);
    if (r.moved > 0) {
      moved++;
      totalMove += r.moved;
    }
  }

  // Perimeter QA: walk perimeter at 4-px sample rate, count samples whose
  // nearest strong edge is > 20 px away.
  const QA_RADIUS = 20;
  const QA_MAG = opts.minEdgeMag;
  let samples = 0;
  let offEave = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.round(segLen / 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const sx = a.x + (b.x - a.x) * t;
      const sy = a.y + (b.y - a.y) * t;
      // local prev/next for normal estimate = endpoints of the current segment
      const d = distanceToNearestEdge(
        raster,
        a, { x: sx, y: sy }, b,
        QA_RADIUS, QA_MAG,
      );
      samples++;
      if (d > QA_RADIUS) offEave++;
    }
  }

  return {
    snapped: out,
    moved_count: moved,
    total_vertices: footprint.length,
    avg_move_px: moved > 0 ? totalMove / moved : 0,
    perimeter_off_eave_ratio: samples > 0 ? offEave / samples : 0,
  };
}
