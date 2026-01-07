/**
 * Roof Geometry Reconstructor (Optimized)
 * Creates proper, connected roof geometry from perimeter and Solar API data.
 */

type XY = [number, number];

export interface ReconstructedRoof {
  ridges: RoofLine[];
  hips: RoofLine[];
  valleys: RoofLine[];
  facets: ReconstructedFacet[];
  diagramQuality: 'excellent' | 'good' | 'fair' | 'simplified';
  warnings: string[];
}

export interface RoofLine {
  id: string;
  start: XY;
  end: XY;
  lengthFt: number;
  connectedTo: string[];
}

export interface ReconstructedFacet {
  id: string;
  index: number;
  polygon: XY[];
  areaSqft: number;
  pitch: string;
  azimuthDegrees: number;
  direction: string;
  color: string;
}

interface SolarSegmentInfo {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  areaSqft?: number;
}

const FACET_COLORS = [
  'rgba(59, 130, 246, 0.35)', 'rgba(34, 197, 94, 0.35)',
  'rgba(251, 191, 36, 0.35)', 'rgba(239, 68, 68, 0.35)',
  'rgba(139, 92, 246, 0.35)', 'rgba(236, 72, 153, 0.35)',
  'rgba(20, 184, 166, 0.35)', 'rgba(249, 115, 22, 0.35)',
];

// ===== Main Export =====
export function reconstructRoofGeometry(
  perimeterVertices: XY[],
  solarSegments: SolarSegmentInfo[] = [],
  predominantPitch: string = '6/12'
): ReconstructedRoof {
  const warnings: string[] = [];
  let vertices = [...perimeterVertices];
  
  // Ensure closed polygon, then remove closing vertex
  if (vertices.length > 0 && 
      (vertices[0][0] !== vertices[vertices.length - 1][0] || 
       vertices[0][1] !== vertices[vertices.length - 1][1])) {
    vertices = [...vertices, vertices[0]];
  }
  vertices = vertices.slice(0, -1);
  
  if (vertices.length < 4) {
    return createSimplifiedResult(vertices, ['Too few vertices']);
  }
  
  const reflexIndices = findReflexVertices(vertices);
  const n = vertices.length;
  
  // Rectangle (4 vertices, no reflex)
  if (n === 4 && reflexIndices.size === 0) {
    return reconstructRectangularRoof(vertices, solarSegments, predominantPitch);
  }
  
  // L/T/U shapes (6-12 vertices, 1-4 reflex)
  if (n >= 6 && n <= 12 && reflexIndices.size <= 4) {
    return reconstructMultiWingRoof(vertices, reflexIndices, predominantPitch);
  }
  
  // Complex: simplified approach
  return reconstructComplexRoof(vertices, reflexIndices, predominantPitch);
}

// ===== Cross-Hip Detection =====
function detectCrossHip(solarSegments: SolarSegmentInfo[]): boolean {
  if (!solarSegments || solarSegments.length < 4) return false;
  const c = { N: 0, S: 0, E: 0, W: 0 };
  solarSegments.forEach(seg => {
    const az = ((seg.azimuthDegrees ?? 0) % 360 + 360) % 360;
    if (az >= 315 || az < 45) c.N++;
    else if (az >= 45 && az < 135) c.E++;
    else if (az >= 135 && az < 225) c.S++;
    else c.W++;
  });
  return c.N > 0 && c.S > 0 && c.E > 0 && c.W > 0;
}

