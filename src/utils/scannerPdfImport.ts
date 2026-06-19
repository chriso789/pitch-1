// Lazy-loaded PDF import/cleanup using pdfjs-dist with a BUNDLED worker
// (no CDN dependency). If the worker fails to initialize, callers must fall
// back to uploading the original PDF and surface a clear error to the user.

let pdfjsPromise: Promise<any> | null = null;
let lastLoadError: string | null = null;
let workerSource: 'bundled' | 'unavailable' = 'unavailable';

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs: any = await import('pdfjs-dist');
      try {
        // Vite-friendly bundled worker. The `?url` query yields a hashed asset
        // URL emitted into the build output, so it works fully offline and
        // never depends on a third-party CDN.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - Vite-specific import query
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        workerSource = 'bundled';
      } catch (err: any) {
        lastLoadError = err?.message || String(err);
        workerSource = 'unavailable';
        throw err;
      }
      return pdfjs;
    })().catch((err) => {
      // Reset so a later attempt can retry, but remember the error.
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

export interface ImportedPdfPage {
  canvas: HTMLCanvasElement;
  pageNumber: number;
  widthPx: number;
  heightPx: number;
}

export async function renderImportedPdf(
  file: File,
  opts: { targetDpi?: number; maxPages?: number } = {},
): Promise<ImportedPdfPage[]> {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pages: ImportedPdfPage[] = [];
  const maxPages = Math.min(pdf.numPages, opts.maxPages ?? 50);
  const targetDpi = opts.targetDpi ?? 220;
  const scale = targetDpi / 72; // pdf.js base = 72 DPI
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      canvas,
      pageNumber: i,
      widthPx: canvas.width,
      heightPx: canvas.height,
    });
  }
  return pages;
}

export async function isPdfRenderAvailable(): Promise<boolean> {
  try {
    await loadPdfJs();
    return true;
  } catch {
    return false;
  }
}

export interface PdfjsDiagnostics {
  pdfjs_source: 'bundled' | 'unavailable';
  pdfjs_loaded: boolean;
  pdfjs_error?: string;
}

export function getPdfjsDiagnostics(): PdfjsDiagnostics {
  return {
    pdfjs_source: workerSource,
    pdfjs_loaded: workerSource === 'bundled' && !lastLoadError,
    ...(lastLoadError ? { pdfjs_error: lastLoadError } : {}),
  };
}
