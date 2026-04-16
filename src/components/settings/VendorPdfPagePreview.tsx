/**
 * VendorPdfPagePreview - Renders a single page of a vendor PDF (e.g., a Roofr/EagleView
 * diagram page) as a canvas image so it displays inline even when the host serves
 * the PDF with X-Frame-Options: DENY (which blocks <iframe>/<object> previews).
 *
 * Uses pdfjs-dist (already installed) and a CDN worker. Lazy-loaded only when the
 * row is expanded so it doesn't hurt initial table render.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VendorPdfPagePreviewProps {
  url: string;
  /** Initial page to render. Defaults to 1; many vendor reports place the
   *  diagram on page 2 or 3, so the user can step through. */
  initialPage?: number;
  /** Render scale — higher = sharper but slower */
  scale?: number;
  className?: string;
}

export function VendorPdfPagePreview({
  url,
  initialPage = 1,
  scale = 1.5,
  className,
}: VendorPdfPagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<any>(null);

  // Load the document once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Dynamic import keeps pdfjs out of the initial bundle
        const pdfjs = await import("pdfjs-dist");
        // Worker via CDN matched to the installed version
        // @ts-ignore - version is exported at runtime
        const version = pdfjs.version || "3.11.174";
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.js`;

        const loadingTask = pdfjs.getDocument({ url, withCredentials: false });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[VendorPdfPagePreview] load failed", err);
        setError(err?.message || "Failed to load PDF");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (docRef.current?.destroy) docRef.current.destroy();
      docRef.current = null;
    };
  }, [url]);

  // Render the requested page whenever doc or page changes
  useEffect(() => {
    if (!docRef.current || !numPages) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const safePage = Math.min(Math.max(1, page), numPages);
        const pdfPage = await docRef.current.getPage(safePage);
        if (cancelled) return;

        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[VendorPdfPagePreview] render failed", err);
        setError(err?.message || "Failed to render page");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [numPages, page, scale]);

  if (error) {
    return (
      <div className={`flex h-80 w-full items-center justify-center rounded-md border bg-background p-4 text-sm text-muted-foreground ${className || ""}`}>
        Could not render PDF preview.{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="ml-1 text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          Open report
        </a>
      </div>
    );
  }

  return (
    <div className={`relative rounded-md border bg-background ${className || ""}`}>
      <div className="flex h-80 w-full items-center justify-center overflow-auto p-2">
        <canvas
          ref={canvasRef}
          className="max-h-full"
          style={{ display: loading ? "none" : "block" }}
        />
        {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      </div>
      {numPages && numPages > 1 && (
        <div
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-2 py-1 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {page} / {numPages}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={page >= numPages || loading}
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
