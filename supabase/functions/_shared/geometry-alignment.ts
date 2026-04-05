// Geometry Alignment & Calibration Module
// Ports Python Stage 2: AlignmentTransform, pixel-to-feet calibration,
// line measurement extraction, and final report payload shaping.

// ============================================
// TYPES
// ============================================

export interface AlignmentTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  targetWidth: number | null;
  targetHeight: number | null;
}

export interface LineMeasurement {
  lineType: string;
  segmentCount: number;
  pixelLength: number;
  estimatedLengthFt: number | null;
}

export type LineKey = 'ridge' | 'valley' | 'hip' | 'eave' | 'rake';
export const LINE_KEYS: LineKey[] = ['ridge', 'valley', 'hip', 'eave', 'rake'];

/** Grouped polylines keyed by edge type */
export type GroupedGeometry = Record<LineKey, number[][][]>;

/** Pre-parsed vendor geometry from parse-roof-report-geometry output */
export interface VendorGeometry {
  ridge?: number[][][];
  valley?: number[][][];
  hip?: number[][][];
  eave?: number[][][];
  rake?: number[][][];
}

export interface CalibrationDebug {
  pixelTotals: Record<string, number>;
  candidates: Record<string, { pixelTotal: number; vendorFt: number; ftPerPixel: number }>;
  ftPerPixelFinal: number | null;
  alignmentTransform: AlignmentTransform;
  diagramImage: string | null;
  aerialImage: string | null;
}

export interface FinalReportPayload {
  property: {
    inputAddress: string;
    formattedAddress: string | null;
    latitude: number;
    longitude: number;
  };
  report: {
    totalRoofAreaSqft: number | null;
    squares: number | null;
    predominantPitch: string | null;
    predominantPitchRatio: number | null;
    googlePitchDegrees: number | null;
    facets: number | null;
    lineTotals: Record<string, {
      segmentCount: number;
      pixelLength: number;
      estimatedLengthFt: number | null;
    }>;
  };
  calibration: CalibrationDebug;
  confidence: ConfidenceScore | null;
}

// ============================================
// GEOMETRY HELPERS
// ============================================

function pointDistance(a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function polylinePixelLength(polyline: number[][]): number {
  if (!polyline || polyline.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += pointDistance(polyline[i - 1], polyline[i]);
  }
  return total;
}

// ============================================
// ALIGNMENT TRANSFORM
// ============================================

export function inferAlignmentTransform(
  diagramSize: { width: number | null; height: number | null },
  aerialSize: { width: number | null; height: number | null },
): AlignmentTransform {
  const dw = diagramSize.width;
  const dh = diagramSize.height;
  const aw = aerialSize.width;
  const ah = aerialSize.height;

  if (!dw || !dh || !aw || !ah) {
    return {
      scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0,
      sourceWidth: dw, sourceHeight: dh, targetWidth: aw, targetHeight: ah,
    };
  }

  return {
    scaleX: aw / dw,
    scaleY: ah / dh,
    offsetX: 0,
    offsetY: 0,
    sourceWidth: dw,
    sourceHeight: dh,
    targetWidth: aw,
    targetHeight: ah,
  };
}

export function applyTransformToPolyline(
  polyline: number[][],
  tf: AlignmentTransform,
): number[][] {
  return polyline.map(([x, y]) => [
    x * tf.scaleX + tf.offsetX,
    y * tf.scaleY + tf.offsetY,
  ]);
}

export function transformGeometry(
  grouped: GroupedGeometry,
  tf: AlignmentTransform,
): GroupedGeometry {
  const out = {} as GroupedGeometry;
  for (const key of LINE_KEYS) {
    out[key] = (grouped[key] || []).map(seg => applyTransformToPolyline(seg, tf));
  }
  return out;
}

// ============================================
// FLATTEN VENDOR GEOMETRY
// ============================================

/**
 * Flatten parsed vendor geometry payloads into grouped polylines by edge type.
 * Accepts either a VendorGeometry object or an array of raw geometry payloads
 * (as returned by parse-roof-report-geometry).
 */
export function flattenGeometrySegments(
  input: VendorGeometry | Array<{ data?: Record<string, unknown> }>,
): GroupedGeometry {
  const grouped: GroupedGeometry = { ridge: [], valley: [], hip: [], eave: [], rake: [] };

  if (Array.isArray(input)) {
    for (const item of input) {
      const gd = item?.data;
      if (!gd || typeof gd !== 'object') continue;
      for (const key of LINE_KEYS) {
        const value = (gd as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const segment of value) {
            if (Array.isArray(segment) && segment.length >= 2) {
              grouped[key].push(segment as number[][]);
            }
          }
        }
      }
    }
  } else {
    for (const key of LINE_KEYS) {
      const segments = input[key];
      if (Array.isArray(segments)) {
        grouped[key].push(...segments);
      }
    }
  }

  return grouped;
}

