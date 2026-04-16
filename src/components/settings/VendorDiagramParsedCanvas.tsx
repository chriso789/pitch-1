/**
 * VendorDiagramParsedCanvas
 * -------------------------
 * Parses vector LINE operators directly out of an EagleView/Roofr "Length
 * Diagram" PDF page and renders them on a canvas. This gives us the vendor's
 * ground-truth geometry as actual vector segments (not a screenshot), so we can
 * compare against our AI-generated geometry edge-by-edge.
 *
 * Color → edge-type classification follows EagleView/Roofr conventions:
 *   red    → ridge
 *   blue   → hip
 *   green  → valley
 *   black  → eave / rake (perimeter)
 *   orange → step flashing
 *
 * The parsed segments are surfaced via `onParsed` so the parent can compute
 * length totals and diff them against AI totals.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export interface ParsedSegment {
  type: "ridge" | "hip" | "valley" | "eave" | "rake" | "step" | "unknown";
  /** PDF user-space coordinates */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Raw stroke color [r,g,b] in 0–1 range */
  rgb: [number, number, number];
  /** Length in PDF user units (points). NOT real-world feet. */
  pdfLength: number;
}

export interface ParsedDiagram {
  segments: ParsedSegment[];
  /** Sum of lengths grouped by edge-type, in PDF units */
  lengthsByType: Record<string, number>;
  pageWidth: number;
  pageHeight: number;
}

interface Props {
  url: string;
  width?: number;
  height?: number;
  className?: string;
  onParsed?: (diagram: ParsedDiagram) => void;
}

const DIAGRAM_KEYWORDS = ["length diagram", "lengths diagram"];

const TYPE_COLORS: Record<string, string> = {
  ridge: "#22c55e",
  hip: "#3b82f6",
  valley: "#ef4444",
  eave: "#06b6d4",
  rake: "#d946ef",
  step: "#f59e0b",
  unknown: "#9ca3af",
};

function classifyByColor([r, g, b]: [number, number, number]): ParsedSegment["type"] {
  // Black-ish → perimeter (eave). EagleView draws eaves/rakes in black.
  if (r < 0.2 && g < 0.2 && b < 0.2) return "eave";
  // Pure red → ridge
  if (r > 0.6 && g < 0.4 && b < 0.4) return "ridge";
  // Pure blue → hip
  if (b > 0.6 && r < 0.4 && g < 0.5) return "hip";
  // Green → valley (Roofr convention) — also catch teal/cyan-ish greens
  if (g > 0.5 && r < 0.4) return "valley";
  // Magenta / purple → rake
  if (r > 0.5 && b > 0.5 && g < 0.4) return "rake";
  // Orange / amber → step flashing
  if (r > 0.7 && g > 0.4 && g < 0.7 && b < 0.3) return "step";
  return "unknown";
}

