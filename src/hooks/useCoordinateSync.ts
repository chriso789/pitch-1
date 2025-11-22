import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Hook for syncing coordinates from contacts.verified_address to pipeline_entries.metadata
 * Used during lead creation to ensure both tables stay in sync
 */
export function useCoordinateSync() {
  
  const syncCoordinatesOnLeadCreation = useCallback(async (
    contactId: string,
    pipelineEntryId: string
  ) => {
    try {
      console.log('🔄 Syncing coordinates after lead creation:', { contactId, pipelineEntryId });

      // Fetch contact's verified address
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('verified_address, latitude, longitude')
        .eq('id', contactId)
        .single();

      if (contactError) throw contactError;

      const verifiedAddress = contact?.verified_address as any;
      if (!verifiedAddress?.lat || !verifiedAddress?.lng) {
        console.log('⚠️ Contact does not have verified address, skipping coordinate sync');
        return { success: false, reason: 'no_verified_address' };
      }

      // Update pipeline entry metadata with verified coordinates
      const { data: pipelineEntry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const metadata = (pipelineEntry?.metadata || {}) as any;

      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...metadata,
            verified_address: {
              ...verifiedAddress,
              geometry: {
                location: {
                  lat: verifiedAddress.lat,
                  lng: verifiedAddress.lng
                }
              }
            },
            coordinate_sync_timestamp: new Date().toISOString(),
            coordinate_sync_source: 'contact_verified_address'
          } as any
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      console.log('✅ Successfully synced coordinates after lead creation');
      return { success: true };

    } catch (error: any) {
      console.error('❌ Failed to sync coordinates:', error);
      toast.error('Failed to sync coordinates');
      return { success: false, error: error.message };
    }
  }, []);

  const syncSinglePipelineEntry = useCallback(async (pipelineEntryId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('sync-verified-coordinates', {
        body: { pipelineEntryId }
      });

      if (error) throw error;

      toast.success('Coordinates synchronized successfully');
      return { success: true, data };

    } catch (error: any) {
      toast.error(`Failed to sync coordinates: ${error.message}`);
      return { success: false, error: error.message };
    }
  }, []);

  return {
    syncCoordinatesOnLeadCreation,
    syncSinglePipelineEntry
  };
}
