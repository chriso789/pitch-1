// Coordinate-preserving PDF extraction for blueprint intelligence.
// Extracts positioned text plus stroked vector linework in normalized top-left
// page coordinates. Existing report parsers remain on pdf-text.ts.

import { getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import * as pdfjs from "npm:pdfjs-dist@3.11.174";

const OPS = (pdfjs as Record<string, unknown>).OPS as Record<string, number> | undefined;

export const PDF_LAYOUT_VERSION = "f1-layout-v2-vector";

export interface PdfLayoutTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation_deg: number;
  font_name: string | null;
}

export interface PdfVectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length_points: number;
  stroke_rgb: [number, number, number] | null;
  line_width: number | null;
  source: "pdf_operator_list";
}

export interface PdfLayoutPage {
  page_number: number;
  width_points: number;
  height_points: number;
  rotation_deg: number;
  text_items: PdfLayoutTextItem[];
  vector_segments: PdfVectorSegment[];
  text: string;
  has_selectable_text: boolean;
  vector_extraction_status: "completed" | "failed";
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

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

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
  const transform = Array.isArray(raw.transform) ? raw.transform.map((v) => finiteNumber(v)) : [1, 0, 0, 1, 0, 0];
  const width = Math.max(0, finiteNumber(raw.width));
  const rawHeight = Math.max(0, finiteNumber(raw.height));
  const inferredHeight = Math.max(Math.abs(transform[3] ?? 0), Math.abs(transform[0] ?? 0));
  const height = rawHeight > 0 ? rawHeight : inferredHeight;
  const x = finiteNumber(transform[4]);
  const pdfY = finiteNumber(transform[5]);
  const y = Math.max(0, pageHeight - pdfY - height);
  return {
    text,
    x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), width: Number(width.toFixed(3)), height: Number(height.toFixed(3)),
    rotation_deg: normalizeRotation(transform), font_name: typeof raw.fontName === "string" ? raw.fontName : null,
  };
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function point(m: Matrix, x: number, y: number, pageHeight: number): [number, number] {
  const px = m[0] * x + m[2] * y + m[4];
  const py = m[1] * x + m[3] * y + m[5];
  return [Number(px.toFixed(3)), Number((pageHeight - py).toFixed(3))];
}

function rgb(args: unknown): [number, number, number] | null {
  if (!Array.isArray(args) || args.length < 3) return null;
  const norm = (v: unknown) => {
    const n = finiteNumber(v);
    return Math.max(0, Math.min(1, n > 1 ? n / 255 : n));
  };
  return [norm(args[0]), norm(args[1]), norm(args[2])];
}

