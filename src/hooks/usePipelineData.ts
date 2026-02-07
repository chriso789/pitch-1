import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useLocation } from '@/contexts/LocationContext';
import { useEffect } from 'react';
import { usePipelineStages, type PipelineStage, DEFAULT_STAGES } from './usePipelineStages';

export interface PipelineEntry {
  id: string;
  clj_formatted_number: string;
  contact_id: string;
  status: string;
  created_at: string;
  location_id?: string;
  contacts: {
    id: string;
    contact_number: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  };
  project?: {
    id: string;
    project_number: string;
  };
}

// Legacy export for backwards compatibility - now dynamically loaded
export const LEAD_STAGES = DEFAULT_STAGES;

async function fetchPipelineEntries(locationId: string | null): Promise<PipelineEntry[]> {
  let query = supabase
    .from('pipeline_entries')
    .select(`
      id,
      clj_formatted_number,
      contact_id,
      status,
      created_at,
      location_id,
      contacts!inner (
        id,
        contact_number,
        first_name,
        last_name,
        email,
        phone,
        address_street,
        address_city,
        address_state,
        address_zip
      ),
      projects!left (
        id,
        project_number,
        pipeline_entry_id
      )
    `)
    .eq('is_deleted', false);
  
  // Filter by location if a location is selected
  if (locationId) {
    query = query.eq('location_id', locationId);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return data.map(entry => ({
    id: entry.id,
    clj_formatted_number: entry.clj_formatted_number,
    contact_id: entry.contact_id,
    status: entry.status,
    created_at: entry.created_at,
    location_id: entry.location_id,
    contacts: Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contacts,
    project: entry.projects ? (Array.isArray(entry.projects) ? entry.projects[0] : entry.projects) : undefined
  }));
}

function groupByStatus(entries: PipelineEntry[], stages: PipelineStage[]): Record<string, PipelineEntry[]> {
  const grouped: Record<string, PipelineEntry[]> = {};
  stages.forEach(stage => {
    grouped[stage.key] = entries.filter(e => e.status === stage.key);
  });
  // Also include entries with statuses not matching any stage (orphaned)
  const allStageKeys = stages.map(s => s.key);
  const orphanedEntries = entries.filter(e => !allStageKeys.includes(e.status));
  if (orphanedEntries.length > 0) {
    // Add orphaned entries to first stage for visibility
    if (stages.length > 0) {
      grouped[stages[0].key] = [...(grouped[stages[0].key] || []), ...orphanedEntries];
    }
  }
  return grouped;
}

export function usePipelineData() {
  const { profile } = useUserProfile();
  const { currentLocationId } = useLocation();
  const queryClient = useQueryClient();
  
  // Load dynamic stages from database
  const { stages, isLoading: stagesLoading } = usePipelineStages();

  const query = useQuery({
    queryKey: ['pipeline-entries', currentLocationId],
    queryFn: () => fetchPipelineEntries(currentLocationId),
    staleTime: 30 * 1000, // 30 seconds - data is fresh
    gcTime: 5 * 60 * 1000, // 5 minutes in cache
    refetchOnWindowFocus: false,
  });
  
  // Listen for location changes and invalidate cache immediately
  useEffect(() => {
    const handleLocationChange = () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-entries'] });
    };
    
    window.addEventListener('location-changed', handleLocationChange);
    return () => window.removeEventListener('location-changed', handleLocationChange);
  }, [queryClient]);

  const userCanDelete = profile?.role && ['master', 'corporate', 'office_admin'].includes(profile.role);

  // Optimistic update for drag operations
  const updateEntryStatus = (entryId: string, fromStatus: string, toStatus: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries', currentLocationId], (old) => {
      if (!old) return old;
      return old.map(entry => 
        entry.id === entryId ? { ...entry, status: toStatus } : entry
      );
    });
  };

  // Revert optimistic update
  const revertEntryStatus = (entryId: string, originalStatus: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries', currentLocationId], (old) => {
      if (!old) return old;
      return old.map(entry => 
        entry.id === entryId ? { ...entry, status: originalStatus } : entry
      );
    });
  };

  // Remove entry from cache (for delete)
  const removeEntry = (entryId: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries', currentLocationId], (old) => {
      if (!old) return old;
      return old.filter(entry => entry.id !== entryId);
    });
  };

  // Invalidate to refetch fresh data
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-entries'] });
  };

  return {
    entries: query.data || [],
    groupedData: groupByStatus(query.data || [], stages),
    stages, // NEW: expose dynamic stages
    isLoading: query.isLoading || stagesLoading,
    isError: query.isError,
    error: query.error,
    userCanDelete,
    updateEntryStatus,
    revertEntryStatus,
    removeEntry,
    invalidate,
    refetch: query.refetch,
  };
}
