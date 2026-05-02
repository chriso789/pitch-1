// Hip-roof detector: Sobel edge detection + Hough line transform to find
// diagonal hip lines in the raster. Used to block single_plane_fallback
// on roofs that visibly have multiple planes.
//
// A hip roof has strong diagonal edges running from corners toward the
// center/ridge at ~25–65° from the dominant footprint axis.

export type Point = { x: number; y: number };

export interface HipRoofDetectorInput {
  raster: { width: number; height: number; data: Uint8Array }; // RGBA
  footprint: Point[];
  solarPitchDeg?: number; // dominant pitch from Google Solar
  footprintAreaSqft?: number;
}

export interface DiagonalLine {
  p1: Point;
  p2: Point;
  angleDeg: number; // 0–180
  strength: number; // accumulator score
  lengthPx: number;
}

export interface HipRoofDetectorResult {
  isHipCandidate: boolean;
  diagonalLines: DiagonalLine[];
  peakCandidate: Point | null;
  blockedSinglePlane: boolean;
  debug: {
    enabled: boolean;
    footprint_area_sqft: number;
    solar_pitch_deg: number | null;
    raw_hough_lines: number;
    diagonal_lines_kept: number;
    footprint_axis_deg: number;
    min_angle_from_axis: number;
    max_angle_from_axis: number;
    reason: string;
  };
}

// ─── GEOMETRY UTILS ────────────────────────────────────────────────

function bboxOf(poly: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function footprintDominantAxisDeg(footprint: Point[]): number {
  // Find the longest edge — its angle is the dominant axis
  let maxLen = 0;
  let dominantAngle = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > maxLen) {
      maxLen = len;
      dominantAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
  }
  return ((dominantAngle % 180) + 180) % 180;
}

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

// ─── SOBEL EDGE DETECTION ──────────────────────────────────────────

function sobelEdges(
  gray: Float32Array,
  w: number,
  h: number,
): { magnitude: Float32Array; direction: Float32Array } {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)];
      const tc = gray[(y - 1) * w + x];
      const tr = gray[(y - 1) * w + (x + 1)];
      const ml = gray[y * w + (x - 1)];
      const mr = gray[y * w + (x + 1)];
      const bl = gray[(y + 1) * w + (x - 1)];
      const bc = gray[(y + 1) * w + x];
      const br = gray[(y + 1) * w + (x + 1)];
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      dir[y * w + x] = Math.atan2(gy, gx);
    }
  }
  return { magnitude: mag, direction: dir };
}

// ─── HOUGH LINE TRANSFORM ──────────────────────────────────────────

interface HoughLine {
  rho: number;
  theta: number; // radians
  votes: number;
  p1: Point;
  p2: Point;
}

function houghLines(
  edgeMag: Float32Array,
  w: number,
  h: number,
  roi: { minX: number; minY: number; maxX: number; maxY: number },
  threshold: number,
): HoughLine[] {
  const thetaSteps = 180;
  const maxRho = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoSteps = maxRho * 2;
  const accumulator = new Int32Array(rhoSteps * thetaSteps);

  // Adaptive threshold: use top 15% of edge magnitudes
  const edgeValues: number[] = [];
  for (let y = Math.max(1, Math.floor(roi.minY)); y < Math.min(h - 1, Math.ceil(roi.maxY)); y++) {
    for (let x = Math.max(1, Math.floor(roi.minX)); x < Math.min(w - 1, Math.ceil(roi.maxX)); x++) {
      const m = edgeMag[y * w + x];
      if (m > 0) edgeValues.push(m);
    }
  }
  edgeValues.sort((a, b) => a - b);
  const adaptiveThreshold = edgeValues.length > 0
    ? edgeValues[Math.floor(edgeValues.length * 0.85)]
    : threshold;
  const edgeThreshold = Math.max(threshold, adaptiveThreshold);

  // Vote
  for (let y = Math.max(1, Math.floor(roi.minY)); y < Math.min(h - 1, Math.ceil(roi.maxY)); y++) {
    for (let x = Math.max(1, Math.floor(roi.minX)); x < Math.min(w - 1, Math.ceil(roi.maxX)); x++) {
      if (edgeMag[y * w + x] < edgeThreshold) continue;
      for (let ti = 0; ti < thetaSteps; ti++) {
        const theta = (ti / thetaSteps) * Math.PI;
        const rho = Math.round(x * Math.cos(theta) + y * Math.sin(theta)) + maxRho;
        if (rho >= 0 && rho < rhoSteps) {
          accumulator[rho * thetaSteps + ti]++;
        }
      }
    }
  }

  // Extract peaks
  const peaks: HoughLine[] = [];
  const minVotes = Math.max(15, Math.floor(Math.min(roi.maxX - roi.minX, roi.maxY - roi.minY) * 0.15));

  for (let ri = 0; ri < rhoSteps; ri++) {
    for (let ti = 0; ti < thetaSteps; ti++) {
      const votes = accumulator[ri * thetaSteps + ti];
      if (votes < minVotes) continue;

      // Non-maximum suppression: check 5x5 neighborhood
      let isMax = true;
      for (let dr = -2; dr <= 2 && isMax; dr++) {
        for (let dt = -2; dt <= 2 && isMax; dt++) {
          if (dr === 0 && dt === 0) continue;
          const nr = ri + dr, nt = ti + dt;
          if (nr >= 0 && nr < rhoSteps && nt >= 0 && nt < thetaSteps) {
            if (accumulator[nr * thetaSteps + nt] > votes) isMax = false;
          }
        }
      }
      if (!isMax) continue;

      const theta = (ti / thetaSteps) * Math.PI;
      const rho = ri - maxRho;
      // Convert to line segment endpoints clipped to ROI
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x0 = cosT * rho;
      const y0 = sinT * rho;
      const p1: Point = { x: x0 + 1000 * (-sinT), y: y0 + 1000 * cosT };
      const p2: Point = { x: x0 - 1000 * (-sinT), y: y0 - 1000 * cosT };

      peaks.push({ rho, theta, votes, p1, p2 });
    }
  }

  return peaks.sort((a, b) => b.votes - a.votes).slice(0, 40);
}

