// Blueprint F1 runtime payload builder.
// Converts a PDF into coordinate-aware, persistence-ready sheet intelligence.
// Pure with respect to storage/DB: callers decide when/how to persist outputs.

import { extractPdfLayout, PDF_LAYOUT_VERSION, type PdfLayoutPage } from "./pdf-layout.ts";
import {
  analyzeBlueprintSheet,
  findMissingIndexedSheets,
  SHEET_INTELLIGENCE_VERSION,
  type SheetIndexEntry,
  type SheetIntelligence,
} from "./blueprint-sheet-intelligence.ts";

export const BLUEPRINT_F1_RUNTIME_VERSION = "blueprint-f1-runtime-v1";

export interface BlueprintF1PagePersistenceRow {
  page_number: number;
  raw_text: string;
  page_type: string;
  page_subtype: string | null;
  page_type_confidence: number;
  sheet_name: string | null;
  sheet_number: string | null;
  scale_text: string | null;
  scale_source: "pdf_layout" | null;
  width_points: number;
  height_points: number;
  layout_version: string;
  layout_extraction_status: "completed";
  layout_json: {
    rotation_deg: number;
    text_items: PdfLayoutPage["text_items"];
    vector_extraction_status: "deferred";
    title_block_bbox: SheetIntelligence["title_block_bbox"];
    discipline: SheetIntelligence["discipline"];
    normalized_scale: SheetIntelligence["scale"];
    sheet_intelligence_version: string;
    requires_review: boolean;
  };
}

export interface BlueprintF1IndexPersistenceRow {
  source_page_number: number;
  sheet_number: string;
  sheet_title: string | null;
  discipline: SheetIndexEntry["discipline"];
  confidence: number;
  source_text: string;
  bbox: SheetIndexEntry["bbox"];
  status: "detected" | "missing";
  metadata: {
    runtime_version: string;
    sheet_intelligence_version: string;
    indexed_from_page: number;
    present_in_document: boolean;
  };
}

export interface BlueprintF1RuntimeResult {
  runtime_version: string;
  layout_version: string;
  sheet_intelligence_version: string;
  page_count: number;
  pages: BlueprintF1PagePersistenceRow[];
  analyzed_sheets: SheetIntelligence[];
  sheet_index_entries: BlueprintF1IndexPersistenceRow[];
  missing_indexed_sheets: string[];
  requires_review: boolean;
  summary: {
    pages_with_sheet_number: number;
    pages_with_scale: number;
    index_entry_count: number;
    missing_indexed_sheet_count: number;
    image_only_page_count: number;
  };
}

function trimRawText(text: string): string {
  // Preserve the existing plan_pages safety cap. Coordinate text remains available
  // in layout_json, while raw_text stays compact for existing classifier/review UI.
  return text.slice(0, 8000);
}

function pageToPersistenceRow(page: PdfLayoutPage, intelligence: SheetIntelligence): BlueprintF1PagePersistenceRow {
  return {
    page_number: page.page_number,
    raw_text: trimRawText(page.text),
    page_type: intelligence.page_type,
    page_subtype: intelligence.page_subtype,
    page_type_confidence: intelligence.classification_confidence,
    sheet_name: intelligence.sheet_title,
    sheet_number: intelligence.sheet_number,
    scale_text: intelligence.scale?.raw ?? null,
    scale_source: intelligence.scale ? "pdf_layout" : null,
    width_points: page.width_points,
    height_points: page.height_points,
    layout_version: PDF_LAYOUT_VERSION,
    layout_extraction_status: "completed",
    layout_json: {
      rotation_deg: page.rotation_deg,
      text_items: page.text_items,
      vector_extraction_status: page.vector_extraction_status,
      title_block_bbox: intelligence.title_block_bbox,
      discipline: intelligence.discipline,
      normalized_scale: intelligence.scale,
      sheet_intelligence_version: SHEET_INTELLIGENCE_VERSION,
      requires_review: intelligence.requires_review,
    },
  };
}

function indexRows(
  analyzed: SheetIntelligence[],
  missing: Set<string>,
): BlueprintF1IndexPersistenceRow[] {
  const presentSheets = new Set(
    analyzed.map((sheet) => sheet.sheet_number).filter((value): value is string => Boolean(value)),
  );
  const deduped = new Map<string, BlueprintF1IndexPersistenceRow>();

  for (const sourceSheet of analyzed) {
    for (const entry of sourceSheet.sheet_index_entries) {
      const isMissing = missing.has(entry.sheet_number);
      const row: BlueprintF1IndexPersistenceRow = {
        source_page_number: sourceSheet.page_number,
        sheet_number: entry.sheet_number,
        sheet_title: entry.sheet_title,
        discipline: entry.discipline,
        confidence: entry.confidence,
        source_text: entry.source_text,
        bbox: entry.bbox,
        status: isMissing ? "missing" : "detected",
        metadata: {
          runtime_version: BLUEPRINT_F1_RUNTIME_VERSION,
          sheet_intelligence_version: SHEET_INTELLIGENCE_VERSION,
          indexed_from_page: sourceSheet.page_number,
          present_in_document: presentSheets.has(entry.sheet_number),
        },
      };

      const prior = deduped.get(entry.sheet_number);
      if (!prior || row.confidence > prior.confidence) deduped.set(entry.sheet_number, row);
    }
  }

  return [...deduped.values()].sort((a, b) => a.sheet_number.localeCompare(b.sheet_number));
}

export function buildBlueprintF1RuntimeFromLayout(
  layout: { page_count: number; version: string; pages: PdfLayoutPage[] },
): BlueprintF1RuntimeResult {
  const analyzed = layout.pages.map(analyzeBlueprintSheet);
  const allIndexEntries = analyzed.flatMap((sheet) => sheet.sheet_index_entries);
  const missingIndexedSheets = findMissingIndexedSheets(allIndexEntries, analyzed);
  const missingSet = new Set(missingIndexedSheets);
  const pages = layout.pages.map((page, index) => pageToPersistenceRow(page, analyzed[index]));
  const sheetIndexEntries = indexRows(analyzed, missingSet);
  const imageOnlyPageCount = layout.pages.filter((page) => !page.has_selectable_text).length;

  return {
    runtime_version: BLUEPRINT_F1_RUNTIME_VERSION,
    layout_version: layout.version,
    sheet_intelligence_version: SHEET_INTELLIGENCE_VERSION,
    page_count: layout.page_count,
    pages,
    analyzed_sheets: analyzed,
    sheet_index_entries: sheetIndexEntries,
    missing_indexed_sheets: missingIndexedSheets,
    requires_review: analyzed.some((sheet) => sheet.requires_review) || missingIndexedSheets.length > 0 || imageOnlyPageCount > 0,
    summary: {
      pages_with_sheet_number: analyzed.filter((sheet) => Boolean(sheet.sheet_number)).length,
      pages_with_scale: analyzed.filter((sheet) => Boolean(sheet.scale)).length,
      index_entry_count: sheetIndexEntries.length,
      missing_indexed_sheet_count: missingIndexedSheets.length,
      image_only_page_count: imageOnlyPageCount,
    },
  };
}

export async function analyzeBlueprintPdfF1(bytes: Uint8Array): Promise<BlueprintF1RuntimeResult> {
  const layout = await extractPdfLayout(bytes);
  return buildBlueprintF1RuntimeFromLayout(layout);
}
