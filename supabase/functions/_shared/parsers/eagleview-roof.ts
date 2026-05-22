// Deterministic EagleView roof report parser.
// Input:  raw text extracted from the report PDF (all pages concatenated).
// Output: normalized JSON + field-level confidences + page_map (when pages provided).
//
// NEVER calls AI. Pure regex over EagleView's stable layout.

import { CONFIDENCE_THRESHOLDS, aggregateConfidence, requiresReview, type FieldConfidence } from "./confidence.ts";
import { validateRoofTotals, type ValidationError } from "./validators.ts";

export const EAGLEVIEW_ROOF_PARSER_NAME = "eagleview-roof";
export const EAGLEVIEW_ROOF_PARSER_VERSION = "v1.0.0";

export interface EagleViewRoofExtraction {
  report_number: string | null;
  property_address: string | null;
  total_roof_area_sqft: number | null;
  total_roof_facets: number | null;
  predominant_pitch: string | null;
  number_of_stories: number | null;
  ridges_ft: number | null;
  hips_ft: number | null;
  hips_ridges_combined_ft: number | null;
  valleys_ft: number | null;
  rakes_ft: number | null;
  eaves_ft: number | null;
  drip_edge_ft: number | null;
  flashing_ft: number | null;
  step_flashing_ft: number | null;
  parapets_ft: number | null;
  penetrations_count: number | null;
  latitude: number | null;
  longitude: number | null;
  waste_table: Record<string, number> | null;
  areas_per_pitch: Record<string, number> | null;
  report_date: string | null;
}

export interface ParseResult<T> {
  vendor_type: "eagleview";
  document_type: "roof_report";
  parser_name: string;
  parser_version: string;
  parser_tier: "deterministic";
  data: T;
  field_confidences: FieldConfidence;
  overall_confidence: number;
  missing_fields: string[];
  validation_errors: ValidationError[];
  requires_review: boolean;
  matched_signal: boolean;  // false → text doesn't look like EagleView
}

function detectEagleView(text: string): boolean {
  return /eagle[ -]?view/i.test(text) || /Report\s+Number\s*:\s*\d+/i.test(text);
}

function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? (m[1] ?? null) : null;
}