// ─── CLIP LINE TO POLYGON ──────────────────────────────────────────

function clipLineToFootprint(
  p1: Point,
  p2: Point,
  footprint: Point[],
): { p1: Point; p2: Point } | null {
  const intersections: Point[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const pt = lineSegmentIntersection(p1, p2, a, b);
    if (pt) intersections.push(pt);
  }
  if (intersections.length < 2) return null;
  // Sort by parameter along (p1→p2)
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  intersections.sort((a, b) => {
    const ta = ((a.x - p1.x) * dx + (a.y - p1.y) * dy) / (len * len);
    const tb = ((b.x - p1.x) * dx + (b.y - p1.y) * dy) / (len * len);
    return ta - tb;
  });
  return { p1: intersections[0], p2: intersections[intersections.length - 1] };
}

function lineSegmentIntersection(
  p1: Point, p2: Point, p3: Point, p4: Point,
): Point | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (u < 0 || u > 1) return null; // Must hit the footprint segment
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

// ─── SYNTHETIC HIP PLANES FROM FOOTPRINT ───────────────────────────

export interface SyntheticHipPlane {
  polygon_px: Point[];
  source: string;
}

/**
 * For a roughly rectangular footprint with a hip roof, create 4 planes:
 * two trapezoidal side planes + two triangular end planes.
 * The ridge runs along the center of the long axis.
 */
