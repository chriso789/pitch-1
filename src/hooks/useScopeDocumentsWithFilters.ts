import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from 'sonner';

export interface ScopeDocumentWithHeader {
  id: string;
  file_name: string;
  document_type: string | null;
  carrier_normalized: string | null;
  parse_status: string | null;
  parse_error: string | null;
  created_at: string;
  updated_at: string | null;
  source_document_id: string | null;
  header: {
    property_state: string | null;
    property_city: string | null;
    total_rcv: number | null;
    total_acv: number | null;
  } | null;
}

export interface ScopeDocumentFilters {
  carrier?: string;
  state?: string;
  status?: string;
  documentType?: string;
  search?: string;
}

export function useScopeDocumentsWithFilters(filters: ScopeDocumentFilters = {}) {
  const currentTenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['scope-documents-filtered', currentTenantId, filters],
    queryFn: async (): Promise<ScopeDocumentWithHeader[]> => {
      if (!currentTenantId) return [];

      let query = supabase
        .from('insurance_scope_documents')
        .select(`
          id,
          file_name,
          document_type,
          carrier_normalized,
          parse_status,
          parse_error,
          created_at,
          updated_at,
          source_document_id,
          header:insurance_scope_headers(
            property_state,
            property_city,
            total_rcv,
            total_acv
          )
        `)
        .eq('tenant_id', currentTenantId)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters.carrier && filters.carrier !== 'all') {
        if (filters.carrier === 'unknown') {
          query = query.is('carrier_normalized', null);
        } else {
          query = query.eq('carrier_normalized', filters.carrier);
        }
      }

      if (filters.status && filters.status !== 'all') {
        query = query.eq('parse_status', filters.status);
      }

      if (filters.documentType && filters.documentType !== 'all') {
        query = query.eq('document_type', filters.documentType);
      }

      if (filters.search) {
        query = query.ilike('file_name', `%${filters.search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform the data to flatten the header array to single object
      const transformed = (data || []).map(doc => ({
        ...doc,
        header: Array.isArray(doc.header) && doc.header.length > 0 
          ? doc.header[0] 
          : null
      })) as ScopeDocumentWithHeader[];

      // Filter by state if specified (must be done client-side due to nested relation)
      if (filters.state && filters.state !== 'all') {
        return transformed.filter(doc => 
          doc.header?.property_state === filters.state
        );
      }

      return transformed;
    },
    enabled: !!currentTenantId,
  });
}

// Get unique carriers from documents
export function useUniqueCarriers() {
  const currentTenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['scope-carriers', currentTenantId],
    queryFn: async () => {
      if (!currentTenantId) return [];

      const { data, error } = await supabase
        .from('insurance_scope_documents')
        .select('carrier_normalized')
        .eq('tenant_id', currentTenantId)
        .not('carrier_normalized', 'is', null);

      if (error) throw error;

      const carriers = [...new Set((data || []).map(d => d.carrier_normalized))].filter(Boolean);
      return carriers as string[];
    },
    enabled: !!currentTenantId,
  });
}

// Get unique states from headers
export function useUniqueStates() {
  const currentTenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['scope-states', currentTenantId],
    queryFn: async () => {
      if (!currentTenantId) return [];

      const { data, error } = await supabase
        .from('insurance_scope_headers')
        .select('property_state, document_id!inner(tenant_id)')
        .eq('document_id.tenant_id', currentTenantId)
        .not('property_state', 'is', null);

      if (error) {
        // If the join fails, try a simpler approach
        const { data: docs } = await supabase
          .from('insurance_scope_documents')
          .select('id')
          .eq('tenant_id', currentTenantId);
        
        if (!docs) return [];
        
        const docIds = docs.map(d => d.id);
        const { data: headers } = await supabase
          .from('insurance_scope_headers')
          .select('property_state')
          .in('document_id', docIds)
          .not('property_state', 'is', null);
        
        const states = [...new Set((headers || []).map(h => h.property_state))].filter(Boolean);
        return states as string[];
      }

      const states = [...new Set((data || []).map(d => d.property_state))].filter(Boolean);
      return states as string[];
    },
    enabled: !!currentTenantId,
  });
}

// Reprocess a stuck document
export function useReprocessDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      // First, reset the parse status to pending
      const { error: updateError } = await supabase
        .from('insurance_scope_documents')
        .update({ 
          parse_status: 'pending',
          parse_error: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);

      if (updateError) throw updateError;

      // Call the ingest edge function
      const { data, error } = await supabase.functions.invoke('scope-document-ingest', {
        body: { document_id: documentId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Document reprocessing started');
      queryClient.invalidateQueries({ queryKey: ['scope-documents-filtered'] });
      queryClient.invalidateQueries({ queryKey: ['scope-documents'] });
    },
    onError: (error) => {
      toast.error(`Reprocess failed: ${error.message}`);
    },
  });
}

// Delete a scope document
export function useDeleteScopeDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from('insurance_scope_documents')
        .delete()
        .eq('id', documentId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Document deleted');
      queryClient.invalidateQueries({ queryKey: ['scope-documents-filtered'] });
      queryClient.invalidateQueries({ queryKey: ['scope-documents'] });
    },
    onError: (error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });
}
