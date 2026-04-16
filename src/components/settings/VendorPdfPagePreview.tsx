/**
 * VendorPdfPagePreview - Renders ONLY the "Length Diagram" page from a vendor PDF
 * (EagleView/Roofr both use this exact page style with labeled edge lengths).
 *
 * Strategy:
 *  1. Load the PDF via pdfjs-dist (works around X-Frame-Options: DENY).
 *  2. Scan each page's text content for the phrase "LENGTH DIAGRAM"
 *     (case-insensitive). Both EagleView and Roofr label this page identically.
 *  3. Render that single page as a canvas. No multi-page navigation UI.
 *  4. If detection fails, fall back to a sensible default (page 4 for EagleView
 *     premium reports — that's where the length diagram historically lives).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface VendorPdfPagePreviewProps {
  url: string;
  /** Override auto-detection if caller already knows the diagram page */
  initialPage?: number;
  /** Render scale — higher = sharper but slower */
  scale?: number;
  className?: string;
}

const DIAGRAM_KEYWORDS = ["length diagram", "lengths diagram"];
const FALLBACK_PAGE = 4;

export function VendorPdfPagePreview({
  url,
  initialPage,
  scale = 1.6,
  className,
}: VendorPdfPagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // @ts-ignore - version is exported at runtime
        const version = pdfjs.version || "3.11.174";
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.js`;

        const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (cancelled) return;
        docRef.current = doc;

        // 1. Determine which page to render
        let targetPage = initialPage ?? 0;
        if (!targetPage) {
          // Scan pages for the "LENGTH DIAGRAM" header
          for (let i = 1; i <= doc.numPages; i++) {
            try {
              const p = await doc.getPage(i);
              const tc = await p.getTextContent();
              const text = tc.items
                .map((it: any) => (typeof it.str === "string" ? it.str : ""))
                .join(" ")
                .toLowerCase();
              if (DIAGRAM_KEYWORDS.some((k) => text.includes(k))) {
                targetPage = i;
                break;
              }
            } catch {
              // Skip page on failure, keep scanning
            }
            if (cancelled) return;
          }
          if (!targetPage) {
            targetPage = Math.min(FALLBACK_PAGE, doc.numPages);
          }
        }
        targetPage = Math.min(Math.max(1, targetPage), doc.numPages);

        // 2. Render that page
        const pdfPage = await doc.getPage(targetPage);
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
        console.error("[VendorPdfPagePreview] failed", err);
        setError(err?.message || "Failed to load diagram");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (docRef.current?.destroy) docRef.current.destroy();
      docRef.current = null;
    };
  }, [url, initialPage, scale]);

  if (error) {
    return (
      <div className={`flex h-80 w-full items-center justify-center rounded-md border bg-background p-4 text-sm text-muted-foreground ${className || ""}`}>
        Could not render diagram preview.{" "}
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
      <div className="flex h-[28rem] w-full items-center justify-center overflow-auto p-2">
        <canvas
          ref={canvasRef}
          className="max-h-full"
          style={{ display: loading ? "none" : "block" }}
        />
        {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
