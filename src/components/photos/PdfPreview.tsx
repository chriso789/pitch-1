import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - vite worker import
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

interface PdfPreviewProps {
  /** Blob URL or absolute URL to the PDF. */
  url: string;
}

/**
 * Renders every page of a PDF as a canvas inside the current page.
 * Avoids Chrome's built-in PDF plugin, which refuses to load in nested
 * iframes (the Lovable preview and many embedded/sandboxed contexts).
 */
export const PdfPreview = ({ url }: PdfPreviewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const containerWidth = container.clientWidth - 32; // padding
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.max(0.8, containerWidth / baseViewport.width));
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'shadow-md rounded bg-white mx-auto mb-4 max-w-full h-auto';
          const ctx = canvas.getContext('2d')!;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        setLoading(false);
      } catch (e: any) {
        console.error('PDF render failed', e);
        if (!cancelled) {
          setError(e?.message || 'Failed to render PDF');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="w-full h-full overflow-auto p-4 bg-muted/30">
      {loading && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Rendering pages…
        </div>
      )}
      {error && (
        <div className="text-center text-sm text-destructive py-8">{error}</div>
      )}
      <div ref={containerRef} />
    </div>
  );
};

export default PdfPreview;
