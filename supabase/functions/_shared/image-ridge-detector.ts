// Image-based ridge detector for roof footprints.
//
// Pipeline:
//   1. Crop a grayscale ROI from the raster covering the footprint bbox.
//   2. Run Sobel edge detection.
//   3. Run a Hough line transform (rho/theta accumulator).
//   4. Score lines by:
//        - accumulator strength (length / continuity proxy)
//        - alignment with one of the dominant solar-segment azimuths
//          (ridges run PERPENDICULAR to the panel/face azimuth)
//        - whether the line crosses the footprint interior
//   5. Return the top N as Line { p1, p2, score } in raster pixel coords.
//
// Output is consumed by ridge-plane-splitter.splitPlanesFromRidges().

export type Point = { x: number; y: number };
export type Line = { p1: Point; p2: Point; score: number };

export type RidgeDetectorInput = {
  raster: { width: number; height: number; data: Uint8Array }; // RGBA
  polygon: Point[];                  // footprint in raster pixel coords
  solarAzimuthsDeg?: number[];       // optional roof-segment azimuths (0..360)
  maxRidges?: number;                // hard cap on returned lines
};

export type RidgeDetectorDebug = {
  roi: { x: number; y: number; w: number; h: number } | null;
  raw_line_count: number;
  filtered_line_count: number;
  selected_count: number;
  azimuth_targets_deg: number[];
  scores: number[];
};

// ─── point-in-polygon ──────────────────────────────────────────────────────

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function bboxOf(poly: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── grayscale + sobel ─────────────────────────────────────────────────────

function rasterToGray(
  data: Uint8Array, W: number, H: number,
  x0: number, y0: number, w: number, h: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= W) continue;
      const idx = (sy * W + sx) * 4;
      // Luma ~ 0.299R + 0.587G + 0.114B
      out[y * w + x] =
        (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) | 0;
    }
  }
  return out;
}

function sobel(gray: Uint8Array, w: number, h: number): {
  mag: Float32Array; ang: Float32Array;
} {
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], tc = gray[i - w], tr = gray[i - w + 1];
      const ml = gray[i - 1],            mr = gray[i + 1];
      const bl = gray[i + w - 1], bc = gray[i + w], br = gray[i + w + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      ang[i] = Math.atan2(gy, gx); // -PI..PI
    }
  }
  return { mag, ang };
}

// ─── hough line transform ──────────────────────────────────────────────────

type HoughLine = {
  rho: number; theta: number; votes: number;
  // line endpoints clipped to ROI
  p1: Point; p2: Point;
};

