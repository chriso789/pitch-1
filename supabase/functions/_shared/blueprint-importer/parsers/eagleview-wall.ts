// Deterministic EagleView wall report parser. No AI.
// Pure regex over EagleView's wall report layout. Mirrors structure of
// _shared/parsers/eagleview-roof.ts but produces wall-specific fields.

export const EAGLEVIEW_WALL_PARSER_NAME = "eagleview-wall";
export const EAGLEVIEW_WALL_PARSER_VERSION = "v1.0.0";

export interface EagleViewWallExtraction {
  report_number: string | null;
  property_address: string | null;
  wall_area_sqft: number | null;
  wall_area_with_windows_doors_sqft: number | null;
  wall_facets_count: number | null;
  top_of_walls_lf: number | null;
  bottom_of_walls_lf: number | null;
  inside_corners_lf: number | null;
  outside_corners_lf: number | null;
  inside_corners_gt_90_lf: number | null;
  outside_corners_gt_90_lf: number | null;
  fascia_eaves_rake_lf: number | null;
  window_door_area_sqft: number | null;
  window_door_count: number | null;
  window_door_perimeter_lf: number | null;
  wall_area_by_direction: Record<string, number> | null;
  wall_area_by_elevation: Record<string, number> | null;
  window_door_area_by_elevation: Record<string, number> | null;
  window_door_perimeter_by_elevation: Record<string, number> | null;
  window_door_count_by_elevation: Record<string, number> | null;
  wall_waste_table: Record<string, number> | null;
  has_image_obstruction_warning: boolean;
  has_field_verification_warning: boolean;
  has_soffit_assumption_warning: boolean;
  report_date: string | null;
}

export interface WallParseResult {
  vendor_type: "eagleview";
  document_type: "wall_report";
  parser_name: string;
  parser_version: string;
  parser_tier: "deterministic";
  data: EagleViewWallExtraction;
  field_confidences: Record<string, number>;
  overall_confidence: number;
  missing_fields: string[];
  validation_errors: { code: string; severity: "warning" | "error"; message: string }[];
  requires_review: boolean;
  matched_signal: boolean;
}

const T = {
  EXACT_LABEL: 0.95,
  SUMMARY_SECTION: 0.85,
  TABLE_OR_REPEATED: 0.75,
  WEAK: 0.45,
};

function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function firstMatch(t: string, r: RegExp): string | null {
  const m = t.match(r); return m ? (m[1] ?? null) : null;
}
function detectEagleViewWall(text: string): boolean {
  return /eagle[ -]?view/i.test(text) && /wall/i.test(text);
}

