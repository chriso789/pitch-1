import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { 
  ArrowLeft, MapPin, Save, CheckCircle, PlayCircle, 
  Pencil, BarChart2, FileText, Trash2, AlertCircle, Loader2, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { TrainingSession } from './RoofTrainingLab';
import { TrainingCanvas } from './TrainingCanvas';
import { TrainingComparisonView } from './TrainingComparisonView';
import { toast } from 'sonner';

interface TrainingSessionDetailProps {
  session: TrainingSession;
  onBack: () => void;
  onUpdate: () => void;
}

interface TrainingTrace {
  id: string;
  session_id: string;
  trace_type: string;
  wkt_geometry: string;
  length_ft: number;
  canvas_points: { x: number; y: number }[];
  trace_order: number;
  notes?: string;
  created_at: string;
}

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In Progress', color: 'bg-blue-500 text-white' },
  completed: { label: 'Completed', color: 'bg-green-500 text-white' },
  reviewed: { label: 'Reviewed', color: 'bg-purple-500 text-white' },
};

export function TrainingSessionDetail({ session, onBack, onUpdate }: TrainingSessionDetailProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'trace' | 'compare' | 'notes'>('trace');
  const [notes, setNotes] = useState(session.description || '');
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(session.satellite_image_url || null);
  const [isLoadingSatellite, setIsLoadingSatellite] = useState(false);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);

  // Fetch satellite image via google-maps-proxy edge function
  useEffect(() => {
    async function fetchSatelliteImage() {
      // Skip if we already have a URL or no coordinates
      if (satelliteUrl || !session.lat || !session.lng) return;

      setIsLoadingSatellite(true);
      setSatelliteError(null);

      try {
        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'satellite',
            params: {
              center: `${session.lat},${session.lng}`,
              zoom: '20',
              size: '640x640',
              scale: '2',
              maptype: 'satellite',
            },
          },
        });

        if (error) throw error;

        if (data?.image_url) {
          setSatelliteUrl(data.image_url);
          // Persist to session so we don't have to fetch again
          await supabase
            .from('roof_training_sessions')
            .update({ satellite_image_url: data.image_url })
            .eq('id', session.id);
        } else if (data?.image) {
          // Base64 fallback
          setSatelliteUrl(`data:image/png;base64,${data.image}`);
        } else {
          throw new Error('No image returned from proxy');
        }
      } catch (err: any) {
        console.error('Failed to fetch satellite image:', err);
        setSatelliteError(err.message || 'Failed to load satellite image');
      } finally {
        setIsLoadingSatellite(false);
      }
    }

    fetchSatelliteImage();
  }, [session.id, session.lat, session.lng, satelliteUrl]);

  const handleRetrySatellite = () => {
    setSatelliteUrl(null);
    setSatelliteError(null);
  };

  // Fetch traces for this session
  const { data: traces = [], refetch: refetchTraces } = useQuery({
    queryKey: ['training-traces', session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_training_traces')
        .select('*')
        .eq('session_id', session.id)
        .order('trace_order', { ascending: true });
      
      if (error) throw error;
      return data as TrainingTrace[];
    },
  });

  // Update session mutation
  const updateSession = useMutation({
    mutationFn: async (updates: Partial<TrainingSession>) => {
      const { error } = await supabase
        .from('roof_training_sessions')
        .update(updates)
        .eq('id', session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      onUpdate();
      toast.success('Session updated');
    },
    onError: () => {
      toast.error('Failed to update session');
    },
  });

  // Save trace mutation
  const saveTrace = useMutation({
    mutationFn: async (trace: {
      trace_type: string;
      wkt_geometry: string;
      length_ft: number;
      canvas_points: { x: number; y: number }[];
    }) => {
      const { error } = await supabase
        .from('roof_training_traces')
        .insert({
          session_id: session.id,
          ...trace,
          trace_order: traces.length,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      refetchTraces();
    },
  });

  // Delete trace mutation
  const deleteTrace = useMutation({
    mutationFn: async (traceId: string) => {
      const { error } = await supabase
        .from('roof_training_traces')
        .delete()
        .eq('id', traceId);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchTraces();
      toast.success('Trace deleted');
    },
  });

  // Clear all traces mutation
  const clearAllTraces = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('roof_training_traces')
        .delete()
        .eq('session_id', session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchTraces();
      toast.success('All traces cleared');
    },
  });

  const handleSaveTraces = useCallback(async (
    linearFeatures: { type: string; wkt: string; length_ft: number; points?: { x: number; y: number }[] }[]
  ) => {
    // Clear existing and save new
    await clearAllTraces.mutateAsync();
    
    for (const feature of linearFeatures) {
      await saveTrace.mutateAsync({
        trace_type: feature.type,
        wkt_geometry: feature.wkt,
        length_ft: feature.length_ft,
        canvas_points: feature.points || [],
      });
    }

    // Update session status
    if (session.status === 'draft') {
      await updateSession.mutateAsync({ status: 'in_progress' });
    }

    toast.success('Traces saved successfully');
  }, [session.status, clearAllTraces, saveTrace, updateSession]);

  const handleCompleteSession = async () => {
    // Save traced totals for ML training comparison
    const tracedTotalsData = {
      ridge: traceTotals.ridge,
      hip: traceTotals.hip,
      valley: traceTotals.valley,
      eave: traceTotals.eave,
      rake: traceTotals.rake,
    };

    // Use raw update to avoid type issues with new columns
    const { error } = await supabase
      .from('roof_training_sessions')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString(),
        description: notes,
        traced_totals: tracedTotalsData,
      } as any)
      .eq('id', session.id);
    
    if (error) {
      toast.error('Failed to complete session');
      return;
    }
    
    onUpdate();
    toast.success('Session completed! Traced data saved for AI training.');
  };

  const handleSaveNotes = async () => {
    await updateSession.mutateAsync({ description: notes });
  };

  // Calculate totals from traces
  const traceTotals = traces.reduce((acc, trace) => {
    const type = trace.trace_type as keyof typeof acc;
    if (acc[type] !== undefined) {
      acc[type] += trace.length_ft;
    }
    return acc;
  }, {
    ridge: 0,
    hip: 0,
    valley: 0,
    eave: 0,
    rake: 0,
    perimeter: 0,
  });

  const status = statusConfig[session.status];
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{session.name}</h1>
              <Badge className={status.color}>{status.label}</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span>{session.property_address || 'No address'}</span>
              <span>•</span>
              <span>Created {format(new Date(session.created_at), 'MMM d, yyyy')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.status !== 'completed' && session.status !== 'reviewed' && traces.length > 0 && (
            <Button onClick={handleCompleteSession} variant="default">
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Complete
            </Button>
          )}
        </div>
      </div>

      {/* Trace Summary */}
      {traces.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Traced:</span>
              {traceTotals.ridge > 0 && (
                <Badge variant="outline" className="border-green-500 text-green-500">
                  Ridge: {Math.round(traceTotals.ridge)} ft
                </Badge>
              )}
              {traceTotals.hip > 0 && (
                <Badge variant="outline" className="border-purple-500 text-purple-500">
                  Hip: {Math.round(traceTotals.hip)} ft
                </Badge>
              )}
              {traceTotals.valley > 0 && (
                <Badge variant="outline" className="border-red-500 text-red-500">
                  Valley: {Math.round(traceTotals.valley)} ft
                </Badge>
              )}
              {traceTotals.eave > 0 && (
                <Badge variant="outline" className="border-teal-500 text-teal-500">
                  Eave: {Math.round(traceTotals.eave)} ft
                </Badge>
              )}
              {traceTotals.rake > 0 && (
                <Badge variant="outline" className="border-cyan-500 text-cyan-500">
                  Rake: {Math.round(traceTotals.rake)} ft
                </Badge>
              )}
              {traceTotals.perimeter > 0 && (
                <Badge variant="outline" className="border-orange-500 text-orange-500">
                  Perimeter: {Math.round(traceTotals.perimeter)} ft
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="trace" className="gap-2">
            <Pencil className="h-4 w-4" />
            Trace Roof
          </TabsTrigger>
          <TabsTrigger value="compare" className="gap-2">
            <BarChart2 className="h-4 w-4" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <FileText className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trace" className="mt-4">
          {isLoadingSatellite ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                <p className="text-lg font-medium mb-2">Loading Satellite Imagery</p>
                <p className="text-muted-foreground text-center max-w-md">
                  Fetching high-resolution satellite image for this property...
                </p>
              </CardContent>
            </Card>
          ) : satelliteError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-destructive mb-4" />
                <p className="text-lg font-medium mb-2">Failed to Load Satellite Image</p>
                <p className="text-muted-foreground text-center max-w-md mb-4">
                  {satelliteError}
                </p>
                <Button onClick={handleRetrySatellite} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : satelliteUrl && session.lat && session.lng ? (
            <TrainingCanvas
              satelliteImageUrl={satelliteUrl}
              centerLat={session.lat}
              centerLng={session.lng}
              existingTraces={traces}
              onSave={handleSaveTraces}
            />
          ) : !session.lat || !session.lng ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No Location Data</p>
                <p className="text-muted-foreground text-center max-w-md">
                  This session doesn't have valid coordinates. Please select a lead with a verified address.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <TrainingComparisonView
            sessionId={session.id}
            aiMeasurementId={session.ai_measurement_id}
            manualTotals={traceTotals}
          />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Session Notes</CardTitle>
              <CardDescription>
                Document observations, corrections, and learnings from this training session
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Add notes about this training session..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
              />
              <div className="flex justify-end">
                <Button onClick={handleSaveNotes}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Notes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
