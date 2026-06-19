// Lazy-loaded PDF import/cleanup using pdfjs-dist. If loading fails, callers
// must fall back to uploading the original PDF.

let pdfjsPromise: Promise<any> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs: any = await import('pdfjs-dist');
      try {
        // Use a CDN worker to avoid bundler config issues.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const version = pdfjs.version || '3.11.174';
        pdfjs.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.js`;
      } catch {
        /* noop */
      }
      return pdfjs;
    })();
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