function reconstructCrossHipRoof(vertices: XY[], pitch: string): ReconstructedRoof {
  const b = getBounds(vertices);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const center: XY = [cx, cy];
  const insetX = (b.maxX - b.minX) * 0.4, insetY = (b.maxY - b.minY) * 0.4;
  
  const ridges: RoofLine[] = [
    { id: 'ridge_ew', start: [b.minX + insetX, cy], end: [b.maxX - insetX, cy], lengthFt: distanceFt([b.minX + insetX, cy], [b.maxX - insetX, cy]), connectedTo: ['ridge_ns'] },
    { id: 'ridge_ns', start: [cx, b.minY + insetY], end: [cx, b.maxY - insetY], lengthFt: distanceFt([cx, b.minY + insetY], [cx, b.maxY - insetY]), connectedTo: ['ridge_ew'] }
  ];
  
  const corners = identifyCorners(vertices);
  const sw = corners.reduce((best, v) => (v[1] + v[0] < best[1] + best[0]) ? v : best, corners[0]);
  const ne = corners.reduce((best, v) => (v[1] + v[0] > best[1] + best[0]) ? v : best, corners[0]);
  const se = corners.reduce((best, v) => (v[0] - v[1] > best[0] - best[1]) ? v : best, corners[0]);
  const nw = corners.reduce((best, v) => (v[1] - v[0] > best[1] - best[0]) ? v : best, corners[0]);
  
  const hips: RoofLine[] = [
    { id: 'hip_sw', start: sw, end: center, lengthFt: distanceFt(sw, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_se', start: se, end: center, lengthFt: distanceFt(se, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_ne', start: ne, end: center, lengthFt: distanceFt(ne, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_nw', start: nw, end: center, lengthFt: distanceFt(nw, center), connectedTo: ['ridge_ew', 'ridge_ns'] }
  ];
  
  const facets: ReconstructedFacet[] = [
    { id: 'facet_s', index: 0, polygon: [sw, se, center, sw], areaSqft: triArea(sw, se, center), pitch, azimuthDegrees: 180, direction: 'S', color: FACET_COLORS[0] },
    { id: 'facet_e', index: 1, polygon: [se, ne, center, se], areaSqft: triArea(se, ne, center), pitch, azimuthDegrees: 90, direction: 'E', color: FACET_COLORS[1] },
    { id: 'facet_n', index: 2, polygon: [ne, nw, center, ne], areaSqft: triArea(ne, nw, center), pitch, azimuthDegrees: 0, direction: 'N', color: FACET_COLORS[2] },
    { id: 'facet_w', index: 3, polygon: [nw, sw, center, nw], areaSqft: triArea(nw, sw, center), pitch, azimuthDegrees: 270, direction: 'W', color: FACET_COLORS[3] }
  ];
  
  return { ridges, hips, valleys: [], facets, diagramQuality: 'excellent', warnings: [] };
}

// ===== Rectangular Roof =====
function reconstructRectangularRoof(vertices: XY[], solarSegments: SolarSegmentInfo[], pitch: string): ReconstructedRoof {
  if (detectCrossHip(solarSegments)) return reconstructCrossHipRoof(vertices, pitch);
  
  const b = getBounds(vertices);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const isWider = w >= h;
  const inset = (isWider ? h : w) * 0.4;
  const corners = identifyCorners(vertices);
  
  const ridgeStart: XY = isWider ? [b.minX + inset, (b.minY + b.maxY) / 2] : [(b.minX + b.maxX) / 2, b.minY + inset];
  const ridgeEnd: XY = isWider ? [b.maxX - inset, (b.minY + b.maxY) / 2] : [(b.minX + b.maxX) / 2, b.maxY - inset];
  
  const ridge: RoofLine = { id: 'ridge_0', start: ridgeStart, end: ridgeEnd, lengthFt: distanceFt(ridgeStart, ridgeEnd), connectedTo: [] };
  
  const hips: RoofLine[] = corners.map((corner, i) => {
    const target = distance(corner, ridgeStart) <= distance(corner, ridgeEnd) ? ridgeStart : ridgeEnd;
    return { id: `hip_${i}`, start: corner, end: target, lengthFt: distanceFt(corner, target), connectedTo: ['ridge_0'] };
  });
  
  const facets = createRectFacets(corners, ridgeStart, ridgeEnd, pitch);
  return { ridges: [ridge], hips, valleys: [], facets, diagramQuality: 'excellent', warnings: [] };
}

// ===== Multi-Wing (L/T/U) =====
function reconstructMultiWingRoof(vertices: XY[], reflexIndices: Set<number>, pitch: string): ReconstructedRoof {
  if (reflexIndices.size > 2) {
    return { ridges: [], hips: [], valleys: [], facets: [{ id: 'facet_0', index: 0, polygon: [...vertices, vertices[0]], areaSqft: polyArea(vertices), pitch, azimuthDegrees: 0, direction: 'Mixed', color: FACET_COLORS[0] }], diagramQuality: 'simplified', warnings: ['Complex shape - perimeter only'] };
  }
  
  const n = vertices.length;
  const ridges: RoofLine[] = [], hips: RoofLine[] = [], valleys: RoofLine[] = [];
  const wings = detectWings(vertices, reflexIndices);
  
  if (wings.length < 2) return reconstructComplexRoof(vertices, reflexIndices, pitch);
  
  const wingRidges: XY[][] = [];
  wings.forEach((wing, idx) => {
    const wb = getBounds(wing.vertices);
    const ww = wb.maxX - wb.minX, wh = wb.maxY - wb.minY;
    const isWider = ww >= wh;
    const inset = (isWider ? wh : ww) * 0.4;
    const start: XY = isWider ? [wb.minX + inset, (wb.minY + wb.maxY) / 2] : [(wb.minX + wb.maxX) / 2, wb.minY + inset];
    const end: XY = isWider ? [wb.maxX - inset, (wb.minY + wb.maxY) / 2] : [(wb.minX + wb.maxX) / 2, wb.maxY - inset];
    wingRidges.push([start, end]);
    ridges.push({ id: `ridge_${idx}`, start, end, lengthFt: distanceFt(start, end), connectedTo: [] });
  });
  
  // Connect non-reflex corners to their wing's ridge
  let hipIdx = 0;
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue;
    const v = vertices[i];
    let bestWing = 0, bestDist = Infinity;
    wings.forEach((wing, wIdx) => {
      const d = Math.min(...wing.vertices.map(wv => distance(v, wv)));
      if (d < bestDist) { bestDist = d; bestWing = wIdx; }
    });
    const r = ridges[bestWing];
    const target = distance(v, r.start) <= distance(v, r.end) ? r.start : r.end;
    hips.push({ id: `hip_${hipIdx++}`, start: v, end: target, lengthFt: distanceFt(v, target), connectedTo: [r.id] });
  }
  
  // Valleys from reflex vertices
  reflexIndices.forEach(idx => {
    const v = vertices[idx];
    let nearest = ridges[0].start, minD = Infinity;
    ridges.forEach(r => {
      if (distance(v, r.start) < minD) { minD = distance(v, r.start); nearest = r.start; }
      if (distance(v, r.end) < minD) { minD = distance(v, r.end); nearest = r.end; }
    });
    valleys.push({ id: `valley_${idx}`, start: v, end: nearest, lengthFt: distanceFt(v, nearest), connectedTo: [] });
  });
  
  const facets: ReconstructedFacet[] = [{ id: 'facet_0', index: 0, polygon: [...vertices, vertices[0]], areaSqft: polyArea(vertices), pitch, azimuthDegrees: 0, direction: 'Mixed', color: FACET_COLORS[0] }];
  return { ridges, hips, valleys, facets, diagramQuality: valleys.length > 0 ? 'good' : 'excellent', warnings: [] };
}

// ===== Complex Roof =====
function reconstructComplexRoof(vertices: XY[], reflexIndices: Set<number>, pitch: string): ReconstructedRoof {
  const b = getBounds(vertices);
  const c = getCentroid(vertices);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const isWider = w >= h;
  const inset = (isWider ? w : h) * 0.25;
  
  const ridgeStart: XY = isWider ? [b.minX + inset, c[1]] : [c[0], b.minY + inset];
  const ridgeEnd: XY = isWider ? [b.maxX - inset, c[1]] : [c[0], b.maxY - inset];
  
  const ridges: RoofLine[] = [{ id: 'ridge_0', start: ridgeStart, end: ridgeEnd, lengthFt: distanceFt(ridgeStart, ridgeEnd), connectedTo: [] }];
  const hips: RoofLine[] = [], valleys: RoofLine[] = [];
  
  vertices.forEach((v, i) => {
    const isReflex = reflexIndices.has(i);
    const target = distance(v, ridgeStart) < distance(v, ridgeEnd) ? ridgeStart : ridgeEnd;
    const line: RoofLine = { id: `${isReflex ? 'valley' : 'hip'}_${i}`, start: v, end: target, lengthFt: distanceFt(v, target), connectedTo: ['ridge_0'] };
    if (isReflex) valleys.push(line); else hips.push(line);
  });
  
  const facets: ReconstructedFacet[] = [{ id: 'facet_0', index: 0, polygon: [...vertices, vertices[0]], areaSqft: polyArea(vertices), pitch, azimuthDegrees: 0, direction: 'Mixed', color: FACET_COLORS[0] }];
  return { ridges, hips, valleys, facets, diagramQuality: 'fair', warnings: ['Complex roof - simplified geometry'] };
}

function createSimplifiedResult(vertices: XY[], warnings: string[]): ReconstructedRoof {
  return { ridges: [], hips: [], valleys: [], facets: vertices.length >= 3 ? [{ id: 'facet_0', index: 0, polygon: [...vertices, vertices[0]], areaSqft: polyArea(vertices), pitch: '0/12', azimuthDegrees: 0, direction: 'Unknown', color: FACET_COLORS[0] }] : [], diagramQuality: 'simplified', warnings };
}

// ===== Utilities =====
interface Wing { vertices: XY[]; indices: number[]; }

function detectWings(vertices: XY[], reflexIndices: Set<number>): Wing[] {
  const n = vertices.length;
  if (reflexIndices.size === 0) return [{ vertices, indices: Array.from({ length: n }, (_, i) => i) }];
  
  const wings: Wing[] = [];
  const reflexArr = Array.from(reflexIndices).sort((a, b) => a - b);
  
  for (let r = 0; r < reflexArr.length; r++) {
    const start = reflexArr[r], end = reflexArr[(r + 1) % reflexArr.length];
    const indices: number[] = [];
    let cur = start;
    for (let safety = 0; safety <= n; safety++) {
      indices.push(cur);
      if (cur === end) break;
      cur = (cur + 1) % n;
    }
    if (indices.length >= 3) wings.push({ vertices: indices.map(i => vertices[i]), indices });
  }
  return wings.filter(w => w.vertices.length >= 3);
}

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n], curr = vertices[i], next = vertices[(i + 1) % n];
    const cross = (prev[0] - curr[0]) * (next[1] - curr[1]) - (prev[1] - curr[1]) * (next[0] - curr[0]);
    if (cross < 0) reflex.add(i);
  }
  return reflex;
}

