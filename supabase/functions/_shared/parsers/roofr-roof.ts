// Deterministic Roofr roof report parser. Sibling to eagleview-roof.ts.
// Roofr uses different field labels than EagleView; both parsers run, the one
// with higher overall_confidence wins.

import { CONFIDENCE_THRESHOLDS, aggregateConfidence, requiresReview, type FieldConfidence } from "./confidence.ts";
import { validateRoofTotals, type ValidationError } from "./validators.ts";
import type { ParseResult } from "./eagleview-roof.ts";

export const ROOFR_ROOF_PARSER_NAME = "roofr-roof";
export const ROOFR_ROOF_PARSER_VERSION = "v1.0.0";

export interface RoofrRoofExtraction {
  property_address: string | null;
  total_roof_area_sqft: number | null;
  pitched_roof_area_sqft: number | null;
  flat_roof_area_sqft: number | null;
  roof_facets: number | null;
  predominant_pitch: string | null;
  eaves_ft: number | null;
  valleys_ft: number | null;
  hips_ft: number | null;
  ridges_ft: number | null;
  rakes_ft: number | null;
  wall_flashing_ft: number | null;
  step_flashing_ft: number | null;
  transitions_ft: number | null;
  parapet_wall_ft: number | null;
  unspecified_ft: number | null;
  waste_table: Record<string, number> | null;
  report_date: string | null;
  image_date: string | null;
}

function detectRoofr(text: string): boolean {
  return /\broofr\b/i.test(text) || /Roofr\s+Report/i.test(text);
}

function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function firstMatch(t: string, r: RegExp): string | null {
  const m = t.match(r); return m ? (m[1] ?? null) : null;
}

function extractRoofrWasteTable(text: string): Record<string, number> | null {
  const block = text.match(/Waste\s*Table[\s\S]{0,600}/i)?.[0];
  if (!block) return null;
  const out: Record<string, number> = {};
  const re = /(\d{1,2})\s*%[^\d]*(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = num(m[2]); if (v !== null) out[m[1]] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseRoofrRoofReport(fullText: string): ParseResult<RoofrRoofExtraction> & { vendor_type: "roofr" } {
  const matched_signal = detectRoofr(fullText);
  const T = CONFIDENCE_THRESHOLDS;

  const data: RoofrRoofExtraction = {
    property_address: firstMatch(fullText, /(?:Property\s+Address|Address)\s*:?\s*([^\n\r]{5,150})/i)?.trim() ?? null,
    total_roof_area_sqft: num(firstMatch(fullText, /Total\s+Roof\s+Area\s*(?:\(sq\s*ft\))?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    pitched_roof_area_sqft: num(firstMatch(fullText, /Pitched\s+Roof\s+Area\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    flat_roof_area_sqft: num(firstMatch(fullText, /Flat\s+Roof\s+Area\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    roof_facets: num(firstMatch(fullText, /(?:Total\s+)?(?:Roof\s+)?Facets\s*:?\s*(\d+)/i)),
    predominant_pitch: firstMatch(fullText, /Predominant\s+Pitch\s*:?\s*(\d{1,2}\s*\/\s*12)/i)?.replace(/\s+/g, "") ?? null,
    eaves_ft: num(firstMatch(fullText, /\bEaves?\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    valleys_ft: num(firstMatch(fullText, /\bValleys?\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    hips_ft: num(firstMatch(fullText, /\bHips?\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    ridges_ft: num(firstMatch(fullText, /\bRidges?\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    rakes_ft: num(firstMatch(fullText, /\bRakes?\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet|lf)?/i)),
    wall_flashing_ft: num(firstMatch(fullText, /Wall\s+Flashing\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    step_flashing_ft: num(firstMatch(fullText, /Step\s+Flashing\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    transitions_ft: num(firstMatch(fullText, /Transitions?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    parapet_wall_ft: num(firstMatch(fullText, /Parapet\s+Wall\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    unspecified_ft: num(firstMatch(fullText, /Unspecified\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    waste_table: extractRoofrWasteTable(fullText),
    report_date: firstMatch(fullText, /Report\s+Date\s*:?\s*([0-9/.-]{6,12})/i),
    image_date: firstMatch(fullText, /(?:Image|Imagery)\s+Date\s*:?\s*([0-9/.-]{6,12})/i),
  };

  const conf: FieldConfidence = {};
  if (data.property_address) conf.property_address = T.SUMMARY_SECTION;
  if (data.total_roof_area_sqft !== null) conf.total_roof_area_sqft = T.EXACT_LABEL;
  if (data.pitched_roof_area_sqft !== null) conf.pitched_roof_area_sqft = T.SUMMARY_SECTION;
  if (data.flat_roof_area_sqft !== null) conf.flat_roof_area_sqft = T.SUMMARY_SECTION;
  if (data.roof_facets !== null) conf.roof_facets = T.SUMMARY_SECTION;
  if (data.predominant_pitch) conf.predominant_pitch = T.EXACT_LABEL;
  if (data.eaves_ft !== null) conf.eaves_ft = T.SUMMARY_SECTION;
  if (data.valleys_ft !== null) conf.valleys_ft = T.SUMMARY_SECTION;
  if (data.hips_ft !== null) conf.hips_ft = T.SUMMARY_SECTION;
  if (data.ridges_ft !== null) conf.ridges_ft = T.SUMMARY_SECTION;
  if (data.rakes_ft !== null) conf.rakes_ft = T.SUMMARY_SECTION;
  if (data.wall_flashing_ft !== null) conf.wall_flashing_ft = T.TABLE_OR_REPEATED;
  if (data.step_flashing_ft !== null) conf.step_flashing_ft = T.TABLE_OR_REPEATED;
  if (data.transitions_ft !== null) conf.transitions_ft = T.TABLE_OR_REPEATED;
  if (data.parapet_wall_ft !== null) conf.parapet_wall_ft = T.TABLE_OR_REPEATED;
  if (data.waste_table) conf.waste_table = T.TABLE_OR_REPEATED;
  if (data.report_date) conf.report_date = T.SUMMARY_SECTION;
  if (data.image_date) conf.image_date = T.SUMMARY_SECTION;

  const required = ["total_roof_area_sqft", "predominant_pitch", "eaves_ft", "ridges_ft", "valleys_ft"] as const;
  const missing_fields = required.filter((k) => (data as Record<string, unknown>)[k] === null);

  if (!matched_signal) for (const k of Object.keys(conf)) conf[k] = Math.min(conf[k], T.WEAK);

  const overall = aggregateConfidence(conf);
  const validation_errors = validateRoofTotals(data);
  const hasErr = validation_errors.some((v) => v.severity === "error");

  return {
    vendor_type: "roofr",
    document_type: "roof_report",
    parser_name: ROOFR_ROOF_PARSER_NAME,
    parser_version: ROOFR_ROOF_PARSER_VERSION,
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
