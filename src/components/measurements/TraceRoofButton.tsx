import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Scan, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TraceRoofButtonProps {
  lat: number;
  lng: number;
  address?: string;
  pipelineEntryId?: string;
  onSuccess?: () => void;
}

interface TraceLine {
  start: [number, number];
  end: [number, number];
  lengthEstimateFt?: number;
}

interface TraceResult {
  ridges: TraceLine[];
  hips: TraceLine[];
  valleys: TraceLine[];
  eaves: TraceLine[];
  rakes: TraceLine[];
  step_flashing: TraceLine[];
  facets?: { name: string; areaSqft: number; pitch: string }[];
}

const LINE_COLORS: Record<string, string> = {
  ridges: '#FF0000',
  hips: '#FF8800',
  valleys: '#00AAFF',
  eaves: '#00FF00',
  rakes: '#FFFF00',
  step_flashing: '#FF00FF',
};

const LINE_LABELS: Record<string, string> = {
  ridges: 'Ridge',
  hips: 'Hip',
  valleys: 'Valley',
  eaves: 'Eave',
  rakes: 'Rake',
  step_flashing: 'Step Flash',
};

export function TraceRoofButton({ lat, lng, address, pipelineEntryId, onSuccess }: TraceRoofButtonProps) {
  const [isTracing, setIsTracing] = useState(false);
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [satImageUrl, setSatImageUrl] = useState('');
  const [imageSize, setImageSize] = useState(1280);

  const handleTrace = async () => {
    if (!lat || !lng) {
      toast({ title: 'Missing coordinates', description: 'Address must be verified first.', variant: 'destructive' });
      return;
    }

    setIsTracing(true);
    try {
      const { data, error } = await supabase.functions.invoke('trace-roof', {
        body: { lat, lng, zoom: 22, mapSize: 512 },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // The edge function returns { data: { roofType, components: {...}, facets, ... }, imageUrl, imageSize }
      // We need the components object which has ridges/hips/valleys/eaves/rakes/step_flashing arrays
      const aiData = data?.data || data;
      const traceData = aiData?.components
        ? { ...aiData.components, facets: aiData.facets }
        : aiData;
      setTraceResult(traceData);
      
      // Use the imageSize from the response (scale=2 means 1280px)
      setImageSize(data?.imageSize || 1280);
      
      // Use the image URL returned by the edge function (has server-side API key)
      const url = data?.imageUrl || `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=22&size=512x512&scale=2&maptype=satellite`;
      setSatImageUrl(url);
      setDialogOpen(true);

      toast({ title: 'Roof traced', description: 'AI vision trace complete. Review the overlay.' });
    } catch (err: any) {
      console.error('Trace error:', err);
      toast({ title: 'Trace failed', description: err.message || 'Could not trace roof', variant: 'destructive' });
    } finally {
      setIsTracing(false);
    }
  };

  const totalByType = (type: string) => {
    const lines = traceResult?.[type as keyof TraceResult] as TraceLine[] | undefined;
    if (!lines?.length) return 0;
    return lines.reduce((sum, l) => sum + (l.lengthEstimateFt || 0), 0);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleTrace}
        disabled={isTracing}
        className="flex items-center gap-2"
      >
        {isTracing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}
        {isTracing ? 'Tracing...' : 'AI Trace'}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>AI Vision Roof Trace</DialogTitle>
          </DialogHeader>

          {traceResult && (
            <div className="space-y-4">
              {/* Overlay canvas */}
              <div className="relative w-full" style={{ maxWidth: 640 }}>
                <img src={satImageUrl} alt="Satellite" className="w-full rounded-lg" crossOrigin="anonymous" />
                <svg
                  viewBox={`0 0 ${imageSize} ${imageSize}`}
                  className="absolute inset-0 w-full h-full"
                  style={{ pointerEvents: 'none' }}
                >
                  {Object.entries(LINE_COLORS).map(([type, color]) => {
                    const lines = traceResult[type as keyof TraceResult] as TraceLine[] | undefined;
                    if (!lines?.length) return null;
                    return lines.map((line, i) => (
                      <line
                        key={`${type}-${i}`}
                        x1={line.start[0]}
                        y1={line.start[1]}
                        x2={line.end[0]}
                        y2={line.end[1]}
                        stroke={color}
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    ));
                  })}
                </svg>
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                {Object.entries(LINE_COLORS).map(([type, color]) => {
                  const total = totalByType(type);
                  if (!total) return null;
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded" style={{ backgroundColor: color }} />
                      <span>{LINE_LABELS[type]}: {Math.round(total)} ft</span>
                    </div>
                  );
                })}
              </div>

              {/* Facets */}
              {traceResult.facets?.length ? (
                <div className="text-sm space-y-1">
                  <p className="font-medium">Facets:</p>
                  {traceResult.facets.map((f, i) => (
                    <p key={i} className="text-muted-foreground">
                      {f.name}: {Math.round(f.areaSqft)} sq ft ({f.pitch})
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
