// Blueprint F1C/F1D drawing viewport + detail-reference foundation.
// Deterministic, coordinate-aware, and intentionally non-measuring.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import { normalizeScale, type NormalizedScale } from "./blueprint-sheet-intelligence.ts";

export const BLUEPRINT_VIEWPORT_VERSION = "f1-viewport-v1";
export const BLUEPRINT_REFERENCE_VERSION = "f1-reference-v1";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawingViewport {
  viewport_key: string;
  page_number: number;
  title: string | null;
  scale: NormalizedScale | null;
  bbox: BoundingBox;
  confidence: number;
  source: "title_scale_cluster" | "page_fallback";
  metadata: {
    version: string;
    title_item_text: string | null;
    scale_item_text: string | null;
  };
}

export interface DrawingReference {
  page_number: number;
  viewport_key: string | null;
  raw_text: string;
  detail_number: string | null;
  target_sheet_number: string;
  bbox: BoundingBox;
  confidence: number;
  reference_type: "detail_callout" | "section_callout" | "sheet_reference";
  metadata: {
    version: string;
  };
}

const SCALE_RE = /(?:SCALE\s*:?[ ]*)?((?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*["”]?\s*=\s*\d+(?:\.\d+)?\s*['’](?:\s*-\s*\d+(?:\.\d+)?\s*["”])?|1\s*:\s*\d+(?:\.\d+)?)/i;
const DETAIL_REF_RE = /\b(\d{1,3}|[A-Z])\s*\/\s*([A-Z]{1,3}[\-.]?\d{1,3}(?:\.\d{1,2})?)\b/i;
const SHEET_REF_RE = /\b(?:SEE\s+(?:DETAIL|SECTION|SHEET)\s+)?([A-Z]{1,3}[\-.]?\d{1,3}(?:\.\d{1,2})?)\b/i;
const TITLE_HINT_RE = /\b(PLAN|DETAIL|SECTION|ELEVATION|SCHEDULE|DIAGRAM|ENLARGED|ROOF|FLOOR|CEILING|FRAMING|WALL|FOUNDATION|MECHANICAL|ELECTRICAL|PLUMBING)\b/i;

