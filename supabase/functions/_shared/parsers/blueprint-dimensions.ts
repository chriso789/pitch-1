// Blueprint F1F dimension + calibrated geometry primitives.
// Emits measurement candidates only when explicit dimension text or a known viewport
// scale exists. No OCR/vector-line inference is claimed here.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";

export const BLUEPRINT_DIMENSION_VERSION = "f1-dimension-v1.1";

export interface DimensionCandidate {
  page_number: number;
  viewport_key: string | null;
  label_text: string;
  normalized_feet: number;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  source: "explicit_dimension_text";
  metadata: { version: string; requires_review: true };
}

export interface CalibratedLengthCandidate {
  page_number: number;
  viewport_key: string;
  points: [{ x: number; y: number }, { x: number; y: number }];
  length_points: number;
  length_ft: number;
  confidence: number;
  source: "manual_or_vector_segment_with_viewport_scale";
  metadata: { version: string; scale_raw: string; requires_review: true };
}

const FEET_INCH_RE = /\b(\d+)\s*['’]\s*(?:-\s*)?(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)?\s*["”]?/;
const INCH_ONLY_RE = /(?:^|\s)(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*["”](?=\s|$|[,;)])/;

function fraction(value: string): number | null {
  const m = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const denominator = Number(m[2]);
    return denominator === 0 ? null : Number(m[1]) / denominator;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseDimensionFeet(raw: string): number | null {
  const normalized = raw.replace(/[’]/g, "'").replace(/[”]/g, '"').trim();
  const feetInch = normalized.match(FEET_INCH_RE);
  if (feetInch) {
    const feet = Number(feetInch[1]);
    const inches = feetInch[2] ? fraction(feetInch[2]) : 0;
    return inches == null ? null : feet + inches / 12;
  }
  const inchOnly = normalized.match(INCH_ONLY_RE);
  if (inchOnly) {
    const inches = fraction(inchOnly[1]);
    return inches == null ? null : inches / 12;
  }
  return null;
}

function center(item: PdfLayoutTextItem) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

function owner(item: PdfLayoutTextItem, viewports: DrawingViewport[]): DrawingViewport | null {
  const c = center(item);
  const options = viewports.filter((v) => c.x >= v.bbox.x && c.x <= v.bbox.x + v.bbox.width && c.y >= v.bbox.y && c.y <= v.bbox.y + v.bbox.height);
  options.sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height);
  return options[0] ?? null;
}

export function extractDimensionCandidates(page: PdfLayoutPage, viewports: DrawingViewport[] = []): DimensionCandidate[] {
  const out: DimensionCandidate[] = [];
  for (const item of page.text_items) {
    const feet = parseDimensionFeet(item.text);
    if (feet == null || feet <= 0) continue;
    if (/SCALE/i.test(item.text) || /=/.test(item.text)) continue;
    const viewport = owner(item, viewports);
    out.push({
      page_number: page.page_number,
      viewport_key: viewport?.viewport_key ?? null,
      label_text: item.text.trim(),
      normalized_feet: Number(feet.toFixed(6)),
      bbox: { x: item.x, y: item.y, width: item.width, height: item.height },
      confidence: viewport ? 0.9 : 0.82,
      source: "explicit_dimension_text",
      metadata: { version: BLUEPRINT_DIMENSION_VERSION, requires_review: true },
    });
  }
  return out;
}

export function calibrateSegmentLength(input: {
  page_number: number;
  viewport: DrawingViewport;
  start: { x: number; y: number };
  end: { x: number; y: number };
  confidence?: number;
}): CalibratedLengthCandidate | null {
  const scale = input.viewport.scale;
  if (!scale || scale.kind !== "architectural" || !scale.feet_per_paper_inch || scale.feet_per_paper_inch <= 0) return null;
  const lengthPoints = Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y);
  const paperInches = lengthPoints / 72;
  const lengthFt = paperInches * scale.feet_per_paper_inch;
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return null;
  return {
    page_number: input.page_number,
    viewport_key: input.viewport.viewport_key,
    points: [input.start, input.end],
    length_points: Number(lengthPoints.toFixed(6)),
    length_ft: Number(lengthFt.toFixed(6)),
    confidence: Math.min(0.99, Math.max(0, input.confidence ?? input.viewport.confidence)),
    source: "manual_or_vector_segment_with_viewport_scale",
    metadata: { version: BLUEPRINT_DIMENSION_VERSION, scale_raw: scale.raw, requires_review: true },
  };
}

export function calibratePolygonArea(input: {
  viewport: DrawingViewport;
  points: Array<{ x: number; y: number }>;
}): { area_points2: number; area_sqft: number; scale_raw: string } | null {
  const scale = input.viewport.scale;
  if (!scale || scale.kind !== "architectural" || !scale.feet_per_paper_inch || input.points.length < 3) return null;
  let twiceArea = 0;
  for (let i = 0; i < input.points.length; i += 1) {
    const a = input.points[i];
    const b = input.points[(i + 1) % input.points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const areaPoints2 = Math.abs(twiceArea) / 2;
  const paperInches2 = areaPoints2 / (72 * 72);
  const areaSqft = paperInches2 * scale.feet_per_paper_inch * scale.feet_per_paper_inch;
  if (!Number.isFinite(areaSqft) || areaSqft <= 0) return null;
  return { area_points2: Number(areaPoints2.toFixed(6)), area_sqft: Number(areaSqft.toFixed(6)), scale_raw: scale.raw };
}
