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
  };
}