async function extractVectorSegments(page: any, pageHeight: number): Promise<PdfVectorSegment[]> {
  if (!OPS) throw new Error("pdfjs_ops_unavailable");
  const opList = await page.getOperatorList();
  const segments: PdfVectorSegment[] = [];
  let ctm: Matrix = [...IDENTITY];
  const stack: Matrix[] = [];
  let stroke: [number, number, number] | null = null;
  let lineWidth: number | null = null;
  let cur: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  let pending: Array<{ a: [number, number]; b: [number, number] }> = [];

  const add = (a: [number, number], b: [number, number]) => pending.push({ a, b });
  const flush = () => {
    for (const seg of pending) {
      const a = point(ctm, seg.a[0], seg.a[1], pageHeight);
      const b = point(ctm, seg.b[0], seg.b[1], pageHeight);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.75) continue;
      segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], length_points: Number(len.toFixed(3)), stroke_rgb: stroke, line_width: lineWidth, source: "pdf_operator_list" });
    }
    pending = [];
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] ?? [];
    switch (fn) {
      case OPS.save: stack.push([...ctm]); break;
      case OPS.restore: ctm = stack.pop() ?? [...IDENTITY]; break;
      case OPS.transform: {
        if (Array.isArray(args) && args.length >= 6) {
          const m: Matrix = [0,1,2,3,4,5].map((j) => finiteNumber(args[j])) as Matrix;
          ctm = multiply(ctm, m);
        }
        break;
      }
      case OPS.setLineWidth: lineWidth = finiteNumber(args[0], 1); break;
      case OPS.setStrokeRGBColor: stroke = rgb(args); break;
      case OPS.setStrokeGray: {
        const g = Math.max(0, Math.min(1, finiteNumber(args[0]))); stroke = [g, g, g]; break;
      }
      case OPS.moveTo: cur = [finiteNumber(args[0]), finiteNumber(args[1])]; start = [...cur]; break;
      case OPS.lineTo: {
        const next: [number, number] = [finiteNumber(args[0]), finiteNumber(args[1])]; add(cur, next); cur = next; break;
      }
      case OPS.closePath: add(cur, start); cur = [...start]; break;
      case OPS.rectangle: {
        const x = finiteNumber(args[0]), y = finiteNumber(args[1]), w = finiteNumber(args[2]), h = finiteNumber(args[3]);
        const p1: [number, number] = [x,y], p2: [number, number] = [x+w,y], p3: [number, number] = [x+w,y+h], p4: [number, number] = [x,y+h];
        add(p1,p2); add(p2,p3); add(p3,p4); add(p4,p1); cur = p1; start = p1; break;
      }
      case OPS.constructPath: {
        const ops = Array.isArray(args[0]) ? args[0] as number[] : [];
        const coords = Array.isArray(args[1]) ? args[1] as number[] : [];
        let ci = 0;
        for (const sub of ops) {
          if (sub === OPS.moveTo) { cur = [finiteNumber(coords[ci++]), finiteNumber(coords[ci++])]; start = [...cur]; }
          else if (sub === OPS.lineTo) { const next: [number, number] = [finiteNumber(coords[ci++]), finiteNumber(coords[ci++])]; add(cur,next); cur = next; }
          else if (sub === OPS.rectangle) {
            const x=finiteNumber(coords[ci++]), y=finiteNumber(coords[ci++]), w=finiteNumber(coords[ci++]), h=finiteNumber(coords[ci++]);
            const p1:[number,number]=[x,y],p2:[number,number]=[x+w,y],p3:[number,number]=[x+w,y+h],p4:[number,number]=[x,y+h];
            add(p1,p2);add(p2,p3);add(p3,p4);add(p4,p1);cur=p1;start=p1;
          } else if (sub === OPS.closePath) { add(cur,start); cur=[...start]; }
          else if (sub === OPS.curveTo) { ci += 6; cur=[finiteNumber(coords[ci-2]),finiteNumber(coords[ci-1])]; }
          else if (sub === OPS.curveTo2 || sub === OPS.curveTo3) { ci += 4; cur=[finiteNumber(coords[ci-2]),finiteNumber(coords[ci-1])]; }
        }
        break;
      }
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke: flush(); break;
      case OPS.endPath: pending = []; break;
    }
  }
  return segments;
}

export async function extractPdfLayout(bytes: Uint8Array): Promise<PdfLayoutResult> {
  const pdf = await getDocumentProxy(bytes);
  const pages: PdfLayoutPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = Array.isArray(content?.items) ? content.items as PdfJsTextItem[] : [];
    const textItems = items.map((item) => normalizeTextItem(item, viewport.height)).filter((item): item is PdfLayoutTextItem => Boolean(item));
    const text = textItems.map((item) => item.text).join(" ");
    let vectorSegments: PdfVectorSegment[] = [];
    let vectorStatus: "completed" | "failed" = "completed";
    try { vectorSegments = await extractVectorSegments(page, viewport.height); }
    catch { vectorStatus = "failed"; }
    pages.push({
      page_number: pageNumber, width_points: Number(viewport.width.toFixed(3)), height_points: Number(viewport.height.toFixed(3)),
      rotation_deg: finiteNumber(page.rotate), text_items: textItems, vector_segments: vectorSegments, text,
      has_selectable_text: text.replace(/\s+/g, "").length >= 40, vector_extraction_status: vectorStatus,
    });
  }
  return { page_count: pdf.numPages, version: PDF_LAYOUT_VERSION, pages };
}
