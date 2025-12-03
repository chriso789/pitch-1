import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

export interface PipelineEntry {
  id: string;
  clj_formatted_number: string;
  contact_id: string;
  status: string;
  created_at: string;
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

export const LEAD_STAGES = [
  { name: "New Lead", key: "lead", color: "bg-blue-500" },
  { name: "Qualified", key: "qualified", color: "bg-green-500" },
  { name: "Contingency Signed", key: "contingency_signed", color: "bg-yellow-500" },
  { name: "Legal Review", key: "legal_review", color: "bg-purple-500" },
  { name: "Ready for Approval", key: "ready_for_approval", color: "bg-orange-500" },
  { name: "Approved/Project", key: "project", color: "bg-emerald-600" }
] as const;

async function fetchPipelineEntries(): Promise<PipelineEntry[]> {
  const { data, error } = await supabase
    .from('pipeline_entries')
    .select(`
      id,
      clj_formatted_number,
      contact_id,
      status,
      created_at,
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
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return data.map(entry => ({
    id: entry.id,
    clj_formatted_number: entry.clj_formatted_number,
    contact_id: entry.contact_id,
    status: entry.status,
    created_at: entry.created_at,
    contacts: Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contacts,
    project: entry.projects ? (Array.isArray(entry.projects) ? entry.projects[0] : entry.projects) : undefined
  }));
}

function groupByStatus(entries: PipelineEntry[]): Record<string, PipelineEntry[]> {
  const grouped: Record<string, PipelineEntry[]> = {};
  LEAD_STAGES.forEach(stage => {
    grouped[stage.key] = entries.filter(e => e.status === stage.key);
  });
  return grouped;
}

export function usePipelineData() {
  const { profile } = useUserProfile();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pipeline-entries'],
    queryFn: fetchPipelineEntries,
    staleTime: 30 * 1000, // 30 seconds - data is fresh
    gcTime: 5 * 60 * 1000, // 5 minutes in cache
    refetchOnWindowFocus: false,
  });

  const userCanDelete = profile?.role && ['master', 'corporate', 'office_admin'].includes(profile.role);

  // Optimistic update for drag operations
  const updateEntryStatus = (entryId: string, fromStatus: string, toStatus: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries'], (old) => {
      if (!old) return old;
      return old.map(entry => 
        entry.id === entryId ? { ...entry, status: toStatus } : entry
      );
    });
  };

  // Revert optimistic update
  const revertEntryStatus = (entryId: string, originalStatus: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries'], (old) => {
      if (!old) return old;
      return old.map(entry => 
        entry.id === entryId ? { ...entry, status: originalStatus } : entry
      );
    });
  };

  // Remove entry from cache (for delete)
  const removeEntry = (entryId: string) => {
    queryClient.setQueryData<PipelineEntry[]>(['pipeline-entries'], (old) => {
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
    groupedData: groupByStatus(query.data || []),
    isLoading: query.isLoading,
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