// ============================================
// PIXEL-TO-FEET CALIBRATION
// ============================================

const VENDOR_KEY_MAP: Record<LineKey, string> = {
  ridge: 'ridgeFt',
  valley: 'valleyFt',
  hip: 'hipFt',
  eave: 'eaveFt',
  rake: 'rakeFt',
};

/**
 * Estimate feet-per-pixel using median of vendor truth line lengths
 * divided by pixel lengths for each line type.
 * Matches the Python script's median-based approach.
 */
export function estimateFeetPerPixel(
  transformedGeometry: GroupedGeometry,
  vendorLengths: Partial<Record<string, number>>,
): { ftPerPixel: number | null; debug: CalibrationDebug } {
  const pixelTotals: Record<string, number> = {};
  for (const key of LINE_KEYS) {
    pixelTotals[key] = (transformedGeometry[key] || [])
      .reduce((sum, seg) => sum + polylinePixelLength(seg), 0);
  }

  const candidates: CalibrationDebug['candidates'] = {};
  const ratios: number[] = [];

  for (const key of LINE_KEYS) {
    const px = pixelTotals[key] || 0;
    const vendorKey = VENDOR_KEY_MAP[key];
    const ft = vendorLengths[vendorKey];
    if (px > 0 && ft && ft > 0) {
      const fpp = ft / px;
      ratios.push(fpp);
      candidates[key] = { pixelTotal: px, vendorFt: ft, ftPerPixel: fpp };
    }
  }

  if (ratios.length === 0) {
    return {
      ftPerPixel: null,
      debug: {
        pixelTotals,
        candidates,
        ftPerPixelFinal: null,
        alignmentTransform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, sourceWidth: null, sourceHeight: null, targetWidth: null, targetHeight: null },
        diagramImage: null,
        aerialImage: null,
      },
    };
  }

  // Median for stability
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const ftPerPixel = ratios.length % 2 === 1
    ? ratios[mid]
    : (ratios[mid - 1] + ratios[mid]) / 2;

  return {
    ftPerPixel,
    debug: {
      pixelTotals,
      candidates,
      ftPerPixelFinal: ftPerPixel,
      alignmentTransform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, sourceWidth: null, sourceHeight: null, targetWidth: null, targetHeight: null },
      diagramImage: null,
      aerialImage: null,
    },
  };
}

// ============================================
// LINE MEASUREMENTS
// ============================================

/**
 * Extract per-edge-type segment count, pixel length, and calibrated length in feet.
 */
export function lineMeasurementsFromGeometry(
  transformedGeometry: GroupedGeometry,
  ftPerPixel: number | null,
): Record<LineKey, LineMeasurement> {
  const out = {} as Record<LineKey, LineMeasurement>;
  for (const key of LINE_KEYS) {
    const segments = transformedGeometry[key] || [];
    const px = segments.reduce((sum, seg) => sum + polylinePixelLength(seg), 0);
    out[key] = {
      lineType: key,
      segmentCount: segments.length,
      pixelLength: px,
      estimatedLengthFt: ftPerPixel !== null ? px * ftPerPixel : null,
    };
  }
  return out;
}

