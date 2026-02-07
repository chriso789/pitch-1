// Use v3.x which doesn't have top-level await issues
import * as pdfjsLib from "pdfjs-dist";

// Configure the worker - use multiple CDN fallbacks for reliability
const workerUrls = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
];

// Try the first CDN by default
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];

// Track worker loading state
let workerVerified = false;
let workerLoadingPromise: Promise<void> | null = null;
let shouldDisableWorker = false;

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
 * Ensure PDF.js worker is loaded and accessible
 * Tries multiple CDN sources with fallback to no-worker mode
 */
export async function ensureWorkerLoaded(): Promise<void> {
  if (workerVerified) return;
  
  // Prevent multiple concurrent attempts
  if (workerLoadingPromise) {
    return workerLoadingPromise;
  }
  
  workerLoadingPromise = (async () => {
    for (const url of workerUrls) {
      try {
        console.log('[PDF] Trying worker from:', url);
        const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
        if (response.ok) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = url;
          shouldDisableWorker = false;
          workerVerified = true;
          console.log('[PDF] ✅ Worker verified from:', url);
          return;
        }
      } catch (e) {
        console.warn('[PDF] Worker failed from:', url, e);
      }
    }
    
    // Fallback: disable worker entirely (slower but works without CORS issues)
    console.warn('[PDF] ⚠️ Running without worker (fallback mode - may be slower)');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    shouldDisableWorker = true;
    workerVerified = true;
  })();
  
  return workerLoadingPromise;
}

/**
 * Load a PDF document from a URL
 */
export async function loadPDF(url: string): Promise<PDFDocumentProxy> {
  await ensureWorkerLoaded();
  
  // Note: disableWorker is a valid runtime option but may not be in types
  const loadingTask = pdfjsLib.getDocument({
    url,
    cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/`,
    cMapPacked: true,
    ...(shouldDisableWorker ? { disableWorker: true } : {}),
  } as any);
  
  const pdf = await loadingTask.promise;
  return pdf as unknown as PDFDocumentProxy;
}

/**
 * Load a PDF document from an ArrayBuffer (bypasses CORS issues)
 */
export async function loadPDFFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<PDFDocumentProxy> {
  await ensureWorkerLoaded();
  
  console.log('[PDF] Loading from ArrayBuffer, size:', arrayBuffer.byteLength, 'disableWorker:', shouldDisableWorker);
  
  // Note: disableWorker is a valid runtime option but may not be in types
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/`,
    cMapPacked: true,
    ...(shouldDisableWorker ? { disableWorker: true } : {}),
  } as any);
  
  const pdf = await loadingTask.promise;
  console.log('[PDF] ✅ PDF loaded, pages:', (pdf as any).numPages);
  return pdf as unknown as PDFDocumentProxy;
}

/**
 * Render a specific page of a PDF to a data URL
 */
/**
 * Render a specific page of a PDF to a data URL
 * @param pdf - PDF document proxy
 * @param pageNum - Page number to render (1-indexed)
 * @param scale - Render scale (default 1.5 for attachments)
 * @param pdfId - Optional ID for cache isolation
 * @param useJpeg - Use JPEG format for smaller file size (default true for attachments)
 * @param quality - JPEG quality 0-1 (default 0.85)
 */
export async function renderPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number = 1.5,
  pdfId?: string,
  useJpeg: boolean = true,
  quality: number = 0.85
): Promise<RenderedPage> {
  // Use pdfId if provided, otherwise skip cache for safety
  const cacheKey = pdfId ? `${pdfId}-${pageNum}-${scale}-${useJpeg ? 'jpg' : 'png'}` : null;
  
  // Check cache first (only if we have a valid cache key)
  if (cacheKey && pageCache.has(cacheKey)) {
    console.log('[PDF] Page', pageNum, 'served from cache');
    return pageCache.get(cacheKey)!;
  }

  console.log('[PDF] Rendering page', pageNum, 'at scale', scale, useJpeg ? 'JPEG' : 'PNG', pdfId ? `for ${pdfId}` : '');
  
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

  // Convert to data URL - use JPEG for smaller files (attachments are image-heavy)
  const dataUrl = useJpeg 
    ? canvas.toDataURL("image/jpeg", quality)
    : canvas.toDataURL("image/png");

  const result: RenderedPage = {
    dataUrl,
    width: viewport.width,
    height: viewport.height,
  };

  // Cache the result only if we have a valid cache key
  if (cacheKey) {
    pageCache.set(cacheKey, result);
  }
  
  console.log('[PDF] ✅ Page', pageNum, 'rendered successfully:', result.width, 'x', result.height);

  return result;
}

/**
 * Clear the page cache
 */
export function clearPageCache(): void {
  pageCache.clear();
  console.log('[PDF] Page cache cleared');
}

/**
 * Check if a file is a PDF based on mime type or extension
 */
export function isPDF(mimeType?: string, filename?: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (filename?.toLowerCase().endsWith(".pdf")) return true;
  return false;
}