function identifyCorners(vertices: XY[]): XY[] {
  if (vertices.length === 4) {
    const sorted = [...vertices].sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);
    return [sorted[0], sorted[1], sorted[3], sorted[2]];
  }
  const b = getBounds(vertices);
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
}

function createRectFacets(corners: XY[], rs: XY, re: XY, pitch: string): ReconstructedFacet[] {
  if (corners.length < 4) return [];
  return [
    { id: 'facet_0', index: 0, polygon: [corners[0], corners[3], rs, corners[0]], areaSqft: polyArea([corners[0], corners[3], rs]), pitch, azimuthDegrees: 270, direction: 'W', color: FACET_COLORS[0] },
    { id: 'facet_1', index: 1, polygon: [corners[1], re, corners[2], corners[1]], areaSqft: polyArea([corners[1], re, corners[2]]), pitch, azimuthDegrees: 90, direction: 'E', color: FACET_COLORS[1] },
    { id: 'facet_2', index: 2, polygon: [corners[0], rs, re, corners[1], corners[0]], areaSqft: polyArea([corners[0], rs, re, corners[1]]), pitch, azimuthDegrees: 180, direction: 'S', color: FACET_COLORS[2] },
    { id: 'facet_3', index: 3, polygon: [corners[3], corners[2], re, rs, corners[3]], areaSqft: polyArea([corners[3], corners[2], re, rs]), pitch, azimuthDegrees: 0, direction: 'N', color: FACET_COLORS[3] }
  ];
}