function extractKeyedTable(text: string, headerRe: RegExp, keyRe: RegExp): Record<string, number> | null {
  const block = text.match(headerRe)?.[0];
  if (!block) return null;
  const out: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) {
    const v = num(m[2]); if (v !== null) out[m[1].toLowerCase()] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractWasteTable(text: string): Record<string, number> | null {
  const block = text.match(/Waste\s*(?:Calculation\s*)?Table[\s\S]{0,800}/i)?.[0];
  if (!block) return null;
  const out: Record<string, number> = {};
  const re = /(\d{1,2})\s*%[^\d]*(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = num(m[2]); if (v !== null) out[m[1]] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseEagleViewWallReport(fullText: string): WallParseResult {
  const matched_signal = detectEagleViewWall(fullText);

  const data: EagleViewWallExtraction = {
    report_number: firstMatch(fullText, /Report\s+(?:Number|ID)\s*:?\s*([A-Z0-9-]+)/i),
    property_address: firstMatch(fullText, /(?:Property\s+Address|Subject\s+Property)\s*:?\s*([^\n\r]{5,150})/i)?.trim() ?? null,
    wall_area_sqft: num(firstMatch(fullText, /Total\s+Wall\s+Area\s*(?:\(sq\s*ft\))?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    wall_area_with_windows_doors_sqft: num(firstMatch(fullText, /Total\s+Wall\s+Area\s+(?:incl(?:uding)?|with)\s+Windows?\s*(?:&|and)\s*Doors?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    wall_facets_count: num(firstMatch(fullText, /(?:Total\s+)?Wall\s+Facets?\s*:?\s*(\d+)/i)),
    top_of_walls_lf: num(firstMatch(fullText, /Top\s+of\s+Walls?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    bottom_of_walls_lf: num(firstMatch(fullText, /Bottom\s+of\s+Walls?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    inside_corners_lf: num(firstMatch(fullText, /Inside\s+Corners?\s*(?!.*>?\s*90)\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    outside_corners_lf: num(firstMatch(fullText, /Outside\s+Corners?\s*(?!.*>?\s*90)\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    inside_corners_gt_90_lf: num(firstMatch(fullText, /Inside\s+Corners?\s*>\s*90[^\d]*([\d,]+(?:\.\d+)?)/i)),
    outside_corners_gt_90_lf: num(firstMatch(fullText, /Outside\s+Corners?\s*>\s*90[^\d]*([\d,]+(?:\.\d+)?)/i)),
    fascia_eaves_rake_lf: num(firstMatch(fullText, /Fascia\s*(?:\(Eaves?\s*(?:&|and|\+)\s*Rakes?\))?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    window_door_area_sqft: num(firstMatch(fullText, /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Area\s*(?:\(sq\s*ft\))?\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    window_door_count: num(firstMatch(fullText, /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Count\s*:?\s*(\d+)/i)),
    window_door_perimeter_lf: num(firstMatch(fullText, /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Perimeter\s*:?\s*([\d,]+(?:\.\d+)?)/i)),
    wall_area_by_direction: extractKeyedTable(
      fullText,
      /Wall\s+Area\s+by\s+Direction[\s\S]{0,400}/i,
      /\b(North|South|East|West|NE|NW|SE|SW)\b[^\d]*([\d,]+(?:\.\d+)?)/gi,
    ),
    wall_area_by_elevation: extractKeyedTable(
      fullText,
      /Wall\s+Area\s+by\s+Elevation[\s\S]{0,600}/i,
      /\b(North|South|East|West|NE|NW|SE|SW)[^\n]*?([\d,]+(?:\.\d+)?)\s*(?:sq\s*ft|sqft)/gi,
    ),
    window_door_area_by_elevation: extractKeyedTable(
      fullText,
      /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Area\s+by\s+Elevation[\s\S]{0,600}/i,
      /\b(North|South|East|West|NE|NW|SE|SW)[^\n]*?([\d,]+(?:\.\d+)?)/gi,
    ),
    window_door_perimeter_by_elevation: extractKeyedTable(
      fullText,
      /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Perimeter\s+by\s+Elevation[\s\S]{0,600}/i,
      /\b(North|South|East|West|NE|NW|SE|SW)[^\n]*?([\d,]+(?:\.\d+)?)/gi,
    ),
    window_door_count_by_elevation: extractKeyedTable(
      fullText,
      /Window(?:s)?\s*(?:&|and)\s*Door(?:s)?\s+Count\s+by\s+Elevation[\s\S]{0,600}/i,
      /\b(North|South|East|West|NE|NW|SE|SW)[^\n]*?(\d+)/gi,
    ),
    wall_waste_table: extractWasteTable(fullText),
    has_image_obstruction_warning: /image\s+(?:obstruction|obstructed|limited|limitation)/i.test(fullText),
    has_field_verification_warning: /(field\s+verif(?:y|ication)\s+required|verify\s+in\s+the\s+field|yellow\s+shaded)/i.test(fullText),
    has_soffit_assumption_warning: /(soffit\s+assumed|assumed\s+(?:flat|sloped)\s+soffit|soffit\s+assumption)/i.test(fullText),
    report_date: firstMatch(fullText, /Report\s+Date\s*:?\s*([0-9/.-]{6,12})/i),
  };

  const conf: Record<string, number> = {};
  if (data.report_number) conf.report_number = T.EXACT_LABEL;
  if (data.property_address) conf.property_address = T.SUMMARY_SECTION;
  if (data.wall_area_sqft !== null) conf.wall_area_sqft = T.EXACT_LABEL;
  if (data.wall_area_with_windows_doors_sqft !== null) conf.wall_area_with_windows_doors_sqft = T.SUMMARY_SECTION;
  if (data.wall_facets_count !== null) conf.wall_facets_count = T.EXACT_LABEL;
  if (data.top_of_walls_lf !== null) conf.top_of_walls_lf = T.SUMMARY_SECTION;
  if (data.bottom_of_walls_lf !== null) conf.bottom_of_walls_lf = T.SUMMARY_SECTION;
  if (data.inside_corners_lf !== null) conf.inside_corners_lf = T.SUMMARY_SECTION;
  if (data.outside_corners_lf !== null) conf.outside_corners_lf = T.SUMMARY_SECTION;
  if (data.inside_corners_gt_90_lf !== null) conf.inside_corners_gt_90_lf = T.TABLE_OR_REPEATED;
  if (data.outside_corners_gt_90_lf !== null) conf.outside_corners_gt_90_lf = T.TABLE_OR_REPEATED;
  if (data.fascia_eaves_rake_lf !== null) conf.fascia_eaves_rake_lf = T.SUMMARY_SECTION;
  if (data.window_door_area_sqft !== null) conf.window_door_area_sqft = T.SUMMARY_SECTION;
  if (data.window_door_count !== null) conf.window_door_count = T.SUMMARY_SECTION;
  if (data.window_door_perimeter_lf !== null) conf.window_door_perimeter_lf = T.SUMMARY_SECTION;
  if (data.wall_area_by_direction) conf.wall_area_by_direction = T.TABLE_OR_REPEATED;
  if (data.wall_area_by_elevation) conf.wall_area_by_elevation = T.TABLE_OR_REPEATED;
  if (data.window_door_area_by_elevation) conf.window_door_area_by_elevation = T.TABLE_OR_REPEATED;
  if (data.window_door_perimeter_by_elevation) conf.window_door_perimeter_by_elevation = T.TABLE_OR_REPEATED;
  if (data.window_door_count_by_elevation) conf.window_door_count_by_elevation = T.TABLE_OR_REPEATED;
  if (data.wall_waste_table) conf.wall_waste_table = T.TABLE_OR_REPEATED;
  if (data.report_date) conf.report_date = T.SUMMARY_SECTION;

  const required = ["wall_area_sqft", "wall_facets_count"] as const;
  const missing_fields = required.filter((k) => (data as Record<string, unknown>)[k] === null);

  if (!matched_signal) for (const k of Object.keys(conf)) conf[k] = Math.min(conf[k], T.WEAK);

  const overall = aggregate(conf);

  const validation_errors: WallParseResult["validation_errors"] = [];
  // Cross-check: with-W&D area should be >= bare wall area when both present.
  if (
    data.wall_area_sqft !== null &&
    data.wall_area_with_windows_doors_sqft !== null &&
    data.wall_area_with_windows_doors_sqft < data.wall_area_sqft * 0.95
  ) {
    validation_errors.push({
      code: "wall_area_with_wd_less_than_bare",
      severity: "warning",
      message: "wall_area_with_windows_doors_sqft is unexpectedly less than wall_area_sqft",
    });
  }

  const hasErr = validation_errors.some((v) => v.severity === "error");
  const requires_review = overall < 0.7 || missing_fields.length > 0 || hasErr;

  return {
    vendor_type: "eagleview",
    document_type: "wall_report",
    parser_name: EAGLEVIEW_WALL_PARSER_NAME,
    parser_version: EAGLEVIEW_WALL_PARSER_VERSION,
    parser_tier: "deterministic",
    data,
    field_confidences: conf,
    overall_confidence: overall,
    missing_fields,
    validation_errors,
    requires_review,
    matched_signal,
  };
}

function aggregate(conf: Record<string, number>): number {
  const vals = Object.values(conf);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
