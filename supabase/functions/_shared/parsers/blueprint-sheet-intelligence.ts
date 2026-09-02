// Blueprint F1 sheet-intelligence foundation.
// Pure deterministic helpers only: no DB writes and no AI calls.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import { classifyBlueprintPage } from "./blueprint-classifier.ts";

export const SHEET_INTELLIGENCE_VERSION = "f1-sheet-intelligence-v1";

export type BlueprintDiscipline =
  | "general" | "architectural" | "structural" | "mechanical" | "electrical"
  | "plumbing" | "fire_protection" | "civil" | "landscape" | "interiors" | "unknown";

export interface NormalizedScale {
  raw: string;
  kind: "architectural" | "ratio" | "unknown";
  paper_inches: number | null;
  real_feet: number | null;
  ratio: number | null;
  feet_per_paper_inch: number | null;
}

export interface SheetIndexEntry {
  sheet_number: string;
  sheet_title: string | null;
  discipline: BlueprintDiscipline;
  confidence: number;
  source_text: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

export interface SheetIntelligence {
  version: string;
  page_number: number;
  sheet_number: string | null;
  sheet_title: string | null;
  discipline: BlueprintDiscipline;
  page_type: string;
  page_subtype: string | null;
  classification_confidence: number;
  scale: NormalizedScale | null;
  sheet_index_entries: SheetIndexEntry[];
  title_block_bbox: { x: number; y: number; width: number; height: number } | null;
  requires_review: boolean;
}

const SHEET_NUMBER_RE = /\b([A-Z]{1,3}[\-.]?\d{1,3}(?:\.\d{1,2})?)\b/i;
const INDEX_LINE_RE = /^\s*([A-Z]{1,3}[\-.]?\d{1,3}(?:\.\d{1,2})?)\s+(.{3,80})\s*$/i;

export function disciplineFromSheetNumber(sheet: string | null): BlueprintDiscipline {
  if (!sheet) return "unknown";
  const prefix = sheet.toUpperCase().match(/^([A-Z]{1,3})/)?.[1] ?? "";
  if (prefix === "G") return "general";
  if (prefix === "A" || prefix === "AD") return "architectural";
  if (prefix === "S") return "structural";
  if (prefix === "M") return "mechanical";
  if (prefix === "E") return "electrical";
  if (prefix === "P") return "plumbing";
  if (prefix === "FP" || prefix === "F") return "fire_protection";
  if (prefix === "C") return "civil";
  if (prefix === "L") return "landscape";
  if (prefix === "I" || prefix === "ID") return "interiors";
  return "unknown";
}

function parseFraction(value: string): number | null {
  const cleaned = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const m = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const denominator = Number(m[2]);
  return denominator === 0 ? null : Number(m[1]) / denominator;
}

export function normalizeScale(rawScale: string | null): NormalizedScale | null {
  if (!rawScale) return null;
  const raw = rawScale.replace(/[”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, " ").trim();

  const architectural = raw.match(/(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*"?\s*=\s*(\d+(?:\.\d+)?)\s*'\s*(?:-\s*(\d+(?:\.\d+)?)\s*")?/i);
  if (architectural) {
    const paperInches = parseFraction(architectural[1]);
    const feet = Number(architectural[2]);
    const extraInches = architectural[3] ? Number(architectural[3]) : 0;
    const realFeet = feet + extraInches / 12;
    return {
      raw,
      kind: "architectural",
      paper_inches: paperInches,
      real_feet: Number.isFinite(realFeet) ? realFeet : null,
      ratio: null,
      feet_per_paper_inch: paperInches && paperInches > 0 ? realFeet / paperInches : null,
    };
  }

  const ratio = raw.match(/^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (ratio) {
    const r = Number(ratio[1]);
    return {
      raw,
      kind: "ratio",
      paper_inches: null,
      real_feet: null,
      ratio: Number.isFinite(r) ? r : null,
      feet_per_paper_inch: null,
    };
  }

  return { raw, kind: "unknown", paper_inches: null, real_feet: null, ratio: null, feet_per_paper_inch: null };
}

function bboxForItems(items: PdfLayoutTextItem[]): { x: number; y: number; width: number; height: number } | null {
  if (!items.length) return null;
  const left = Math.min(...items.map((i) => i.x));
  const top = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.width));
  const bottom = Math.max(...items.map((i) => i.y + i.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function titleBlockItems(page: PdfLayoutPage): PdfLayoutTextItem[] {
  // Most US construction title blocks occupy the lower or right sheet edge.
  // Keep this intentionally broad; downstream confidence/review gates prevent
  // treating it as authoritative when evidence is weak.
  return page.text_items.filter((item) =>
    item.y >= page.height_points * 0.72 || item.x >= page.width_points * 0.72
  );
}

function bestSheetNumber(items: PdfLayoutTextItem[], fallbackText: string): string | null {
  const candidates = items
    .map((item) => item.text.match(SHEET_NUMBER_RE)?.[1] ?? null)
    .filter((v): v is string => Boolean(v));
  if (candidates.length) return candidates[candidates.length - 1].toUpperCase();
  return fallbackText.match(SHEET_NUMBER_RE)?.[1]?.toUpperCase() ?? null;
}

function bestSheetTitle(items: PdfLayoutTextItem[], sheetNumber: string | null): string | null {
  const candidates = items
    .map((item) => item.text.trim())
    .filter((text) => text.length >= 4 && text.length <= 60)
    .filter((text) => !sheetNumber || !text.toUpperCase().includes(sheetNumber.toUpperCase()))
    .filter((text) => /[A-Z]/i.test(text) && !/^\d+$/.test(text));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0].replace(/\s+/g, " ").trim();
}

export function extractSheetIndexEntries(page: PdfLayoutPage): SheetIndexEntry[] {
  const entries: SheetIndexEntry[] = [];
  const seen = new Set<string>();

  // Coordinate-aware pass: group text items into approximate rows.
  const rowTolerance = Math.max(3, page.height_points * 0.004);
  const rows = new Map<number, PdfLayoutTextItem[]>();
  for (const item of page.text_items) {
    const key = Math.round(item.y / rowTolerance);
    const row = rows.get(key) ?? [];
    row.push(item);
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    const rowText = row.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim();
    const match = rowText.match(INDEX_LINE_RE);
    if (!match) continue;
    const sheetNumber = match[1].toUpperCase();
    if (seen.has(sheetNumber)) continue;
    const title = match[2].trim().replace(/[.·]{3,}/g, " ").replace(/\s+/g, " ");
    if (!title || title.length < 3) continue;
    seen.add(sheetNumber);
    entries.push({
      sheet_number: sheetNumber,
      sheet_title: title,
      discipline: disciplineFromSheetNumber(sheetNumber),
      confidence: 0.9,
      source_text: rowText,
      bbox: bboxForItems(row),
    });
  }

  return entries;
}

export function analyzeBlueprintSheet(page: PdfLayoutPage): SheetIntelligence {
  const classification = classifyBlueprintPage(page.page_number, page.text);
  const titleItems = titleBlockItems(page);
  const sheetNumber = bestSheetNumber(titleItems, page.text);
  const sheetTitle = bestSheetTitle(titleItems, sheetNumber) ?? classification.sheet_name;
  const rawScale = classification.scale_text;
  const scale = normalizeScale(rawScale);
  const sheetIndexEntries = classification.page_type === "cover_sheet" || /SHEET\s+INDEX|DRAWING\s+INDEX/i.test(page.text)
    ? extractSheetIndexEntries(page)
    : [];

  const requiresReview = classification.requires_review || !sheetNumber;

  return {
    version: SHEET_INTELLIGENCE_VERSION,
    page_number: page.page_number,
    sheet_number: sheetNumber,
    sheet_title: sheetTitle,
    discipline: disciplineFromSheetNumber(sheetNumber),
    page_type: classification.page_type,
    page_subtype: classification.page_subtype,
    classification_confidence: classification.confidence,
    scale,
    sheet_index_entries: sheetIndexEntries,
    title_block_bbox: bboxForItems(titleItems),
    requires_review: requiresReview,
  };
}

export function findMissingIndexedSheets(indexEntries: SheetIndexEntry[], analyzedSheets: SheetIntelligence[]): string[] {
  const actual = new Set(analyzedSheets.map((s) => s.sheet_number).filter((v): v is string => Boolean(v)));
  return indexEntries
    .map((entry) => entry.sheet_number)
    .filter((sheetNumber) => !actual.has(sheetNumber));
}
