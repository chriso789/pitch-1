import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scan, RotateCcw, ZoomIn, ZoomOut, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface TraceLine {
  start: [number, number];
  end: [number, number];
  lengthEstimateFt?: number;
}

interface TraceFacet {
  id: string;
  vertices: [number, number][];
  estimatedPitch?: string;
  estimatedAreaSqft?: number;
}

interface TraceResult {
  roofType: string;
  components: {
    ridges: TraceLine[];
    hips: TraceLine[];
    valleys: TraceLine[];
    eaves: TraceLine[];
    rakes: TraceLine[];
    step_flashing?: TraceLine[];
  };
  facets?: TraceFacet[];
  confidence: number;
  notes?: string;
}

interface AITraceOverlayProps {
  lat: number;
  lng: number;
  imageUrl?: string;
  onTraceComplete?: (result: TraceResult) => void;
}

const LINE_COLORS: Record<string, string> = {
  ridges: '#22c55e',     // green
  hips: '#a855f7',       // purple
  valleys: '#ef4444',    // red
  eaves: '#06b6d4',      // cyan
  rakes: '#f97316',      // orange
  step_flashing: '#eab308', // yellow
};

const LINE_LABELS: Record<string, string> = {
  ridges: 'Ridge',
  hips: 'Hip',
  valleys: 'Valley',
  eaves: 'Eave',
  rakes: 'Rake',
  step_flashing: 'Step Flash',
};

