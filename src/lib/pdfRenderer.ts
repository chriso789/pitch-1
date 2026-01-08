import * as pdfjsLib from "pdfjs-dist";

// Configure the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PDFDocumentProxy {
  numPages: number;
  getPage: (pageNum: number) => Promise<PDFPageProxy>;
  destroy: () => void;
}

export interface PDFPageProxy {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: any }) => { promise: Promise<void> };
}

export interface RenderedPage {
  dataUrl: string;
  width: number;
  height: number;
}

// Cache for rendered pages
const pageCache = new Map<string, RenderedPage>();

/**
 * Load a PDF document from a URL
 */
export async function loadPDF(url: string): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({
    url,
    cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });
  
  const pdf = await loadingTask.promise;
  return pdf as unknown as PDFDocumentProxy;
}

/**
 * Render a specific page of a PDF to a data URL
 */
export async function renderPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number = 1.5
): Promise<RenderedPage> {
  const cacheKey = `${pageNum}-${scale}`;
  
  // Check cache first
  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey)!;
  }

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Create off-screen canvas
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get canvas context");
  }

  // Render PDF page to canvas
  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  // Convert to data URL
  const dataUrl = canvas.toDataURL("image/png");

  const result: RenderedPage = {
    dataUrl,
    width: viewport.width,
    height: viewport.height,
  };

  // Cache the result
  pageCache.set(cacheKey, result);

  return result;
}

/**
 * Clear the page cache
 */
export function clearPageCache(): void {
  pageCache.clear();
}

/**
 * Check if a file is a PDF based on mime type or extension
 */
export function isPDF(mimeType?: string, filename?: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (filename?.toLowerCase().endsWith(".pdf")) return true;
  return false;
}
