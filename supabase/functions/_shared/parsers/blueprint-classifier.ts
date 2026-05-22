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

export interface PageClassification {
  page_number: number;
  page_type: PageType;
  confidence: number;
  sheet_number: string | null;
  sheet_name: string | null;
  scale_text: string | null;
  requires_review: boolean;
}

export function classifyBlueprintPage(page_number: number, text: string): PageClassification {
  const t = text || "";
  if (t.replace(/\s+/g, "").length < 20) {
    return { page_number, page_type: "unknown", confidence: 0, sheet_number: null, sheet_name: null, scale_text: null, requires_review: true };
  }

  // Sheet number (e.g. "A-101", "S2.1", "M3")
  const sheet_number = t.match(/\b([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?)\b/)?.[1] ?? null;
  const scale_text = t.match(/\bSCALE\s*:?\s*([0-9/."'= ]+)\b/i)?.[1]?.trim() ?? null;
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

  return {
    page_number,
    page_type: best.confidence < 0.2 ? "unknown" : best.type,
    confidence: best.confidence,
    sheet_number, sheet_name, scale_text,
    requires_review: best.confidence < CONFIDENCE_THRESHOLDS.REVIEW_FLOOR,
  };
}
