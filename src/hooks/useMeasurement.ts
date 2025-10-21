import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