function hough(
  mag: Float32Array, w: number, h: number,
  threshold: number,
  thetaSteps = 180,
  rhoStep = 1,
): HoughLine[] {
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = 2 * diag + 1;
  const acc = new Int32Array(thetaSteps * rhoBins);
  const cosT = new Float32Array(thetaSteps);
  const sinT = new Float32Array(thetaSteps);
  for (let t = 0; t < thetaSteps; t++) {
    const a = (t / thetaSteps) * Math.PI;
    cosT[t] = Math.cos(a);
    sinT[t] = Math.sin(a);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = mag[y * w + x];
      if (m < threshold) continue;
      for (let t = 0; t < thetaSteps; t++) {
        const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
        if (r < 0 || r >= rhoBins) continue;
        acc[t * rhoBins + r]++;
      }
    }
  }
  // Local-maxima peak picking.
  const peaks: HoughLine[] = [];
  const minVotes = Math.max(20, Math.floor((w + h) * 0.05));
  for (let t = 1; t < thetaSteps - 1; t++) {
    for (let r = 1; r < rhoBins - 1; r++) {
      const v = acc[t * rhoBins + r];
      if (v < minVotes) continue;
      // 3x3 NMS
      let isMax = true;
      for (let dt = -1; dt <= 1 && isMax; dt++)
        for (let dr = -1; dr <= 1; dr++) {
          if (!dt && !dr) continue;
          if (acc[(t + dt) * rhoBins + (r + dr)] > v) { isMax = false; break; }
        }
      if (!isMax) continue;
      const theta = (t / thetaSteps) * Math.PI;
      const rho = r - diag;
      const { p1, p2 } = clipLineToBox(rho, theta, w, h);
      if (p1 && p2) peaks.push({ rho, theta, votes: v, p1, p2 });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks.slice(0, 60);
}

function clipLineToBox(rho: number, theta: number, w: number, h: number): { p1: Point | null; p2: Point | null } {
  const c = Math.cos(theta), s = Math.sin(theta);
  // Line: x*c + y*s = rho
  const pts: Point[] = [];
  // Intersect with x=0, x=w-1, y=0, y=h-1
  if (Math.abs(s) > 1e-6) {
    const y0 = (rho - 0 * c) / s;
    if (y0 >= 0 && y0 <= h - 1) pts.push({ x: 0, y: y0 });
    const y1 = (rho - (w - 1) * c) / s;
    if (y1 >= 0 && y1 <= h - 1) pts.push({ x: w - 1, y: y1 });
  }
  if (Math.abs(c) > 1e-6) {
    const x0 = (rho - 0 * s) / c;
    if (x0 >= 0 && x0 <= w - 1) pts.push({ x: x0, y: 0 });
    const x1 = (rho - (h - 1) * s) / c;
    if (x1 >= 0 && x1 <= w - 1) pts.push({ x: x1, y: h - 1 });
  }
  if (pts.length < 2) return { p1: null, p2: null };
  // Pick the two farthest-apart intersections.
  let best = { d: -1, a: pts[0], b: pts[1] };
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > best.d) best = { d, a: pts[i], b: pts[j] };
    }
  return { p1: best.a, p2: best.b };
}

// ─── azimuth helpers ───────────────────────────────────────────────────────

// Convert a Hough theta (radians, 0..PI) to a line bearing in degrees [0..180).
function thetaToBearingDeg(theta: number): number {
  // The line direction is perpendicular to (cos θ, sin θ),
  // i.e. its tangent vector is (-sin θ, cos θ).
  // Bearing from north (y-up convention; image has y-down so flip y).
  const dx = -Math.sin(theta);
  const dy = -Math.cos(theta); // flip y for image coords
  let deg = Math.atan2(dx, dy) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg % 180;
}

function smallestAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

// ─── public entry point ────────────────────────────────────────────────────