// ============================================
// PITCH HELPERS
// ============================================

function pitchRatioToFloat(pitchStr: string | null | undefined): number | null {
  if (!pitchStr || !pitchStr.includes('/')) return null;
  const [rise, run] = pitchStr.split('/');
  try {
    return parseFloat(rise) / parseFloat(run);
  } catch {
    return null;
  }
}

// ============================================
// FINAL REPORT PAYLOAD
// ============================================

/**
 * Build structured report payload matching the Python `build_final_report_payload()` shape.
 */
export function buildFinalReportPayload(opts: {
  address: string;
  formattedAddress?: string | null;
  lat: number;
  lng: number;
  fusedAreaSqft: number | null;
  predominantPitch: string | null;
  googlePitchDegrees: number | null;
  facets: number | null;
  lineMeasurements: Record<LineKey, LineMeasurement>;
  calibrationDebug: CalibrationDebug;
}): FinalReportPayload {
  const lineTotals: FinalReportPayload['report']['lineTotals'] = {};
  for (const key of LINE_KEYS) {
    const m = opts.lineMeasurements[key];
    lineTotals[key] = {
      segmentCount: m.segmentCount,
      pixelLength: Math.round(m.pixelLength * 1000) / 1000,
      estimatedLengthFt: m.estimatedLengthFt !== null
        ? Math.round(m.estimatedLengthFt * 1000) / 1000
        : null,
    };
  }

  return {
    property: {
      inputAddress: opts.address,
      formattedAddress: opts.formattedAddress ?? null,
      latitude: opts.lat,
      longitude: opts.lng,
    },
    report: {
      totalRoofAreaSqft: opts.fusedAreaSqft,
      squares: opts.fusedAreaSqft ? Math.round((opts.fusedAreaSqft / 100) * 1000) / 1000 : null,
      predominantPitch: opts.predominantPitch,
      predominantPitchRatio: pitchRatioToFloat(opts.predominantPitch),
      googlePitchDegrees: opts.googlePitchDegrees,
      facets: opts.facets,
      lineTotals,
    },
    calibration: opts.calibrationDebug,
    confidence: opts.confidence ?? null,
  };
}

// ============================================
// STAGE 3: GEOMETRY CLEANUP
// ============================================

const ANCHOR_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function nearestAnchorAngleDeg(angleDeg: number): number {
  let best = ANCHOR_ANGLES[0];
  let bestDist = Infinity;
  for (const a of ANCHOR_ANGLES) {
    const dist = Math.abs(((angleDeg - a + 180) % 360) - 180);
    if (dist < bestDist) { bestDist = dist; best = a; }
  }
  return best;
}

function simplifyPolylineToSegment(polyline: number[][]): number[][] {
  if (!polyline || polyline.length === 0) return polyline;
  if (polyline.length === 1) return [polyline[0], polyline[0]];
  return [polyline[0], polyline[polyline.length - 1]];
}