export function AITraceOverlay({ lat, lng, imageUrl, onTraceComplete }: AITraceOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [satImageUrl, setSatImageUrl] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showFacets, setShowFacets] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const runTrace = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('trace-roof', {
        body: { lat, lng, imageUrl, zoom: 20 }
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Trace failed');

      setTraceResult(data.data);
      setSatImageUrl(data.imageUrl);
      onTraceComplete?.(data.data);
      
      const totalLines = Object.values(data.data.components).reduce(
        (sum: number, lines: any) => sum + (lines?.length || 0), 0
      );
      toast.success(`Traced ${totalLines} roof components`, {
        description: `${data.data.roofType} roof — ${data.data.confidence}% confidence`
      });
    } catch (err: any) {
      console.error('Trace error:', err);
      toast.error('AI trace failed', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Draw overlay on canvas
  useEffect(() => {
    if (!traceResult || !satImageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      drawCanvas(ctx, img);
    };
    img.src = satImageUrl;
  }, [traceResult, satImageUrl, showOverlay, showFacets, zoom]);

  const drawCanvas = (ctx: CanvasRenderingContext2D, img: HTMLImageElement) => {
    if (!traceResult) return;
    const canvas = ctx.canvas;
    const size = 640;
    canvas.width = size;
    canvas.height = size;

    // Draw satellite image
    ctx.drawImage(img, 0, 0, size, size);

    if (!showOverlay) return;

    // Draw facets if enabled
    if (showFacets && traceResult.facets) {
      traceResult.facets.forEach((facet, i) => {
        if (facet.vertices.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(facet.vertices[0][0], facet.vertices[0][1]);
        facet.vertices.slice(1).forEach(v => ctx.lineTo(v[0], v[1]));
        ctx.closePath();
        const hue = (i * 60) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.15)`;
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.6)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        const cx = facet.vertices.reduce((s, v) => s + v[0], 0) / facet.vertices.length;
        const cy = facet.vertices.reduce((s, v) => s + v[1], 0) / facet.vertices.length;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(facet.id, cx, cy);
        if (facet.estimatedPitch) {
          ctx.font = '10px sans-serif';
          ctx.fillText(facet.estimatedPitch, cx, cy + 13);
        }
      });
    }

    // Draw lines
    Object.entries(traceResult.components).forEach(([type, lines]) => {
      if (!lines || !Array.isArray(lines)) return;
      const color = LINE_COLORS[type] || '#ffffff';

      lines.forEach((line: TraceLine) => {
        ctx.beginPath();
        ctx.moveTo(line.start[0], line.start[1]);
        ctx.lineTo(line.end[0], line.end[1]);
        ctx.strokeStyle = color;
        ctx.lineWidth = type === 'step_flashing' ? 2 : 3;
        if (type === 'step_flashing') {
          ctx.setLineDash([6, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw endpoints
        [line.start, line.end].forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        });

        // Length label
        if (line.lengthEstimateFt) {
          const mx = (line.start[0] + line.end[0]) / 2;
          const my = (line.start[1] + line.end[1]) / 2;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          const text = `${line.lengthEstimateFt.toFixed(0)}'`;
          const tw = ctx.measureText(text).width;
          ctx.fillRect(mx - tw / 2 - 3, my - 8, tw + 6, 14);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(text, mx, my + 3);
        }
      });
    });
  };

  // Component counts
  const getCounts = () => {
    if (!traceResult) return {};
    const counts: Record<string, number> = {};
    Object.entries(traceResult.components).forEach(([type, lines]) => {
      if (lines && Array.isArray(lines) && lines.length > 0) {
        counts[type] = lines.length;
      }
    });
    return counts;
  };

  // Total linear feet per type
  const getTotals = () => {
    if (!traceResult) return {};
    const totals: Record<string, number> = {};
    Object.entries(traceResult.components).forEach(([type, lines]) => {
      if (lines && Array.isArray(lines)) {
        totals[type] = lines.reduce((sum: number, l: TraceLine) => sum + (l.lengthEstimateFt || 0), 0);
      }
    });
    return totals;
  };

  const counts = getCounts();
  const totals = getTotals();

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Scan className="h-5 w-5 text-primary" />
            AI Vision Trace
          </h3>
          <p className="text-xs text-muted-foreground">
            Gemini Pro analyzes satellite imagery to trace roof components
          </p>
        </div>
        <div className="flex items-center gap-2">
          {traceResult && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowFacets(!showFacets)}>
                {showFacets ? 'Hide' : 'Show'} Facets
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowOverlay(!showOverlay)}>
                {showOverlay ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={runTrace}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button onClick={runTrace} disabled={loading} size="sm">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Tracing...
              </>
            ) : traceResult ? (
              <>
                <RotateCcw className="h-4 w-4 mr-1" />
                Re-trace
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-1" />
                Trace Roof
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      {(loading || traceResult) && (
        <div ref={containerRef} className="relative border rounded-lg overflow-hidden bg-muted">
          {loading && !traceResult && (
            <div className="flex items-center justify-center h-[500px]">
              <div className="text-center space-y-3">
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">AI is analyzing satellite imagery...</p>
                <p className="text-xs text-muted-foreground">This takes 10-20 seconds</p>
              </div>
            </div>
          )}
          {traceResult && (
            <div className="flex justify-center" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
              <canvas
                ref={canvasRef}
                width={640}
                height={640}
                className="max-w-full"
              />
            </div>
          )}
          {/* Zoom controls */}
          {traceResult && (
            <div className="absolute bottom-3 right-3 flex gap-1">
              <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.min(z + 0.25, 2))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Results Summary */}
      {traceResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{traceResult.roofType}</Badge>
            <Badge className={traceResult.confidence >= 80 ? 'bg-green-500' : traceResult.confidence >= 60 ? 'bg-yellow-500' : 'bg-red-500'}>
              {traceResult.confidence}% confidence
            </Badge>
            {traceResult.facets && (
              <Badge variant="secondary">{traceResult.facets.length} facets</Badge>
            )}
          </div>

          {/* Legend + measurements */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {Object.entries(counts).map(([type, count]) => (
              <div key={type} className="text-center p-2 rounded bg-muted/50">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: LINE_COLORS[type] }} />
                  <span className="text-[10px] font-medium">{LINE_LABELS[type] || type}</span>
                </div>
                <div className="text-sm font-bold" style={{ color: LINE_COLORS[type] }}>
                  {totals[type]?.toFixed(0) || 0} ft
                </div>
                <div className="text-[10px] text-muted-foreground">{count} lines</div>
              </div>
            ))}
          </div>

          {traceResult.notes && (
            <p className="text-xs text-muted-foreground italic">{traceResult.notes}</p>
          )}
        </div>
      )}
    </Card>
  );
}