export function VendorDiagramParsedCanvas({
  url,
  width = 420,
  height = 320,
  className,
  onParsed,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ count: number } | null>(null);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStats(null);

    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        const version = pdfjs.version || "3.11.174";
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.js`;

        const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (cancelled) return;

        // 1. Find the actual Length Diagram page (skip TOC).
        let targetPageNum = 0;
        const candidates: { page: number; numericLabels: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const tc = await p.getTextContent();
          const items = tc.items
            .map((it: any) => (typeof it.str === "string" ? it.str : ""))
            .filter(Boolean);
          const text = items.join(" ").toLowerCase();
          if (!DIAGRAM_KEYWORDS.some((k) => text.includes(k))) continue;
          if (
            text.includes("table of contents") ||
            /\.{4,}/.test(text) ||
            /length diagram\s*\.+\s*\d+/.test(text)
          ) {
            continue;
          }
          const numericLabels = items.filter((s: string) => /^\s*\d{1,3}\s*$/.test(s)).length;
          candidates.push({ page: i, numericLabels });
        }
        candidates.sort((a, b) => b.numericLabels - a.numericLabels);
        targetPageNum = candidates[0]?.page || Math.min(4, doc.numPages);
        if (cancelled) return;

        const page = await doc.getPage(targetPageNum);
        const viewport = page.getViewport({ scale: 1 });

        // 2. Walk the operator list to extract LINE segments + stroke colors.
        const opList = await page.getOperatorList();
        const OPS = pdfjs.OPS;

        const segments: ParsedSegment[] = [];
        let curX = 0;
        let curY = 0;
        let strokeRGB: [number, number, number] = [0, 0, 0];
        // Track current path segments awaiting a stroke op.
        let pendingPath: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];
          switch (fn) {
            case OPS.setStrokeRGBColor: {
              // args = [r,g,b] in 0-255 (some pdfjs versions) or 0-1.
              const [r, g, b] = args;
              const norm = (v: number) => (v > 1 ? v / 255 : v);
              strokeRGB = [norm(r), norm(g), norm(b)];
              break;
            }
            case OPS.setStrokeColor:
            case OPS.setStrokeColorN: {
              if (Array.isArray(args) && args.length >= 3) {
                const [r, g, b] = args;
                const norm = (v: number) => (typeof v === "number" ? (v > 1 ? v / 255 : v) : 0);
                strokeRGB = [norm(r), norm(g), norm(b)];
              }
              break;
            }
            case OPS.setStrokeGray: {
              const v = typeof args[0] === "number" ? args[0] : 0;
              strokeRGB = [v, v, v];
              break;
            }
            case OPS.moveTo: {
              curX = args[0];
              curY = args[1];
              break;
            }
            case OPS.lineTo: {
              const x2 = args[0];
              const y2 = args[1];
              pendingPath.push({ x1: curX, y1: curY, x2, y2 });
              curX = x2;
              curY = y2;
              break;
            }
            case OPS.constructPath: {
              // Compound op: args = [opsArray, coordsArray]
              const subOps = args[0] as number[];
              const coords = args[1] as number[];
              let ci = 0;
              for (const subOp of subOps) {
                if (subOp === OPS.moveTo) {
                  curX = coords[ci++];
                  curY = coords[ci++];
                } else if (subOp === OPS.lineTo) {
                  const x2 = coords[ci++];
                  const y2 = coords[ci++];
                  pendingPath.push({ x1: curX, y1: curY, x2, y2 });
                  curX = x2;
                  curY = y2;
                } else if (subOp === OPS.curveTo) {
                  ci += 6; // skip beziers (vendor diagrams are straight lines)
                  curX = coords[ci - 2];
                  curY = coords[ci - 1];
                } else if (subOp === OPS.curveTo2 || subOp === OPS.curveTo3) {
                  ci += 4;
                  curX = coords[ci - 2];
                  curY = coords[ci - 1];
                } else if (subOp === OPS.rectangle) {
                  ci += 4;
                } else if (subOp === OPS.closePath) {
                  // ignore
                }
              }
              break;
            }
            case OPS.stroke:
            case OPS.closeStroke:
            case OPS.fillStroke:
            case OPS.eoFillStroke:
            case OPS.closeFillStroke:
            case OPS.closeEOFillStroke: {
              for (const seg of pendingPath) {
                const dx = seg.x2 - seg.x1;
                const dy = seg.y2 - seg.y1;
                const pdfLength = Math.sqrt(dx * dx + dy * dy);
                // Filter: skip tiny ticks (label leaders, arrowheads) under 4 pts.
                if (pdfLength < 4) continue;
                const type = classifyByColor(strokeRGB);
                segments.push({
                  type,
                  x1: seg.x1,
                  y1: seg.y1,
                  x2: seg.x2,
                  y2: seg.y2,
                  rgb: [...strokeRGB] as [number, number, number],
                  pdfLength,
                });
              }
              pendingPath = [];
              break;
            }
            case OPS.endPath: {
              pendingPath = [];
              break;
            }
          }
        }

        if (cancelled) return;

        // 3. Compute bounding box of parsed segments and render to canvas.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);

        if (segments.length === 0) {
          setError("No vector lines found on diagram page (PDF may be scanned/raster).");
          setLoading(false);
          return;
        }

        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const s of segments) {
          minX = Math.min(minX, s.x1, s.x2);
          minY = Math.min(minY, s.y1, s.y2);
          maxX = Math.max(maxX, s.x1, s.x2);
          maxY = Math.max(maxY, s.y1, s.y2);
        }
        const bboxW = maxX - minX || 1;
        const bboxH = maxY - minY || 1;
        const padding = 16;
        const scale = Math.min(
          (width - padding * 2) / bboxW,
          (height - padding * 2) / bboxH,
        );
        const offX = (width - bboxW * scale) / 2;
        const offY = (height - bboxH * scale) / 2;

        // Background
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, width, height);

        // Draw segments with classified colors (PDF Y is up → flip).
        for (const s of segments) {
          ctx.strokeStyle = TYPE_COLORS[s.type] || TYPE_COLORS.unknown;
          ctx.lineWidth = s.type === "ridge" || s.type === "hip" ? 2.5 : 2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(offX + (s.x1 - minX) * scale, height - (offY + (s.y1 - minY) * scale));
          ctx.lineTo(offX + (s.x2 - minX) * scale, height - (offY + (s.y2 - minY) * scale));
          ctx.stroke();
        }

        // Length totals by type (in PDF units — used only for proportional comparison)
        const lengthsByType: Record<string, number> = {};
        for (const s of segments) {
          lengthsByType[s.type] = (lengthsByType[s.type] || 0) + s.pdfLength;
        }

        setStats({ count: segments.length });
        setLoading(false);
        onParsedRef.current?.({
          segments,
          lengthsByType,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error("[VendorDiagramParsedCanvas] failed", err);
        setError(err?.message || "Failed to parse diagram");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, width, height]);

  return (
    <div className={`relative rounded-md border bg-background ${className || ""}`} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width, height, display: loading || error ? "none" : "block" }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}
      {!loading && !error && stats && (
        <div className="pointer-events-none absolute bottom-1 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {stats.count} segments parsed
        </div>
      )}
    </div>
  );
}