function extractWasteTable(text: string): Record<string, number> | null {
  // Look for blocks like "0% 2,450  3% 2,524  5% 2,572 ..."
  const block = text.match(/Waste\s*Calculation\s*Table[\s\S]{0,800}/i)?.[0];
  if (!block) return null;
  const out: Record<string, number> = {};
  const re = /(\d{1,2})\s*%[^\d]*(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = num(m[2]);
    if (v !== null) out[m[1]] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractAreasPerPitch(text: string): Record<string, number> | null {
  const block = text.match(/Areas\s+per\s+Pitch[\s\S]{0,800}/i)?.[0];
  if (!block) return null;
  const out: Record<string, number> = {};
  const re = /(\d{1,2})\s*\/\s*12\b[^\d]*(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = num(m[2]);
    if (v !== null) out[`${m[1]}/12`] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseEagleViewRoofReport(fullText: string): ParseResult<EagleViewRoofExtraction> {
  const matched_signal = detectEagleView(fullText);
  const T = CONFIDENCE_THRESHOLDS;

  const data: EagleViewRoofExtraction = {
    report_number: firstMatch(fullText, /Report\s+(?:Number|ID)\s*:?\s*([A-Z0-9-]+)/i),
    property_address: firstMatch(fullText, /(?:Property\s+Address|Subject\s+Property)\s*:?\s*([^\n\r]{5,150})/i)?.trim() ?? null,
    total_roof_area_sqft: num(firstMatch(fullText, /Total\s+Roof\s+Area\s*(?:\(sq\s*ft\))?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    total_roof_facets: num(firstMatch(fullText, /Total\s+Roof\s+Facets?\s*:?\s*(\d+)/i)),
    predominant_pitch: firstMatch(fullText, /Predominant\s+Pitch\s*:?\s*(\d{1,2}\s*\/\s*12)/i)?.replace(/\s+/g, "") ?? null,
    number_of_stories: num(firstMatch(fullText, /Number\s+of\s+Stories\s*:?\s*(\d+)/i)),
    ridges_ft: num(firstMatch(fullText, /\bRidges?\s*(?:\(ft\))?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    hips_ft: num(firstMatch(fullText, /\bHips?\s*(?:\(ft\))?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    hips_ridges_combined_ft: num(firstMatch(fullText, /Hips?\s*(?:&|and|\+)\s*Ridges?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i)),
    valleys_ft: num(firstMatch(fullText, /\bValleys?\s*(?:\(ft\))?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    rakes_ft: num(firstMatch(fullText, /\bRakes?\s*(?:\(ft\))?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    eaves_ft: num(firstMatch(fullText, /\bEaves?\s*(?:\(ft\))?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    drip_edge_ft: num(firstMatch(fullText, /Drip\s*Edge\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i)),
    flashing_ft: num(firstMatch(fullText, /(?<!Step\s)Flashing\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i)),
    step_flashing_ft: num(firstMatch(fullText, /Step\s*Flashing\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i)),
    parapets_ft: num(firstMatch(fullText, /Parapets?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i)),
    penetrations_count: num(firstMatch(fullText, /Penetrations?\s*(?:Count)?\s*[:=]?\s*(\d+)/i)),
    latitude: num(firstMatch(fullText, /Latitude\s*[:=]?\s*(-?\d+\.\d+)/i)),
    longitude: num(firstMatch(fullText, /Longitude\s*[:=]?\s*(-?\d+\.\d+)/i)),
    waste_table: extractWasteTable(fullText),
    areas_per_pitch: extractAreasPerPitch(fullText),
    report_date: firstMatch(fullText, /Report\s+Date\s*:?\s*([0-9/.-]{6,12})/i),
  };

  // Field-level confidence assignment (deterministic — labelled summary fields get high scores).
  const conf: FieldConfidence = {};
  if (data.report_number) conf.report_number = T.EXACT_LABEL;
  if (data.property_address) conf.property_address = T.SUMMARY_SECTION;
  if (data.total_roof_area_sqft !== null) conf.total_roof_area_sqft = T.EXACT_LABEL;
  if (data.total_roof_facets !== null) conf.total_roof_facets = T.EXACT_LABEL;
  if (data.predominant_pitch) conf.predominant_pitch = T.EXACT_LABEL;
  if (data.number_of_stories !== null) conf.number_of_stories = T.SUMMARY_SECTION;
  if (data.ridges_ft !== null) conf.ridges_ft = T.SUMMARY_SECTION;
  if (data.hips_ft !== null) conf.hips_ft = T.SUMMARY_SECTION;
  if (data.hips_ridges_combined_ft !== null) conf.hips_ridges_combined_ft = T.SUMMARY_SECTION;
  if (data.valleys_ft !== null) conf.valleys_ft = T.SUMMARY_SECTION;
  if (data.rakes_ft !== null) conf.rakes_ft = T.SUMMARY_SECTION;
  if (data.eaves_ft !== null) conf.eaves_ft = T.SUMMARY_SECTION;
  if (data.drip_edge_ft !== null) conf.drip_edge_ft = T.SUMMARY_SECTION;
  if (data.flashing_ft !== null) conf.flashing_ft = T.TABLE_OR_REPEATED;
  if (data.step_flashing_ft !== null) conf.step_flashing_ft = T.TABLE_OR_REPEATED;
  if (data.parapets_ft !== null) conf.parapets_ft = T.TABLE_OR_REPEATED;
  if (data.penetrations_count !== null) conf.penetrations_count = T.WEAK;
  if (data.latitude !== null) conf.latitude = T.EXACT_LABEL;
  if (data.longitude !== null) conf.longitude = T.EXACT_LABEL;
  if (data.waste_table) conf.waste_table = T.TABLE_OR_REPEATED;
  if (data.areas_per_pitch) conf.areas_per_pitch = T.TABLE_OR_REPEATED;
  if (data.report_date) conf.report_date = T.SUMMARY_SECTION;

  // Required-for-acceptance fields
  const required = [
    "total_roof_area_sqft", "total_roof_facets", "predominant_pitch",
    "ridges_ft", "hips_ft", "valleys_ft", "rakes_ft", "eaves_ft",
  ] as const;
  const missing_fields = required.filter((k) => (data as Record<string, unknown>)[k] === null);

  // If matched_signal is false, deflate every score — we're guessing.
  if (!matched_signal) {
    for (const k of Object.keys(conf)) conf[k] = Math.min(conf[k], T.WEAK);
  }

  const overall = aggregateConfidence(conf);
  const validation_errors = validateRoofTotals(data);
  const hasErr = validation_errors.some((v) => v.severity === "error");

  return {
    vendor_type: "eagleview",
    document_type: "roof_report",
    parser_name: EAGLEVIEW_ROOF_PARSER_NAME,
    parser_version: EAGLEVIEW_ROOF_PARSER_VERSION,
    parser_tier: "deterministic",
    data,
    field_confidences: conf,
    overall_confidence: overall,
    missing_fields,
    validation_errors,
    requires_review: requiresReview(overall, missing_fields) || hasErr,
    matched_signal,
  };
}
