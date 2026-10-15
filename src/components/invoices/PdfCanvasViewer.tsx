import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - vite worker import
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { Loader2 } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

/** Renders every page of a PDF to canvases, so no browser PDF plugin (often blocked) is needed. */
export function PdfCanvasViewer({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '';
    setState('loading');
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        const width = Math.min(host.clientWidth - 32, 1000) || 800;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${vp.width / dpr}px`;
          canvas.style.height = `${vp.height / dpr}px`;
          canvas.className = 'mx-auto mb-4 bg-background shadow';
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          if (i === 1 && !cancelled) setState('ok');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div className="h-full w-full overflow-auto p-4">
      {state === 'loading' && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading invoice…
        </div>
      )}
      {state === 'error' && (
        <div className="py-10 text-center text-sm text-destructive">Could not display this PDF. Use Download instead.</div>
      )}
      <div ref={ref} />
    </div>
  );
}
