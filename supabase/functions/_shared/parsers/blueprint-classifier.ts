// Deterministic blueprint page classifier — no AI. Replaces the prior
// classify-blueprint-pages function for selectable-text PDFs.
//
// Returns one classification per page based on keyword heuristics.
// Pages whose top-confidence label is below REVIEW_FLOOR are flagged for
// human review (or future AI fallback).

import { CONFIDENCE_THRESHOLDS } from "./confidence.ts";

export const BLUEPRINT_CLASSIFIER_NAME = "blueprint-classifier";
export const BLUEPRINT_CLASSIFIER_VERSION = "v1.0.0";

export type PageType =
  | "roof_plan" | "framing_plan" | "detail_sheet" | "specification_sheet"
  | "section_sheet" | "schedule_sheet" | "cover_sheet" | "irrelevant" | "unknown";

// Fine-grained sub-type label (text column on plan_pages). Free-form so we can
// grow it without DB enum migrations.
export type PageSubtype =
  | "architectural" | "interior_framing" | "structural_framing" | "drywall"
  | "interior_finishes" | "rcp_ceiling" | "flashing" | "stucco" | "siding"
  | "roofing" | "waterproofing" | "insulation" | "millwork" | "casework"
  | "door_schedule" | "window_schedule" | "mechanical" | "electrical"
  | "plumbing" | "fire_protection" | "civil" | "landscape" | "demolition"
  | null;

interface Rule {
  type: PageType;
  // each entry is a list of patterns; ANY group matching adds its weight
  groups: Array<{ patterns: RegExp[]; weight: number }>;
}

const RULES: Rule[] = [
  { type: "roof_plan", groups: [
    { patterns: [/\bROOF\s+PLAN\b/i, /\bROOFING\s+PLAN\b/i], weight: 0.7 },
    { patterns: [/RIDGE/i, /VALLEY/i, /HIP/i, /EAVE/i, /RAKE/i], weight: 0.15 },
    { patterns: [/PITCH/i, /SLOPE\s*\d/i, /\d+\s*\/\s*12/], weight: 0.1 },
  ]},
  { type: "framing_plan", groups: [
    { patterns: [/\bFRAMING\s+PLAN\b/i, /\bROOF\s+FRAMING\b/i, /\bFLOOR\s+FRAMING\b/i], weight: 0.8 },
    { patterns: [/JOIST/i, /RAFTER/i, /TRUSS/i, /HEADER/i], weight: 0.15 },
  ]},
  { type: "detail_sheet", groups: [
    { patterns: [/\bDETAIL[S]?\b/i, /\bDETAILS\s+SHEET\b/i], weight: 0.5 },
    { patterns: [/SECTION\s+[A-Z]-[A-Z]/i, /SCALE\s*:?\s*\d/i], weight: 0.2 },
  ]},
  { type: "specification_sheet", groups: [
    { patterns: [/\bSPECIFICATIONS?\b/i, /\bGENERAL\s+NOTES\b/i, /\bCONSTRUCTION\s+NOTES\b/i], weight: 0.7 },
  ]},
  { type: "section_sheet", groups: [
    { patterns: [/\bBUILDING\s+SECTION\b/i, /\bCROSS\s+SECTION\b/i, /\bWALL\s+SECTION\b/i], weight: 0.7 },
  ]},
  { type: "schedule_sheet", groups: [
    { patterns: [/\bDOOR\s+SCHEDULE\b/i, /\bWINDOW\s+SCHEDULE\b/i, /\bFINISH\s+SCHEDULE\b/i, /\bSCHEDULES?\b/i], weight: 0.6 },
  ]},
  { type: "cover_sheet", groups: [
    { patterns: [/\bCOVER\s+SHEET\b/i, /\bTITLE\s+SHEET\b/i, /\bSHEET\s+INDEX\b/i, /\bDRAWING\s+INDEX\b/i], weight: 0.7 },
  ]},
];

const IRRELEVANT_HINTS = [/\bCOLOPHON\b/i, /\bCERTIFICATE\b/i, /\bCOVER\s+LETTER\b/i];

// Sheet-number prefix → discipline. Tolerant to "A-101", "A101", "A1.1".
function disciplineFromSheet(sheet: string | null): PageSubtype {
  if (!sheet) return null;
  const s = sheet.trim().toUpperCase();
  const prefix = s.match(/^([A-Z]{1,3})[\s\-.]?\d/)?.[1] ?? "";
  switch (prefix) {
    case "A":   return "architectural";
    case "AD":  return "demolition";
    case "S":   return "structural_framing";
    case "M":   return "mechanical";
    case "E":   return "electrical";
    case "P":   return "plumbing";
    case "FP":
    case "F":   return "fire_protection";
    case "C":   return "civil";
    case "L":   return "landscape";
    case "I":
    case "ID":  return "interior_finishes";
    default:    return null;
  }
}