function snapSegmentToAnchorAngles(seg: number[][]): number[][] {
  if (seg.length !== 2) return seg;
  const [x1, y1] = seg[0];
  const [x2, y2] = seg[1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return seg;
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const snapped = nearestAnchorAngleDeg(angle);
  const rad = (snapped * Math.PI) / 180;
  return [[x1, y1], [x1 + Math.cos(rad) * length, y1 + Math.sin(rad) * length]];
}

/**
 * Clean up geometry: simplify polylines to start/end segments,
 * snap to nearest anchor angle (0/45/90/135...), discard short segments.
 */
export function cleanupGeometry(
  grouped: GroupedGeometry,
  minSegmentPx: number = 6.0,
): GroupedGeometry {
  const cleaned = {} as GroupedGeometry;
  for (const key of LINE_KEYS) {
    cleaned[key] = [];
    for (const seg of grouped[key] || []) {
      const simplified = simplifyPolylineToSegment(seg);
      const snapped = snapSegmentToAnchorAngles(simplified);
      if (polylinePixelLength(snapped) >= minSegmentPx) {
        cleaned[key].push(snapped);
      }
    }
  }
  return cleaned;
}

// ============================================
// STAGE 3: BOUNDING BOX UTILITIES
// ============================================

export type BBox = [number, number, number, number]; // [x1, y1, x2, y2]

export function bboxFromPoints(points: number[][]): BBox | null {
  if (!points || points.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of points) {
    if (p[0] < x1) x1 = p[0];
    if (p[1] < y1) y1 = p[1];
    if (p[0] > x2) x2 = p[0];
    if (p[1] > y2) y2 = p[1];
  }
  return [x1, y1, x2, y2];
}

export function bboxArea(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

export function iouBbox(a: BBox | null, b: BBox | null): number {
  if (!a || !b) return 0;
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const inter = ix2 > ix1 && iy2 > iy1 ? (ix2 - ix1) * (iy2 - iy1) : 0;
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function collectAllPoints(grouped: GroupedGeometry): number[][] {
  const pts: number[][] = [];
  for (const key of LINE_KEYS) {
    for (const seg of grouped[key] || []) {
      for (const pt of seg) {
        if (Array.isArray(pt) && pt.length >= 2) pts.push([pt[0], pt[1]]);
      }
    }
  }
  return pts;
}

// ============================================
// STAGE 3: ALIGNMENT SCORING
// ============================================

export interface AlignmentDebug {
  geometryBbox: BBox | null;
  roofBbox: BBox | null;
  imageBbox: BBox | null;
  bboxInsideRatio: number;
  roofBboxIou: number;
  alignmentScore: number;
}

/**
 * Score how well transformed geometry lands within the expected roof region.
 */
export function estimateControlPointAlignment(
  transformedGeometry: GroupedGeometry,
  roofBbox: BBox | null,
  aerialSize: { width: number | null; height: number | null },
): AlignmentDebug {
  const pts = collectAllPoints(transformedGeometry);
  const geomBbox = bboxFromPoints(pts);
  const imageBbox: BBox | null =
    aerialSize.width && aerialSize.height
      ? [0, 0, aerialSize.width, aerialSize.height]
      : null;

  let bboxInsideRatio = 0;
  if (geomBbox && imageBbox) {
    const gArea = bboxArea(geomBbox);
    if (gArea > 0) {
      const insideW = Math.max(0, Math.min(geomBbox[2], imageBbox[2]) - Math.max(geomBbox[0], imageBbox[0]));
      const insideH = Math.max(0, Math.min(geomBbox[3], imageBbox[3]) - Math.max(geomBbox[1], imageBbox[1]));
      bboxInsideRatio = (insideW * insideH) / gArea;
    }
  }

  const roofOverlap = iouBbox(geomBbox, roofBbox);
  const score = 0.5 * bboxInsideRatio + 0.5 * roofOverlap;

  return {
    geometryBbox: geomBbox,
    roofBbox,
    imageBbox,
    bboxInsideRatio: Math.round(bboxInsideRatio * 10000) / 10000,
    roofBboxIou: Math.round(roofOverlap * 10000) / 10000,
    alignmentScore: Math.round(score * 10000) / 10000,
  };
}

// ============================================
// STAGE 3: CONFIDENCE SCORING
// ============================================

export interface ConfidenceScore {
  overall: number;
  alignment: number;
  calibration: number;
  geometry: number;
  notes: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Composite confidence score from alignment, calibration, and geometry agreement.
 * overall = 0.4*alignment + 0.3*calibration + 0.3*geometry
 */
export function scoreConfidence(
  alignmentDebug: AlignmentDebug,
  calibrationDebug: CalibrationDebug,
  measurements: Record<LineKey, LineMeasurement>,
  vendorLengths: Partial<Record<string, number>>,
): ConfidenceScore {
  const notes: string[] = [];

  // Alignment
  const alignment = alignmentDebug.alignmentScore;
  if (alignment < 0.35) notes.push('Weak geometry-to-roof alignment.');

  // Calibration
  const candidateCount = Object.keys(calibrationDebug.candidates).length;
  let calibration = 0;
  if (calibrationDebug.ftPerPixelFinal !== null) {
    calibration = 0.35 + Math.min(0.65, 0.15 * candidateCount);
  }
  if (candidateCount < 2) notes.push('Calibration built from too few line classes.');
  calibration = clamp(calibration, 0, 1);

  // Geometry agreement
  const vendorKeyMap: Record<LineKey, string> = {
    ridge: 'ridgeFt', valley: 'valleyFt', hip: 'hipFt', eave: 'eaveFt', rake: 'rakeFt',
  };
  let classesWithLengths = 0;
  let disagreements = 0;
  for (const key of LINE_KEYS) {
    const m = measurements[key];
    if (m.estimatedLengthFt !== null) classesWithLengths++;
    const vendorFt = vendorLengths[vendorKeyMap[key]];
    if (vendorFt && m.estimatedLengthFt) {
      const delta = Math.abs(m.estimatedLengthFt - vendorFt) / Math.max(1e-6, vendorFt);
      if (delta > 0.18) disagreements++;
    }
  }
  let geometry = clamp(classesWithLengths / Math.max(1, LINE_KEYS.length) - 0.12 * disagreements, 0, 1);
  if (disagreements > 1) notes.push('Multiple calibrated line totals disagree with vendor truth.');

  const overall = clamp(0.4 * alignment + 0.3 * calibration + 0.3 * geometry, 0, 1);

  return {
    overall: Math.round(overall * 10000) / 10000,
    alignment: Math.round(alignment * 10000) / 10000,
    calibration: Math.round(calibration * 10000) / 10000,
    geometry: Math.round(geometry * 10000) / 10000,
    notes,
  };
}

// ============================================
// STAGE 3: TRAINING EXPORT PACK
// ============================================

export interface TrainingPack {
  manifest: Record<string, unknown>;
  labels: Record<string, unknown>;
  geometryGeoJSON: Record<string, unknown>;
}

function bboxToPolygon(bbox: BBox | null): number[][] {
  if (!bbox) return [];
  const [x1, y1, x2, y2] = bbox;
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
}

/**
 * Build a training export pack (JSON-only, no image copy).
 * Returns structured manifest, labels, and geometry GeoJSON.
 */
export function buildTrainingExportPack(opts: {
  aerialImageUrl: string | null;
  roofBbox: BBox | null;
  transformedGeometry: GroupedGeometry;
  report: FinalReportPayload;
  confidence: ConfidenceScore;
}): TrainingPack {
  const features: Record<string, unknown>[] = [
    {
      type: 'Feature',
      properties: { kind: 'roof_footprint' },
      geometry: { type: 'LineString', coordinates: bboxToPolygon(opts.roofBbox) },
    },
  ];
  for (const key of LINE_KEYS) {
    for (let idx = 0; idx < (opts.transformedGeometry[key]?.length || 0); idx++) {
      features.push({
        type: 'Feature',
        properties: { kind: key, index: idx },
        geometry: { type: 'LineString', coordinates: opts.transformedGeometry[key][idx] },
      });
    }
  }

  const geojson = { type: 'FeatureCollection', features };

  const labels = {
    areaSqft: opts.report.report.totalRoofAreaSqft,
    facets: opts.report.report.facets,
    predominantPitch: opts.report.report.predominantPitch,
    lineTotals: opts.report.report.lineTotals,
  };

  const manifest = {
    image: opts.aerialImageUrl,
    roofPolygon: bboxToPolygon(opts.roofBbox),
    geometry: opts.transformedGeometry,
    report: opts.report,
    confidence: opts.confidence,
  };

  return { manifest, labels, geometryGeoJSON: geojson };
}
