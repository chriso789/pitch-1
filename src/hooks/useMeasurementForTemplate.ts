import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export interface ApprovedMeasurement {
  id: string;
  approved_at: string | null;
  saved_tags: Json | null;
  pipeline_entry_id: string | null;
  measurement_id: string | null;
  approval_notes: string | null;
}

/**
 * Hook to fetch approved measurements for a pipeline entry (lead/job)
 * Returns the most recent approved measurement with its saved_tags
 */
export function useApprovedMeasurement(pipelineEntryId: string | undefined) {
  return useQuery({
    queryKey: ['approved-measurement', pipelineEntryId],
    queryFn: async (): Promise<ApprovedMeasurement | null> => {
      if (!pipelineEntryId) return null;
      
      console.log('[useMeasurementForTemplate] Fetching for pipeline:', pipelineEntryId);
      
      const { data, error } = await supabase
        .from('measurement_approvals')
        .select('id, approved_at, saved_tags, pipeline_entry_id, measurement_id, approval_notes')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('[useMeasurementForTemplate] Error:', error);
        throw error;
      }
      
      console.log('[useMeasurementForTemplate] Found:', data?.id, 'saved_tags:', data?.saved_tags);
      return data;
    },
    enabled: !!pipelineEntryId,
  });
}

/**
 * Hook to fetch all approved measurements for a tenant
 * Useful for showing all available measurements to apply to templates
 */
export function useAllApprovedMeasurements() {
  return useQuery({
    queryKey: ['all-approved-measurements'],
    queryFn: async (): Promise<ApprovedMeasurement[]> => {
      const { data, error } = await supabase
        .from('measurement_approvals')
        .select('id, approved_at, saved_tags, pipeline_entry_id, measurement_id, approval_notes')
        .order('approved_at', { ascending: false });
      
      if (error) {
        console.error('[useAllApprovedMeasurements] Error:', error);
        throw error;
      }
      
      return data || [];
    },
  });
}
