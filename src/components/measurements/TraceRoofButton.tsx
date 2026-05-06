import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Scan, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

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
  roofType?: string;
  components?: {
    ridges?: TraceLine[];
    hips?: TraceLine[];
    valleys?: TraceLine[];
    eaves?: TraceLine[];
    rakes?: TraceLine[];
    step_flashing?: TraceLine[];
  };
  ridges?: TraceLine[];
  hips?: TraceLine[];
  valleys?: TraceLine[];
  eaves?: TraceLine[];
  rakes?: TraceLine[];
  step_flashing?: TraceLine[];
  facets?: { id?: string; name?: string; vertices?: number[][]; estimatedPitch?: string; estimatedAreaSqft?: number; areaSqft?: number; pitch?: string }[];
  confidence?: number;
  notes?: string;
}

function sumLinearFt(lines?: TraceLine[]): number {
  if (!lines?.length) return 0;
  return lines.reduce((sum, l) => sum + (l.lengthEstimateFt || 0), 0);
}

/** Convert pixel-coordinate lines to WKT LINESTRING features for the measurement system */
function traceLinesToWkt(type: string, lines?: TraceLine[]): any[] {
  if (!lines?.length) return [];
  return lines.map((l, i) => ({
    type,
    wkt: `LINESTRING(${l.start[0]} ${l.start[1]}, ${l.end[0]} ${l.end[1]})`,
    length_ft: l.lengthEstimateFt || 0,
    source: 'ai_vision_trace',
  }));
}

/** Convert trace facets to the facets_json format */
function traceFacetsToJson(facets?: TraceResult['facets']): any[] | null {
  if (!facets?.length) return null;
  return facets.map((f, i) => ({
    facet_number: i + 1,
    id: f.id || f.name || `F${i + 1}`,
    polygon_points_px: f.vertices || [],
    area_flat_sqft: f.estimatedAreaSqft || f.areaSqft || 0,
    pitch: f.estimatedPitch || f.pitch || 'unknown',
    source: 'ai_vision_trace',
  }));
}

export function TraceRoofButton({ lat, lng, address, pipelineEntryId, onSuccess }: TraceRoofButtonProps) {
  const [isTracing, setIsTracing] = useState(false);
  const effectiveTenantId = useEffectiveTenantId();

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

      const aiData = data?.data || data;
      const components = aiData?.components || aiData;
      const imageSize = data?.imageSize || 1280;
      const satImageUrl = data?.imageUrl || '';

      // Normalize — components may be nested under .components or flat
      const ridges = components?.ridges || [];
      const hips = components?.hips || [];
      const valleys = components?.valleys || [];
      const eaves = components?.eaves || [];
      const rakes = components?.rakes || [];
      const stepFlashing = components?.step_flashing || [];
      const facets = aiData?.facets || components?.facets || [];

      // Build linear features WKT array
      const linearFeaturesWkt = [
        ...traceLinesToWkt('ridge', ridges),
        ...traceLinesToWkt('hip', hips),
        ...traceLinesToWkt('valley', valleys),
        ...traceLinesToWkt('eave', eaves),
        ...traceLinesToWkt('rake', rakes),
        ...traceLinesToWkt('step', stepFlashing),
      ];

      // Calculate totals
      const totalRidge = sumLinearFt(ridges);
      const totalHip = sumLinearFt(hips);
      const totalValley = sumLinearFt(valleys);
      const totalEave = sumLinearFt(eaves);
      const totalRake = sumLinearFt(rakes);
      const totalStepFlashing = sumLinearFt(stepFlashing);

      // Calculate total area from facets
      const totalAreaFlat = facets.reduce((s: number, f: any) => s + (f.estimatedAreaSqft || f.areaSqft || 0), 0);
      const predominantPitch = facets.length > 0 
        ? (facets[0].estimatedPitch || facets[0].pitch || 'unknown') 
        : 'unknown';

      // Persist as a roof_measurements record
      const measurementInsert: any = {
        tenant_id: effectiveTenantId,
        lead_id: pipelineEntryId,
        source_record_type: 'pipeline_entry',
        source_record_id: pipelineEntryId,
        source_button: 'ai_trace',
        target_lat: lat,
        target_lng: lng,
        gps_coordinates: { lat, lng },
        property_address: address || '',
        detection_method: 'ai_vision_trace',
        measurement_method: 'ai_vision_trace',
        ai_model_version: 'gemini-2.5-pro',
        roof_type: aiData?.roofType || 'unknown',
        predominant_pitch: predominantPitch,
        facet_count: facets.length || 0,
        total_area_flat_sqft: totalAreaFlat || 0,
        total_area_adjusted_sqft: totalAreaFlat || 0, // Will be refined when pitch is applied
        total_squares: totalAreaFlat ? +(totalAreaFlat / 100).toFixed(1) : 0,
        total_ridge_length: totalRidge,
        total_hip_length: totalHip,
        total_valley_length: totalValley,
        total_eave_length: totalEave,
        total_rake_length: totalRake,
        total_step_flashing_length: totalStepFlashing,
        linear_features_wkt: linearFeaturesWkt,
        facets_json: traceFacetsToJson(facets),
        analysis_image_size: { width: imageSize, height: imageSize },
        analysis_zoom: 22,
        satellite_overlay_url: satImageUrl,
        google_maps_image_url: satImageUrl,
        selected_image_source: 'google_static',
        image_source: 'google_static',
        measurement_confidence: (aiData?.confidence || 0) / 100,
        validation_status: 'needs_review',
        requires_manual_review: true,
        ai_detection_data: {
          trace_result: aiData,
          source: 'trace-roof-edge-function',
          image_size: imageSize,
          image_url: satImageUrl,
        },
      };

      const { error: insertError } = await supabase
        .from('roof_measurements')
        .insert(measurementInsert);

      if (insertError) {
        console.error('Failed to persist AI trace measurement:', insertError);
        toast({ title: 'Trace completed but save failed', description: insertError.message, variant: 'destructive' });
        return;
      }

      toast({ title: 'AI Trace Complete', description: `Traced ${facets.length} facets, ${Math.round(totalAreaFlat)} sq ft. Review in measurements.` });
      onSuccess?.();
    } catch (err: any) {
      console.error('Trace error:', err);
      toast({ title: 'Trace failed', description: err.message || 'Could not trace roof', variant: 'destructive' });
    } finally {
      setIsTracing(false);
    }
  };

  return (
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
  );
}