export function synthesizeHipPlanesFromFootprint(
  footprint: Point[],
): { planes: SyntheticHipPlane[]; ridgeLine: { p1: Point; p2: Point } } | null {
  if (footprint.length < 3) return null;
  const bb = bboxOf(footprint);
  if (bb.w < 10 || bb.h < 10) return null;

  // Determine dominant axis (long side)
  const isHorizontal = bb.w >= bb.h;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;

  // Ridge runs along the center of the long axis, inset from ends
  const ridgeInset = isHorizontal ? bb.w * 0.2 : bb.h * 0.2;
  const ridgeP1 = isHorizontal
    ? { x: bb.minX + ridgeInset, y: cy }
    : { x: cx, y: bb.minY + ridgeInset };
  const ridgeP2 = isHorizontal
    ? { x: bb.maxX - ridgeInset, y: cy }
    : { x: cx, y: bb.maxY - ridgeInset };

  // Sort footprint corners by angle from centroid to get ordered corners
  const corners = [...footprint].sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    return angA - angB;
  });

  // For a hip roof, use the actual footprint vertices closest to each quadrant
  if (isHorizontal) {
    const topLeft = findClosestCorner(footprint, { x: bb.minX, y: bb.minY });
    const topRight = findClosestCorner(footprint, { x: bb.maxX, y: bb.minY });
    const botRight = findClosestCorner(footprint, { x: bb.maxX, y: bb.maxY });
    const botLeft = findClosestCorner(footprint, { x: bb.minX, y: bb.maxY });

    return {
      planes: [
        // Front (top) trapezoid: topLeft → ridgeP1 → ridgeP2 → topRight
        { polygon_px: [topLeft, ridgeP1, ridgeP2, topRight], source: "hip_roof_synthetic" },
        // Back (bottom) trapezoid: botLeft → botRight → ridgeP2 → ridgeP1
        { polygon_px: [botLeft, botRight, ridgeP2, ridgeP1], source: "hip_roof_synthetic" },
        // Left triangle: topLeft → botLeft → ridgeP1
        { polygon_px: [topLeft, botLeft, ridgeP1], source: "hip_roof_synthetic" },
        // Right triangle: topRight → ridgeP2 → botRight
        { polygon_px: [topRight, ridgeP2, botRight], source: "hip_roof_synthetic" },
      ],
      ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    };
  } else {
    const topLeft = findClosestCorner(footprint, { x: bb.minX, y: bb.minY });
    const topRight = findClosestCorner(footprint, { x: bb.maxX, y: bb.minY });
    const botRight = findClosestCorner(footprint, { x: bb.maxX, y: bb.maxY });
    const botLeft = findClosestCorner(footprint, { x: bb.minX, y: bb.maxY });

    return {
      planes: [
        // Left trapezoid: topLeft → botLeft → ridgeP2 → ridgeP1
        { polygon_px: [topLeft, botLeft, ridgeP2, ridgeP1], source: "hip_roof_synthetic" },
        // Right trapezoid: topRight → ridgeP1 → ridgeP2 → botRight
        { polygon_px: [topRight, ridgeP1, ridgeP2, botRight], source: "hip_roof_synthetic" },
        // Top triangle: topLeft → ridgeP1 → topRight
        { polygon_px: [topLeft, ridgeP1, topRight], source: "hip_roof_synthetic" },
        // Bottom triangle: botLeft → botRight → ridgeP2
        { polygon_px: [botLeft, botRight, ridgeP2], source: "hip_roof_synthetic" },
      ],
      ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    };
  }
}