function bboxForItem(item: PdfLayoutTextItem): BoundingBox {
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function union(items: PdfLayoutTextItem[]): BoundingBox {
  const left = Math.min(...items.map((i) => i.x));
  const top = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.width));
  const bottom = Math.max(...items.map((i) => i.y + i.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function center(item: PdfLayoutTextItem) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

function distance(a: PdfLayoutTextItem, b: PdfLayoutTextItem): number {
  const ca = center(a);
  const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function likelyTitle(item: PdfLayoutTextItem): boolean {
  const text = item.text.replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > 80) return false;
  if (SCALE_RE.test(text)) return false;
  return TITLE_HINT_RE.test(text) || (/^[A-Z0-9 &()\-]+$/.test(text) && /[A-Z]{3}/.test(text));
}

function scaleItems(page: PdfLayoutPage): Array<{ item: PdfLayoutTextItem; scale: NormalizedScale }> {
  const out: Array<{ item: PdfLayoutTextItem; scale: NormalizedScale }> = [];
  for (const item of page.text_items) {
    const match = item.text.match(SCALE_RE);
    if (!match) continue;
    const normalized = normalizeScale(match[1]);
    if (normalized) out.push({ item, scale: normalized });
  }
  return out;
}

function viewportKey(pageNumber: number, bbox: BoundingBox, index: number): string {
  const x = Math.round(bbox.x);
  const y = Math.round(bbox.y);
  return `p${pageNumber}-v${index + 1}-${x}-${y}`;
}

export function detectDrawingViewports(page: PdfLayoutPage): DrawingViewport[] {
  const scales = scaleItems(page);
  const titles = page.text_items.filter(likelyTitle);
  const viewports: DrawingViewport[] = [];
  const usedTitles = new Set<PdfLayoutTextItem>();

  for (const { item: scaleItem, scale } of scales) {
    const maxDistance = Math.max(page.width_points, page.height_points) * 0.2;
    const nearest = titles
      .filter((title) => !usedTitles.has(title))
      .map((title) => ({ title, distance: distance(title, scaleItem) }))
      .filter((candidate) => candidate.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)[0];

    const evidence = nearest ? [nearest.title, scaleItem] : [scaleItem];
    const evidenceBox = union(evidence);
    const paddingX = Math.max(24, page.width_points * 0.04);
    const paddingY = Math.max(24, page.height_points * 0.04);
    const bbox: BoundingBox = {
      x: Math.max(0, evidenceBox.x - paddingX),
      y: Math.max(0, evidenceBox.y - paddingY),
      width: Math.min(page.width_points, evidenceBox.width + paddingX * 2),
      height: Math.min(page.height_points, evidenceBox.height + paddingY * 2),
    };
    if (nearest) usedTitles.add(nearest.title);

    viewports.push({
      viewport_key: "",
      page_number: page.page_number,
      title: nearest?.title.text ?? null,
      scale,
      bbox,
      confidence: nearest ? 0.82 : 0.62,
      source: "title_scale_cluster",
      metadata: {
        version: BLUEPRINT_VIEWPORT_VERSION,
        title_item_text: nearest?.title.text ?? null,
        scale_item_text: scaleItem.text,
      },
    });
  }

  // If no local scale was found, retain a reviewable whole-page viewport instead
  // of inventing a scale or geometry. This gives reference extraction a container.
  if (!viewports.length) {
    const title = titles[0]?.text ?? null;
    viewports.push({
      viewport_key: "",
      page_number: page.page_number,
      title,
      scale: null,
      bbox: { x: 0, y: 0, width: page.width_points, height: page.height_points },
      confidence: title ? 0.45 : 0.25,
      source: "page_fallback",
      metadata: {
        version: BLUEPRINT_VIEWPORT_VERSION,
        title_item_text: title,
        scale_item_text: null,
      },
    });
  }

  return viewports.map((viewport, index) => ({
    ...viewport,
    viewport_key: viewportKey(page.page_number, viewport.bbox, index),
  }));
}

function contains(box: BoundingBox, item: PdfLayoutTextItem): boolean {
  const c = center(item);
  return c.x >= box.x && c.x <= box.x + box.width && c.y >= box.y && c.y <= box.y + box.height;
}

function owningViewport(item: PdfLayoutTextItem, viewports: DrawingViewport[]): DrawingViewport | null {
  const candidates = viewports.filter((viewport) => contains(viewport.bbox, item));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.bbox.width * a.bbox.height) - (b.bbox.width * b.bbox.height));
  return candidates[0];
}

export function detectDrawingReferences(page: PdfLayoutPage, viewports = detectDrawingViewports(page)): DrawingReference[] {
  const refs: DrawingReference[] = [];
  const seen = new Set<string>();

  for (const item of page.text_items) {
    const text = item.text.replace(/\s+/g, " ").trim();
    const detail = text.match(DETAIL_REF_RE);
    let targetSheet: string | null = null;
    let detailNumber: string | null = null;
    let type: DrawingReference["reference_type"] = "sheet_reference";
    let confidence = 0.72;

    if (detail) {
      detailNumber = detail[1].toUpperCase();
      targetSheet = detail[2].toUpperCase();
      type = /SECTION/i.test(text) ? "section_callout" : "detail_callout";
      confidence = 0.94;
    } else if (/\bSEE\b/i.test(text)) {
      const sheet = text.match(SHEET_REF_RE);
      if (sheet) {
        targetSheet = sheet[1].toUpperCase();
        type = /SECTION/i.test(text) ? "section_callout" : "sheet_reference";
        confidence = 0.82;
      }
    }

    if (!targetSheet) continue;
    const owner = owningViewport(item, viewports);
    const key = `${page.page_number}|${item.x}|${item.y}|${detailNumber ?? ""}|${targetSheet}`;
    if (seen.has(key)) continue;
    seen.add(key);

    refs.push({
      page_number: page.page_number,
      viewport_key: owner?.viewport_key ?? null,
      raw_text: text,
      detail_number: detailNumber,
      target_sheet_number: targetSheet,
      bbox: bboxForItem(item),
      confidence,
      reference_type: type,
      metadata: { version: BLUEPRINT_REFERENCE_VERSION },
    });
  }

  return refs;
}