// Keyword overrides — return the more specific trade when the page text or
// title strongly suggests it, regardless of sheet prefix.
const SUBTYPE_KEYWORDS: Array<{ subtype: Exclude<PageSubtype, null>; patterns: RegExp[] }> = [
  { subtype: "interior_framing", patterns: [/INTERIOR\s+(?:PARTITION|FRAMING)/i, /PARTITION\s+PLAN/i, /STUD\s+PLAN/i] },
  { subtype: "drywall", patterns: [/\bDRYWALL\b/i, /\bGYPSUM\b/i, /\bGWB\b/i, /\bGYP\.?\s*BOARD\b/i] },
  { subtype: "rcp_ceiling", patterns: [/REFLECTED\s+CEILING/i, /\bRCP\b/i, /CEILING\s+PLAN/i] },
  { subtype: "flashing", patterns: [/\bFLASHING\b/i, /STEP\s+FLASH/i, /COUNTER[-\s]?FLASH/i] },
  { subtype: "stucco", patterns: [/\bSTUCCO\b/i, /EIFS/i, /CEMENT\s+PLASTER/i] },
  { subtype: "siding", patterns: [/\bSIDING\b/i, /HARDIE/i, /LAP\s+SIDING/i, /BOARD\s*&\s*BATTEN/i] },
  { subtype: "roofing", patterns: [/\bSHINGLE/i, /\bTPO\b/i, /\bEPDM\b/i, /STANDING\s+SEAM/i, /BUILT[-\s]?UP\s+ROOF/i, /MODIFIED\s+BITUMEN/i] },
  { subtype: "waterproofing", patterns: [/WATERPROOFING/i, /\bAIR\s+BARRIER\b/i, /\bVAPOR\s+BARRIER\b/i] },
  { subtype: "insulation", patterns: [/\bINSULATION\b/i, /\bR-?\d{1,2}\b.*BATT/i, /SPRAY\s+FOAM/i] },
  { subtype: "millwork", patterns: [/\bMILLWORK\b/i, /TRIM\s+DETAILS?/i] },
  { subtype: "casework", patterns: [/\bCASEWORK\b/i, /CABINET\s+ELEV/i] },
  { subtype: "door_schedule", patterns: [/\bDOOR\s+SCHEDULE\b/i] },
  { subtype: "window_schedule", patterns: [/\bWINDOW\s+SCHEDULE\b/i] },
];

export interface PageClassification {
  page_number: number;
  page_type: PageType;
  page_subtype: PageSubtype;
  confidence: number;
  sheet_number: string | null;
  sheet_name: string | null;
  scale_text: string | null;
  requires_review: boolean;
}

// Common drawing-scale phrasings: 1/4" = 1'-0", 3/16" = 1', 1:50, 1/8 IN = 1 FT.
function extractScale(t: string): string | null {
  const m1 = t.match(/\b(\d{1,2}\s*\/\s*\d{1,2}\s*["”]?\s*=\s*\d{1,3}\s*['’][-\s]?\d{0,2}\s*["”]?)/);
  if (m1) return m1[1].replace(/\s+/g, " ").trim();
  const m2 = t.match(/\b(1\s*:\s*\d{1,4})\b/);
  if (m2) return m2[1].replace(/\s+/g, "");
  const m3 = t.match(/\bSCALE\s*:?\s*([0-9/."'=\s'\-]+?)(?:\s|$)/i);
  if (m3) return m3[1].trim();
  return null;
}

export function classifyBlueprintPage(page_number: number, text: string): PageClassification {
  const t = text || "";
  if (t.replace(/\s+/g, "").length < 20) {
    return {
      page_number, page_type: "unknown", page_subtype: null, confidence: 0,
      sheet_number: null, sheet_name: null, scale_text: null, requires_review: true,
    };
  }

  const sheet_number = t.match(/\b([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?)\b/)?.[1] ?? null;
  const scale_text = extractScale(t);
  const sheet_name = t.match(/\b([A-Z][A-Z ]{5,40})\b/)?.[1]?.trim() ?? null;

  let best: { type: PageType; confidence: number } = { type: "unknown", confidence: 0 };
  for (const rule of RULES) {
    let score = 0;
    for (const g of rule.groups) {
      if (g.patterns.some((p) => p.test(t))) score += g.weight;
    }
    if (score > best.confidence) best = { type: rule.type, confidence: Math.min(score, 0.99) };
  }
  if (best.confidence < 0.3 && IRRELEVANT_HINTS.some((p) => p.test(t))) {
    best = { type: "irrelevant", confidence: 0.6 };
  }

  // Sub-type: prefer specific keyword hit, else discipline-from-sheet.
  let subtype: PageSubtype = null;
  for (const k of SUBTYPE_KEYWORDS) {
    if (k.patterns.some((p) => p.test(t))) { subtype = k.subtype; break; }
  }
  if (!subtype) subtype = disciplineFromSheet(sheet_number);

  return {
    page_number,
    page_type: best.confidence < 0.2 ? "unknown" : best.type,
    page_subtype: subtype,
    confidence: best.confidence,
    sheet_number, sheet_name, scale_text,
    requires_review: best.confidence < CONFIDENCE_THRESHOLDS.REVIEW_FLOOR,
  };
}

