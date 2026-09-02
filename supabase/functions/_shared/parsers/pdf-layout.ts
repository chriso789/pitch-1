// Coordinate-preserving PDF extraction for blueprint intelligence.
// Additive to pdf-text.ts: existing deterministic report parsers continue to use
// text-only extraction while blueprint intelligence can consume positioned text.

import { getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

export const PDF_LAYOUT_VERSION = "f1-layout-v1";

export interface PdfLayoutTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation_deg: number;
  font_name: string | null;
}

export interface PdfLayoutPage {
  page_number: number;
  width_points: number;
  height_points: number;
  rotation_deg: number;
  text_items: PdfLayoutTextItem[];
  text: string;
  has_selectable_text: boolean;
  vector_extraction_status: "deferred";
}

export interface PdfLayoutResult {
  page_count: number;
  version: string;
  pages: PdfLayoutPage[];
}

type PdfJsTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRotation(transform: number[]): number {
  if (transform.length < 2) return 0;
  const deg = Math.atan2(transform[1], transform[0]) * 180 / Math.PI;
  const normalized = ((deg % 360) + 360) % 360;
  return Number(normalized.toFixed(3));
}

function normalizeTextItem(raw: PdfJsTextItem, pageHeight: number): PdfLayoutTextItem | null {
  const text = typeof raw.str === "string" ? raw.str.trim() : "";
  if (!text) return null;

  const transform = Array.isArray(raw.transform)
    ? raw.transform.map((v) => finiteNumber(v))
    : [1, 0, 0, 1, 0, 0];

  const width = Math.max(0, finiteNumber(raw.width));
  const rawHeight = Math.max(0, finiteNumber(raw.height));
  const inferredHeight = Math.max(Math.abs(transform[3] ?? 0), Math.abs(transform[0] ?? 0));
  const height = rawHeight > 0 ? rawHeight : inferredHeight;
  const x = finiteNumber(transform[4]);
  const pdfY = finiteNumber(transform[5]);

  // PDF.js positions text from a bottom-left origin. Normalize to a top-left
  // origin so sheet viewports and persisted bounding boxes use UI-friendly coordinates.
  const y = Math.max(0, pageHeight - pdfY - height);

  return {
    text,
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    width: Number(width.toFixed(3)),
    height: Number(height.toFixed(3)),
    rotation_deg: normalizeRotation(transform),
    font_name: typeof raw.fontName === "string" ? raw.fontName : null,
  };
}

export async function extractPdfLayout(bytes: Uint8Array): Promise<PdfLayoutResult> {
  const pdf = await getDocumentProxy(bytes);
  const pages: PdfLayoutPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = Array.isArray(content?.items) ? content.items as PdfJsTextItem[] : [];
    const textItems = items
      .map((item) => normalizeTextItem(item, viewport.height))
      .filter((item): item is PdfLayoutTextItem => Boolean(item));
    const text = textItems.map((item) => item.text).join(" ");

    pages.push({
      page_number: pageNumber,
      width_points: Number(viewport.width.toFixed(3)),
      height_points: Number(viewport.height.toFixed(3)),
      rotation_deg: finiteNumber(page.rotate),
      text_items: textItems,
      text,
      has_selectable_text: text.replace(/\s+/g, "").length >= 40,
      vector_extraction_status: "deferred",
    });
  }

  return { page_count: pdf.numPages, version: PDF_LAYOUT_VERSION, pages };
}
