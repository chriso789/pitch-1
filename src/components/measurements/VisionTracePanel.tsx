import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wand2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Segment = {
  type: 'eave' | 'rake' | 'ridge' | 'hip' | 'valley';
  points: Array<[number, number]>;
  confidence?: number;
};

type TraceResponse = {
  image: { url: string; width: number; height: number; zoom: number; source: string };
  segments: Segment[];
  count: number;
  raw?: string;
  model?: string;
  durationMs?: number;
};

export function normalizeVisionTraceImageSize(imageSize?: { width?: number; height?: number; rasterWidth?: number; rasterHeight?: number; rasterScale?: number } | null) {
  if (!imageSize) return undefined;
  const rasterScale = Number(imageSize.rasterScale || 1);
  const width = Number(imageSize.rasterWidth || (rasterScale > 1 ? Number(imageSize.width) * rasterScale : imageSize.width));
  const height = Number(imageSize.rasterHeight || (rasterScale > 1 ? Number(imageSize.height) * rasterScale : imageSize.height));
  return {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    logicalWidth: Number(imageSize.width) || undefined,
    logicalHeight: Number(imageSize.height) || undefined,
    rasterScale: Number.isFinite(rasterScale) && rasterScale > 0 ? rasterScale : undefined,
  };
}

const COLORS: Record<Segment['type'], string> = {
  eave: '#22c55e',    // green
  rake: '#84cc16',    // lime
  ridge: '#ef4444',   // red
  hip: '#eab308',     // yellow
  valley: '#06b6d4',  // cyan
};

const LABELS: Record<Segment['type'], string> = {
  eave: 'Eaves',
  rake: 'Rakes',
  ridge: 'Ridges',
  hip: 'Hips',
  valley: 'Valleys',
};

interface VisionTracePanelProps {
  lat: number;
  lng: number;
  address?: string;
  zoom?: number;
  initialImageUrl?: string;
  imageSize?: { width?: number; height?: number; rasterWidth?: number; rasterHeight?: number; rasterScale?: number } | null;
  autoRun?: boolean;
}

export function VisionTracePanel({ lat, lng, address, zoom = 20, initialImageUrl, imageSize, autoRun = false }: VisionTracePanelProps) {
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const autoRunKeyRef = useRef<string | null>(null);
  const [visible, setVisible] = useState<Record<Segment['type'], boolean>>({
    eave: true, rake: true, ridge: true, hip: true, valley: true,
  });
  const { toast } = useToast();

  const runTrace = useCallback(async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast({ title: 'No coordinates', description: 'Confirm an address first.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const normalizedImageSize = normalizeVisionTraceImageSize(imageSize);
      const { data, error } = await supabase.functions.invoke('vision-trace-roof', {
        body: {
          lat,
          lng,
          zoom,
          size: 640,
          image_url: initialImageUrl,
          image_size: normalizedImageSize,
          address,
          prefer_roof_center: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setTrace(data as TraceResponse);
    } catch (e: any) {
      toast({ title: 'Vision trace failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [imageSize, initialImageUrl, lat, lng, toast, zoom]);

  useEffect(() => {
    if (!autoRun || loading || trace || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `${lat.toFixed(7)}:${lng.toFixed(7)}:${zoom}:${initialImageUrl || 'static'}:${imageSize?.width || 'auto'}x${imageSize?.height || 'auto'}`;
    if (autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;
    void runTrace();
  }, [autoRun, imageSize?.height, imageSize?.width, initialImageUrl, lat, lng, loading, runTrace, trace, zoom]);

  const counts = (trace?.segments || []).reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4" />
          Quick roof trace
        </div>
        <div className="flex items-center gap-2">
          {trace && (
            <Badge variant="outline" className="text-[10px]">
              {trace.count} segments · {trace.durationMs}ms
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={runTrace} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
            {trace ? 'Retrace' : loading ? 'Tracing…' : 'Run quick trace'}
          </Button>
        </div>
      </div>

      {!trace && !loading && (
        <div className="p-6 text-center text-xs text-muted-foreground">
          The roof trace will draw here automatically from the aerial. Pixel-space only — confirm the shape first, then verify measurements.
        </div>
      )}

      {loading && (
        <div className="p-8 flex items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Tracing roof from aerial…
        </div>
      )}

      {trace && (
        <>
          <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-muted/20">
            {(Object.keys(COLORS) as Segment['type'][]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVisible((v) => ({ ...v, [t]: !v[t] }))}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition',
                  visible[t] ? 'bg-background' : 'bg-muted/40 opacity-50',
                )}
              >
                {visible[t] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                <span
                  className="inline-block w-3 h-1 rounded-sm"
                  style={{ backgroundColor: COLORS[t] }}
                />
                {LABELS[t]}
                <span className="text-muted-foreground">({counts[t] || 0})</span>
              </button>
            ))}
          </div>

          <div className="relative bg-black">
            <svg
              viewBox={`0 0 ${trace.image.width} ${trace.image.height}`}
              className="w-full h-auto block"
              preserveAspectRatio="xMidYMid meet"
            >
              <image
                href={trace.image.url}
                x={0}
                y={0}
                width={trace.image.width}
                height={trace.image.height}
              />
              {trace.segments.map((s, i) => {
                if (!visible[s.type]) return null;
                const d = s.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
                return (
                  <path
                    key={i}
                    d={d}
                    stroke={COLORS[s.type]}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={0.95}
                  />
                );
              })}
            </svg>
          </div>

          <div className="px-3 py-2 text-[11px] text-muted-foreground border-t bg-muted/20">
            Model: <code>{trace.model}</code> · zoom {trace.image.zoom} · {trace.image.width}×{trace.image.height}px.
            Colors: <span style={{ color: COLORS.eave }}>eave</span> · <span style={{ color: COLORS.rake }}>rake</span> ·{' '}
            <span style={{ color: COLORS.ridge }}>ridge</span> · <span style={{ color: COLORS.hip }}>hip</span> ·{' '}
            <span style={{ color: COLORS.valley }}>valley</span>. Coordinates are image pixels, not measurements.
          </div>
        </>
      )}
    </div>
  );
}