function getBounds(v: XY[]) {
  const xs = v.map(p => p[0]), ys = v.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function getCentroid(v: XY[]): XY {
  return [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length];
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

function distanceFt(a: XY, b: XY): number {
  const midLat = (a[1] + b[1]) / 2;
  const ftPerDegLat = 364000, ftPerDegLng = 364000 * Math.cos(midLat * Math.PI / 180);
  return Math.sqrt(((b[0] - a[0]) * ftPerDegLng) ** 2 + ((b[1] - a[1]) * ftPerDegLat) ** 2);
}

function triArea(a: XY, b: XY, c: XY): number {
  const ftPerDeg = 364000;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2 * ftPerDeg * ftPerDeg;
}

function polyArea(v: XY[]): number {
  if (v.length < 3) return 0;
  const midLat = v.reduce((s, p) => s + p[1], 0) / v.length;
  const mLat = 111320, mLng = 111320 * Math.cos(midLat * Math.PI / 180);
  let area = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    area += v[i][0] * mLng * v[j][1] * mLat - v[j][0] * mLng * v[i][1] * mLat;
  }
  return Math.abs(area) / 2 * 10.764;
}

// ===== WKT Export =====
export function roofToLinearFeaturesWKT(roof: ReconstructedRoof): Array<{ type: string; wkt: string; length_ft: number }> {
  const features: Array<{ type: string; wkt: string; length_ft: number }> = [];
  roof.ridges.forEach(r => features.push({ type: 'ridge', wkt: `LINESTRING(${r.start[0]} ${r.start[1]}, ${r.end[0]} ${r.end[1]})`, length_ft: r.lengthFt }));
  roof.hips.forEach(h => features.push({ type: 'hip', wkt: `LINESTRING(${h.start[0]} ${h.start[1]}, ${h.end[0]} ${h.end[1]})`, length_ft: h.lengthFt }));
  roof.valleys.forEach(v => features.push({ type: 'valley', wkt: `LINESTRING(${v.start[0]} ${v.start[1]}, ${v.end[0]} ${v.end[1]})`, length_ft: v.lengthFt }));
  return features;
}
