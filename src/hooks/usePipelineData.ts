import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useLocation } from '@/contexts/LocationContext';
import { useEffect } from 'react';
import { usePipelineStages, type PipelineStage, DEFAULT_STAGES } from './usePipelineStages';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export interface PipelineEntry {
  id: string;
  clj_formatted_number: string;
  contact_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  location_id?: string;
  lead_name?: string | null;
  estimated_value?: number | null;
  metadata?: Record<string, any> | null;
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

async function fetchPipelineEntries(locationId: string | null, tenantId: string | null): Promise<{ entries: PipelineEntry[]; valueMap: Record<string, number> }> {
  let query = supabase
    .from('pipeline_entries')
    .select(`
      id,
      clj_formatted_number,
      contact_id,
      status,
      created_at,
      updated_at,
      location_id,
      lead_name,
      estimated_value,
      metadata,
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
  
  // CRITICAL: Explicit tenant filter — belt-and-suspenders with RLS
  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }
  
  // Filter by location if a location is selected
  if (locationId) {
    query = query.eq('location_id', locationId);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return { entries: [], valueMap: {} };

  const entries: PipelineEntry[] = data.map(entry => ({
    id: entry.id,
    clj_formatted_number: entry.clj_formatted_number,
    contact_id: entry.contact_id,
    status: entry.status,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    location_id: entry.location_id,
    lead_name: entry.lead_name,
    estimated_value: (entry as any).estimated_value ?? null,
    metadata: (entry as any).metadata ?? null,
    contacts: Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contacts,
    project: entry.projects ? (Array.isArray(entry.projects) ? entry.projects[0] : entry.projects) : undefined
  }));

  // Batch-fetch saved estimate selling prices per pipeline entry
  const entryIds = entries.map(e => e.id).filter(Boolean);
  const grouped = new Map<string, Array<{ id: string; selling_price: number }>>();
  if (entryIds.length > 0) {
    const { data: estimates } = await supabase
      .from('enhanced_estimates')
      .select('id, pipeline_entry_id, selling_price')
      .in('pipeline_entry_id', entryIds);
    (estimates || []).forEach((est: any) => {
      if (!est.pipeline_entry_id) return;
      const list = grouped.get(est.pipeline_entry_id) || [];
      list.push({ id: est.id, selling_price: Number(est.selling_price) || 0 });
      grouped.set(est.pipeline_entry_id, list);
    });
  }

  // Resolve a single value per entry: selected estimate (if >0) → highest non-zero estimate → estimated_value → 0
  const valueMap: Record<string, number> = {};
  entries.forEach(entry => {
    const list = grouped.get(entry.id) || [];
    const meta = entry.metadata as any;
    const selectedId = meta?.selected_estimate_id ?? meta?.enhanced_estimate_id;
    let value = 0;
    if (selectedId) {
      const sel = list.find(e => e.id === selectedId);
      if (sel && sel.selling_price > 0) value = sel.selling_price;
    }
    if (!value) {
      const best = list
        .filter(e => e.selling_price > 0)
        .sort((a, b) => b.selling_price - a.selling_price)[0];
      if (best) value = best.selling_price;
    }
    if (!value && entry.estimated_value && entry.estimated_value > 0) {
      value = Number(entry.estimated_value);
    }
    valueMap[entry.id] = value;
  });

  return { entries, valueMap };
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
  const effectiveTenantId = useEffectiveTenantId();
  
  // Load dynamic stages from database
  const { stages, isLoading: stagesLoading } = usePipelineStages();

  const query = useQuery({
    queryKey: ['pipeline-entries', currentLocationId, effectiveTenantId],
    queryFn: () => fetchPipelineEntries(currentLocationId, effectiveTenantId),
    enabled: !!effectiveTenantId, // Don't fetch until tenant is resolved
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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

  type CacheShape = { entries: PipelineEntry[]; valueMap: Record<string, number> };
  const cacheKey = ['pipeline-entries', currentLocationId, effectiveTenantId];

  // Optimistic update for drag operations
  const updateEntryStatus = (entryId: string, fromStatus: string, toStatus: string) => {
    queryClient.setQueryData<CacheShape>(cacheKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        entries: old.entries.map(entry =>
          entry.id === entryId ? { ...entry, status: toStatus } : entry
        ),
      };
    });
  };

  // Revert optimistic update
  const revertEntryStatus = (entryId: string, originalStatus: string) => {
    queryClient.setQueryData<CacheShape>(cacheKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        entries: old.entries.map(entry =>
          entry.id === entryId ? { ...entry, status: originalStatus } : entry
        ),
      };
    });
  };

  // Remove entry from cache (for delete)
  const removeEntry = (entryId: string) => {
    queryClient.setQueryData<CacheShape>(cacheKey, (old) => {
      if (!old) return old;
      const { [entryId]: _drop, ...remainingValues } = old.valueMap;
      return {
        entries: old.entries.filter(entry => entry.id !== entryId),
        valueMap: remainingValues,
      };
    });
  };

  // Invalidate to refetch fresh data
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-entries'] });
  };

  const entries = query.data?.entries || [];
  const valueMap = query.data?.valueMap || {};
  const groupedData = groupByStatus(entries, stages);

  // Per-stage totals using saved estimate selling_price (with fallback to estimated_value)
  const stageTotals: Record<string, number> = {};
  Object.entries(groupedData).forEach(([stageKey, list]) => {
    stageTotals[stageKey] = (list as PipelineEntry[]).reduce(
      (sum, e) => sum + (valueMap[e.id] || 0),
      0
    );
  });

  const entryValue = (entryId: string) => valueMap[entryId] || 0;

  return {
    entries,
    groupedData,
    stages, // NEW: expose dynamic stages
    stageTotals,
    entryValue,
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