function findClosestCorner(footprint: Point[], target: Point): Point {
  let best = footprint[0];
  let bestDist = Infinity;
  for (const p of footprint) {
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// ─── MAIN DETECTOR ─────────────────────────────────────────────────

export function detectHipRoof(input: HipRoofDetectorInput): HipRoofDetectorResult {
  const {
    raster,
    footprint,
    solarPitchDeg = null,
    footprintAreaSqft = 0,
  } = input;

  const bb = bboxOf(footprint);
  const axisDeg = footprintDominantAxisDeg(footprint);

  const noResult = (reason: string): HipRoofDetectorResult => ({
    isHipCandidate: false,
    diagonalLines: [],
    peakCandidate: null,
    blockedSinglePlane: false,
    debug: {
      enabled: true,
      footprint_area_sqft: footprintAreaSqft,
      solar_pitch_deg: solarPitchDeg,
      raw_hough_lines: 0,
      diagonal_lines_kept: 0,
      footprint_axis_deg: axisDeg,
      min_angle_from_axis: 0,
      max_angle_from_axis: 0,
      reason,
    },
  });

  // Gate 1: area too small for meaningful detection
  if (bb.w < 30 || bb.h < 30) {
    return noResult("footprint_too_small_for_detection");
  }

  // Convert raster ROI to grayscale
  const roiMinX = Math.max(0, Math.floor(bb.minX) - 5);
  const roiMinY = Math.max(0, Math.floor(bb.minY) - 5);
  const roiMaxX = Math.min(raster.width, Math.ceil(bb.maxX) + 5);
  const roiMaxY = Math.min(raster.height, Math.ceil(bb.maxY) + 5);
  const roiW = roiMaxX - roiMinX;
  const roiH = roiMaxY - roiMinY;

  if (roiW < 20 || roiH < 20) return noResult("roi_too_small");

  const gray = new Float32Array(roiW * roiH);
  for (let y = 0; y < roiH; y++) {
    for (let x = 0; x < roiW; x++) {
      const srcX = roiMinX + x;
      const srcY = roiMinY + y;
      const idx = (srcY * raster.width + srcX) * 4;
      const r = raster.data[idx] || 0;
      const g = raster.data[idx + 1] || 0;
      const b = raster.data[idx + 2] || 0;
      // Mask pixels outside footprint polygon — set to 0 so they don't
      // contribute Sobel gradients or Hough votes.
      const inFootprint = pointInPolygon({ x: srcX, y: srcY }, footprint);
      gray[y * roiW + x] = inFootprint ? (0.299 * r + 0.587 * g + 0.114 * b) : 0;
    }
  }

  // Sobel edge detection
  const { magnitude } = sobelEdges(gray, roiW, roiH);

  // Hough transform
  const roi = { minX: 0, minY: 0, maxX: roiW, maxY: roiH };
  const rawLines = houghLines(magnitude, roiW, roiH, roi, 30);

  // Translate lines back to raster coordinates
  const rasterLines = rawLines.map((l) => ({
    ...l,
    p1: { x: l.p1.x + roiMinX, y: l.p1.y + roiMinY },
    p2: { x: l.p2.x + roiMinX, y: l.p2.y + roiMinY },
  }));

  // Filter for diagonal lines: keep those 25–65° from footprint dominant axis
  const diagonals: DiagonalLine[] = [];
  for (const line of rasterLines) {
    const lineAngle = (line.theta * 180 / Math.PI);
    const lineAngle180 = ((lineAngle % 180) + 180) % 180;
    const diff = Math.abs(lineAngle180 - axisDeg);
    const angleDiff = Math.min(diff, 180 - diff);

    // Keep lines 25–65° from dominant axis (hip lines)
    if (angleDiff < 25 || angleDiff > 65) continue;

    // Clip to footprint
    const clipped = clipLineToFootprint(line.p1, line.p2, footprint);
    if (!clipped) continue;
    const lengthPx = Math.hypot(clipped.p2.x - clipped.p1.x, clipped.p2.y - clipped.p1.y);
    const minLen = Math.min(bb.w, bb.h) * 0.25;
    if (lengthPx < minLen) continue;

    // Check midpoint is inside footprint
    const mid = { x: (clipped.p1.x + clipped.p2.x) / 2, y: (clipped.p1.y + clipped.p2.y) / 2 };
    if (!pointInPolygon(mid, footprint)) continue;

    diagonals.push({
      p1: clipped.p1,
      p2: clipped.p2,
      angleDeg: lineAngle180,
      strength: line.votes,
      lengthPx,
    });
  }

  // Deduplicate close diagonals (keep strongest)
  const dedupedDiagonals: DiagonalLine[] = [];
  for (const d of diagonals) {
    const mid = { x: (d.p1.x + d.p2.x) / 2, y: (d.p1.y + d.p2.y) / 2 };
    const isDup = dedupedDiagonals.some((existing) => {
      const eMid = { x: (existing.p1.x + existing.p2.x) / 2, y: (existing.p1.y + existing.p2.y) / 2 };
      return Math.hypot(mid.x - eMid.x, mid.y - eMid.y) < 15;
    });
    if (!isDup) dedupedDiagonals.push(d);
  }

  // Is this a hip roof candidate?
  const isHipCandidate = dedupedDiagonals.length >= 2;

  // Estimate peak/ridge center from diagonal intersection
  let peakCandidate: Point | null = null;
  if (isHipCandidate && dedupedDiagonals.length >= 2) {
    // Average of midpoints of all diagonals
    const xs = dedupedDiagonals.map((d) => (d.p1.x + d.p2.x) / 2);
    const ys = dedupedDiagonals.map((d) => (d.p1.y + d.p2.y) / 2);
    peakCandidate = {
      x: xs.reduce((a, b) => a + b, 0) / xs.length,
      y: ys.reduce((a, b) => a + b, 0) / ys.length,
    };
  }

  // Should we block single-plane fallback?
  const largePitchedRoof =
    footprintAreaSqft > 1200 &&
    solarPitchDeg !== null &&
    solarPitchDeg > 9.5; // ~2/12 pitch ≈ 9.46°

  const blockedSinglePlane = isHipCandidate || largePitchedRoof;

  const angleDiffs = dedupedDiagonals.map((d) => {
    const diff = Math.abs(d.angleDeg - axisDeg);
    return Math.min(diff, 180 - diff);
  });

  return {
    isHipCandidate,
    diagonalLines: dedupedDiagonals,
    peakCandidate,
    blockedSinglePlane,
    debug: {
      enabled: true,
      footprint_area_sqft: footprintAreaSqft,
      solar_pitch_deg: solarPitchDeg,
      raw_hough_lines: rawLines.length,
      diagonal_lines_kept: dedupedDiagonals.length,
      footprint_axis_deg: axisDeg,
      min_angle_from_axis: angleDiffs.length > 0 ? Math.min(...angleDiffs) : 0,
      max_angle_from_axis: angleDiffs.length > 0 ? Math.max(...angleDiffs) : 0,
      reason: isHipCandidate
        ? `hip_candidate:${dedupedDiagonals.length}_diagonal_lines`
        : largePitchedRoof
          ? "large_pitched_roof_blocked"
          : "not_hip_candidate",
    },
  };
}
