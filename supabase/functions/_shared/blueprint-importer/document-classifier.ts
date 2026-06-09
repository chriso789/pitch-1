// Blueprint Importer v2 — Phase 3 deterministic document classifier.
// Pure function; no IO, no AI. Classifies raw report text into one of the
// supported MVP document types or 'unknown'. Generic blueprint sets are
// classified as 'blueprint_set' but routed to a review-only path upstream.

export type BlueprintDocumentType =
  | "roofr_roof_report"
  | "eagleview_roof_report"
  | "eagleview_wall_report"
  | "blueprint_set"
  | "spec_book"
  | "unknown";

export type BlueprintDocumentProvider =
  | "roofr"
  | "eagleview"
  | "user_uploaded_blueprint"
  | "unknown";

export interface DocumentClassification {
  document_type: BlueprintDocumentType;
  provider: BlueprintDocumentProvider;
  confidence: number; // 0..1
  signals: string[];
  // Mapping to DB-side document_type CHECK enum.
  db_document_type: "roof_report" | "wall_report" | "blueprint_set" | "spec_book" | "unknown";
  db_provider: "roofr" | "eagleview" | "user_uploaded_blueprint" | "unknown";
}

const EAGLEVIEW_BRAND_RE = /eagle[\s-]?view/i;
const ROOFR_BRAND_RE = /\broofr\b/i;
const ROOF_REPORT_RE = /\b(roof\s+report|total\s+roof\s+area|predominant\s+pitch|ridges?\s*\(ft\)|hips?\s*\(ft\))/i;
const WALL_REPORT_RE = /\b(wall\s+report|total\s+wall\s+area|wall\s+facets|inside\s+corners|outside\s+corners|window\s+&\s+door\s+area)/i;
const SPEC_BOOK_RE = /\b(specifications|spec\s+book|division\s+\d{2}|section\s+\d{6})/i;
const BLUEPRINT_SET_RE = /\b(sheet\s+(?:a|s|e|m|p)-?\d+|architectural\s+plans?|plan\s+set)/i;
// Brand-less fallback requires a STRONG, report-specific phrase — generic
// words like "fascia" or "wall" alone are not enough (they appear in permits,
// inspections, and HOA letters). Without these we degrade to `unknown` so the
// session shows a clean empty-state instead of a noisy 0-confidence wall_report.
const STRONG_ROOF_RE = /\b(total\s+roof\s+area|predominant\s+pitch|ridges?\s*\(ft\)|hips?\s*\(ft\))/i;
const STRONG_WALL_RE = /\b(total\s+wall\s+area|wall\s+facets|window\s+&\s+door\s+area)/i;

export function classifyBlueprintDocument(rawText: string): DocumentClassification {
  const text = String(rawText ?? "");
  const signals: string[] = [];

  const hitEv = EAGLEVIEW_BRAND_RE.test(text);
  const hitRoofr = ROOFR_BRAND_RE.test(text);
  const hitRoof = ROOF_REPORT_RE.test(text);
  const hitWall = WALL_REPORT_RE.test(text);
  const hitSpec = SPEC_BOOK_RE.test(text);
  const hitBlueprint = BLUEPRINT_SET_RE.test(text);
  const hitStrongRoof = STRONG_ROOF_RE.test(text);
  const hitStrongWall = STRONG_WALL_RE.test(text);

  if (hitEv) signals.push("brand:eagleview");
  if (hitRoofr) signals.push("brand:roofr");
  if (hitRoof) signals.push("section:roof_report");
  if (hitWall) signals.push("section:wall_report");
  if (hitSpec) signals.push("section:spec_book");
  if (hitBlueprint) signals.push("section:blueprint_set");
  if (hitStrongRoof) signals.push("strong:roof_report_signal");
  if (hitStrongWall) signals.push("strong:wall_report_signal");

  // EagleView wall report — wall signals AND EagleView brand
  if (hitEv && hitWall && !hitRoof) {
    return mk("eagleview_wall_report", "eagleview", 0.95, signals, "wall_report", "eagleview");
  }
  // EagleView roof report
  if (hitEv && hitRoof) {
    return mk("eagleview_roof_report", "eagleview", 0.95, signals, "roof_report", "eagleview");
  }
  // Roofr roof report
  if (hitRoofr && hitRoof) {
    return mk("roofr_roof_report", "roofr", 0.95, signals, "roof_report", "roofr");
  }
  // Brand-less fallback: only accept when a STRONG report-specific signal is present.
  if (hitStrongRoof && !hitStrongWall) {
    return mk("eagleview_roof_report", "unknown", 0.6, signals, "roof_report", "unknown");
  }
  if (hitStrongWall) {
    return mk("eagleview_wall_report", "unknown", 0.6, signals, "wall_report", "unknown");
  }
  if (hitSpec) {
    return mk("spec_book", "user_uploaded_blueprint", 0.6, signals, "spec_book", "user_uploaded_blueprint");
  }
  if (hitBlueprint) {
    return mk("blueprint_set", "user_uploaded_blueprint", 0.6, signals, "blueprint_set", "user_uploaded_blueprint");
  }
  return mk("unknown", "unknown", 0.0, signals, "unknown", "unknown");
}

function mk(
  document_type: BlueprintDocumentType,
  provider: BlueprintDocumentProvider,
  confidence: number,
  signals: string[],
  db_document_type: DocumentClassification["db_document_type"],
  db_provider: DocumentClassification["db_provider"],
): DocumentClassification {
  return { document_type, provider, confidence, signals, db_document_type, db_provider };
}