export function detectRidgesInPolygon(
  input: RidgeDetectorInput,
): { lines: Line[]; debug: RidgeDetectorDebug } {
  const { raster, polygon, solarAzimuthsDeg = [], maxRidges = 4 } = input;
  const debug: RidgeDetectorDebug = {
    roi: null,
    raw_line_count: 0,
    filtered_line_count: 0,
    selected_count: 0,
    azimuth_targets_deg: [],
    scores: [],
  };
  if (!polygon || polygon.length < 3 || !raster?.data) {
    return { lines: [], debug };
  }

  const bb = bboxOf(polygon);
  const pad = 8;
  const x0 = Math.max(0, Math.floor(bb.minX - pad));
  const y0 = Math.max(0, Math.floor(bb.minY - pad));
  const x1 = Math.min(raster.width - 1, Math.ceil(bb.maxX + pad));
  const y1 = Math.min(raster.height - 1, Math.ceil(bb.maxY + pad));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 16 || h < 16) return { lines: [], debug };
  debug.roi = { x: x0, y: y0, w, h };

  // 1. grayscale + sobel
  const gray = rasterToGray(raster.data, raster.width, raster.height, x0, y0, w, h);
  const { mag } = sobel(gray, w, h);

  // 2. Mask gradient to polygon interior so background streets / neighbors don't vote.
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const inside = pointInPolygon({ x: x + x0, y: y + y0 }, polygon);
      if (!inside) { mag[y * w + x] = 0; continue; }
      sum += mag[y * w + x]; n++;
    }
  }
  if (n === 0) return { lines: [], debug };
  const meanMag = sum / n;
  const threshold = Math.max(40, meanMag * 1.6);

  // 3. Hough
  const peaks = hough(mag, w, h, threshold);
  debug.raw_line_count = peaks.length;
  if (!peaks.length) return { lines: [], debug };

  // 4. Score: votes (normalised) + azimuth-perpendicular bonus + interior-crossing bonus.
  // Ridges run perpendicular to face azimuths. So the target line bearings are azimuth+90.
  const azTargets = solarAzimuthsDeg
    .filter((a) => Number.isFinite(a))
    .map((a) => ((a + 90) % 180 + 180) % 180);
  // De-duplicate azimuth targets within 10°.
  const uniqAz: number[] = [];
  for (const a of azTargets) {
    if (!uniqAz.some((u) => smallestAngleDiff(u, a) < 10)) uniqAz.push(a);
  }
  debug.azimuth_targets_deg = uniqAz.map((a) => Math.round(a));

  const maxVotes = peaks[0].votes;
  type Scored = Line & { _votes: number };
  const scored: Scored[] = [];
  for (const pk of peaks) {
    // Translate ROI-local endpoints back to raster space.
    const p1 = { x: pk.p1.x + x0, y: pk.p1.y + y0 };
    const p2 = { x: pk.p2.x + x0, y: pk.p2.y + y0 };

    // Crossing test: sample 9 points and require a few inside the footprint.
    let inside = 0;
    for (let k = 1; k <= 9; k++) {
      const t = k / 10;
      if (pointInPolygon({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t }, polygon)) inside++;
    }
    if (inside < 3) continue;

    const voteScore = pk.votes / maxVotes;
    let azScore = 0.5; // neutral if no targets
    if (uniqAz.length) {
      const bearing = thetaToBearingDeg(pk.theta);
      const minDiff = uniqAz.reduce((m, a) => Math.min(m, smallestAngleDiff(bearing, a)), 90);
      azScore = Math.max(0, 1 - minDiff / 25); // 0° → 1.0, 25°+ → 0
    }
    const interiorScore = inside / 9;
    const score = voteScore * 0.55 + azScore * 0.30 + interiorScore * 0.15;
    scored.push({ p1, p2, score, _votes: pk.votes });
  }
  debug.filtered_line_count = scored.length;
  if (!scored.length) return { lines: [], debug };

  // 5. Suppress near-duplicate ridges (same orientation + close offset).
  scored.sort((a, b) => b.score - a.score);
  const kept: Scored[] = [];
  for (const s of scored) {
    let dup = false;
    const sBearing = Math.atan2(s.p2.y - s.p1.y, s.p2.x - s.p1.x);
    const sMid = { x: (s.p1.x + s.p2.x) / 2, y: (s.p1.y + s.p2.y) / 2 };
    for (const k of kept) {
      const kBearing = Math.atan2(k.p2.y - k.p1.y, k.p2.x - k.p1.x);
      let dB = Math.abs(sBearing - kBearing);
      while (dB > Math.PI) dB -= Math.PI;
      if (dB > Math.PI / 2) dB = Math.PI - dB;
      const kMid = { x: (k.p1.x + k.p2.x) / 2, y: (k.p1.y + k.p2.y) / 2 };
      const offset = Math.hypot(sMid.x - kMid.x, sMid.y - kMid.y);
      if (dB < 0.18 && offset < 25) { dup = true; break; }
    }
    if (!dup) kept.push(s);
    if (kept.length >= maxRidges) break;
  }

  debug.selected_count = kept.length;
  debug.scores = kept.map((k) => Number(k.score.toFixed(3)));
  return {
    lines: kept.map(({ p1, p2, score }) => ({ p1, p2, score })),
    debug,
  };
}
