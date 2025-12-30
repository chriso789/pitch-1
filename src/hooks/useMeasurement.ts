import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Output schema matching AI Measurement Agent spec
export interface MeasurementOutputSchema {
  footprint: [number, number][];
  facets: Array<{
    id: string;
    polygon: [number, number][];
    area: number;
    pitch: number;
    azimuth: number;
    requiresReview?: boolean;
  }>;
  edges: {
    ridges: Array<{ start: [number, number]; end: [number, number] }>;
    hips: Array<{ start: [number, number]; end: [number, number] }>;
    valleys: Array<{ start: [number, number]; end: [number, number] }>;
    eaves: Array<{ start: [number, number]; end: [number, number] }>;
    rakes: Array<{ start: [number, number]; end: [number, number] }>;
  };
  totals: {
    'roof.plan_sqft': number;
    'roof.total_sqft': number;
    'roof.area_by_pitch': Record<string, number>;
    'pitch.predominant': number;
    'lf.ridge': number;
    'lf.hip': number;
    'lf.valley': number;
    'lf.eave': number;
    'lf.rake': number;
  };
  qualityChecks: {
    areaMatch: boolean;
    areaErrorPercent?: number;
    perimeterMatch: boolean;
    perimeterErrorPercent?: number;
    segmentConnectivity: boolean;
    facetsClosed: boolean;
    issues: string[];
    warnings: string[];
  };
  manualReviewRecommended: boolean;
}

interface MeasurementData {
  measurement: any;
  tags: Record<string, any> | null;
}

export function useLatestMeasurement(propertyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['measurement', propertyId],
    queryFn: async () => {
      if (!propertyId) throw new Error('Property ID required');

      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'latest', propertyId }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to fetch measurement');

      return data.data as MeasurementData;
    },
    enabled: enabled && !!propertyId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function usePullMeasurement() {
  return async (propertyId: string, lat: number, lng: number) => {
    const { data, error } = await supabase.functions.invoke('measure', {
      body: { 
        action: 'pull',
        propertyId,
        lat,
        lng
      }
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Failed to pull measurement');

    return data.data as MeasurementData;
  };
}

export function useManualVerification() {
  return async (propertyId: string, measurement: any, tags: Record<string, any>) => {
    const { data, error } = await supabase.functions.invoke('measure', {
      body: { 
        action: 'manual-verify',
        propertyId,
        measurement,
        tags
      }
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Failed to save manual verification');

    return data.data as MeasurementData;
  };
}

/**
 * Generate a full roof overlay using the AI Measurement Agent pipeline
 * This includes DSM refinement, facet splitting, and QA validation
 */
export function useGenerateOverlay() {
  return async (
    propertyId: string, 
    lat: number, 
    lng: number, 
    footprintCoords?: [number, number][]
  ): Promise<MeasurementOutputSchema> => {
    const { data, error } = await supabase.functions.invoke('measure', {
      body: { 
        action: 'generate-overlay',
        propertyId,
        lat,
        lng,
        footprintCoords
      }
    });

    if (error) throw error;
    if (!data?.ok) {
      const err = new Error(data?.error || 'Failed to generate overlay');
      (err as any).manualReviewRecommended = data?.manualReviewRecommended;
      throw err;
    }

    return data.data as MeasurementOutputSchema;
  };
}

/**
 * Hook to query overlay with QA status
 */
export function useOverlayWithQA(propertyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['overlay-qa', propertyId],
    queryFn: async () => {
      if (!propertyId) throw new Error('Property ID required');

      // First get latest measurement
      const { data: measData, error: measError } = await supabase.functions.invoke('measure', {
        body: { action: 'latest', propertyId }
      });

      if (measError) throw measError;
      if (!measData?.ok) throw new Error(measData?.error || 'Failed to fetch measurement');

      const measurement = measData.data?.measurement;
      if (!measurement) return null;

      // Get the stored overlay schema with QA data
      const { data: roofMeas, error: roofError } = await supabase
        .from('roof_measurements')
        .select('overlay_schema, manual_review_recommended, quality_checks, dsm_available')
        .eq('id', measurement.id)
        .single();

      if (roofError) {
        console.warn('Could not fetch roof measurement QA data:', roofError);
        return {
          measurement: measData.data,
          overlaySchema: null,
          manualReviewRecommended: false,
          qualityChecks: null,
          dsmAvailable: false,
        };
      }

      return {
        measurement: measData.data,
        overlaySchema: roofMeas?.overlay_schema as unknown as MeasurementOutputSchema | null,
        manualReviewRecommended: roofMeas?.manual_review_recommended || false,
        qualityChecks: roofMeas?.quality_checks,
        dsmAvailable: roofMeas?.dsm_available || false,
      };
    },
    enabled: enabled && !!propertyId,
    staleTime: 5 * 60 * 1000,
  });
}
