// ============================================================
// Scope Intelligence React Query Hooks
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from './useEffectiveTenantId';
import type { ScopeDocument, ScopeHeader, ScopeLineItem, CanonicalItem } from '@/lib/insurance/canonicalItems';

// ============================================================
// Scope Documents
// ============================================================

export function useScopeDocuments(options?: {
  insuranceClaimId?: string;
  jobId?: string;
  status?: string;
}) {
  const tenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['scope-documents', tenantId, options],
    queryFn: async () => {
      let query = supabase
        .from('insurance_scope_documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (options?.insuranceClaimId) {
        query = query.eq('insurance_claim_id', options.insuranceClaimId);
      }
      if (options?.jobId) {
        query = query.eq('job_id', options.jobId);
      }
      if (options?.status) {
        query = query.eq('parse_status', options.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ScopeDocument[];
    },
    enabled: !!tenantId,
  });
}

export function useScopeDocument(documentId: string | undefined) {
  return useQuery({
    queryKey: ['scope-document', documentId],
    queryFn: async () => {
      if (!documentId) return null;
      
      const { data, error } = await supabase
        .from('insurance_scope_documents')
        .select('*')
        .eq('id', documentId)
        .single();
      
      if (error) throw error;
      return data as ScopeDocument;
    },
    enabled: !!documentId,
  });
}

// ============================================================
// Scope Headers & Line Items
// ============================================================

export function useScopeHeader(documentId: string | undefined) {
  return useQuery({
    queryKey: ['scope-header', documentId],
    queryFn: async () => {
      if (!documentId) return null;
      
      const { data, error } = await supabase
        .from('insurance_scope_headers')
        .select('*')
        .eq('document_id', documentId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data as ScopeHeader | null;
    },
    enabled: !!documentId,
  });
}

export function useScopeLineItems(headerId: string | undefined) {
  return useQuery({
    queryKey: ['scope-line-items', headerId],
    queryFn: async () => {
      if (!headerId) return [];
      
      const { data, error } = await supabase
        .from('insurance_scope_line_items')
        .select(`
          *,
          canonical_item:insurance_canonical_items(*)
        `)
        .eq('header_id', headerId)
        .order('line_order', { ascending: true });
      
      if (error) throw error;
      return data as (ScopeLineItem & { canonical_item: CanonicalItem | null })[];
    },
    enabled: !!headerId,
  });
}

// ============================================================
// Document Upload & Ingestion
// ============================================================

interface UploadScopeParams {
  file: File;
  documentType: 'estimate' | 'supplement' | 'denial' | 'policy' | 'reinspection' | 'final_settlement';
  insuranceClaimId?: string;
  jobId?: string;
}

export function useUploadScope() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();

  return useMutation({
    mutationFn: async ({ file, documentType, insuranceClaimId, jobId }: UploadScopeParams) => {
      if (!tenantId) throw new Error('No tenant context');

      // Upload to storage first
      const storagePath = `${tenantId}/insurance-scopes/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      // Call ingestion function
      const { data, error } = await supabase.functions.invoke('scope-document-ingest', {
        body: {
          storage_path: storagePath,
          document_type: documentType,
          insurance_claim_id: insuranceClaimId,
          job_id: jobId,
          file_name: file.name,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scope-documents'] });
      toast({
        title: 'Scope uploaded',
        description: 'Document is being processed...',
      });
    },
    onError: (error) => {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}

// ============================================================
// Canonical Items
// ============================================================

export function useCanonicalItems(category?: string) {
  return useQuery({
    queryKey: ['canonical-items', category],
    queryFn: async () => {
      let query = supabase
        .from('insurance_canonical_items')
        .select('*')
        .order('category')
        .order('display_name');

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as CanonicalItem[];
    },
  });
}

// ============================================================
// Line Item Mapping
// ============================================================

interface UpdateMappingParams {
  lineItemId: string;
  canonicalItemId: string;
}

export function useUpdateLineItemMapping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ lineItemId, canonicalItemId }: UpdateMappingParams) => {
      const { data, error } = await supabase
        .from('insurance_scope_line_items')
        .update({
          canonical_item_id: canonicalItemId,
          mapping_method: 'manual',
          mapping_confidence: 1.0,
        })
        .eq('id', lineItemId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scope-line-items'] });
      toast({
        title: 'Mapping updated',
        description: 'Line item has been mapped to canonical item',
      });
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}

// ============================================================
// Evidence Search (Prior Paid Examples)
// ============================================================

interface EvidenceSearchParams {
  canonicalItemId: string;
  carrierNormalized?: string;
  stateCode?: string;
  includeNetwork?: boolean;
}

interface PriorPaidExample {
  document_id: string;
  carrier_normalized: string;
  state_code: string;
  loss_year: number;
  quantity: number;
  unit_price: number;
  was_paid: boolean;
  snippet_text?: string;
}

interface PriceStats {
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  paid_rate: number;
  sample_count: number;
}

export function useEvidenceSearch(params: EvidenceSearchParams | null) {
  const tenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['evidence-search', params],
    queryFn: async () => {
      if (!params) return null;

      // Search internal examples first
      let query = supabase
        .from('insurance_scope_line_items')
        .select(`
          id,
          quantity,
          unit_price,
          total_rcv,
          document:insurance_scope_documents!inner(
            id,
            carrier_normalized,
            loss_date_detected,
            property_state
          )
        `)
        .eq('canonical_item_id', params.canonicalItemId)
        .not('unit_price', 'is', null)
        .limit(20);

      if (params.carrierNormalized) {
        query = query.eq('document.carrier_normalized', params.carrierNormalized);
      }

      const { data: internalExamples, error } = await query;
      if (error) throw error;

      // Calculate price stats from internal data
      const prices = (internalExamples || [])
        .map(e => e.unit_price)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b);

      const priceStats: PriceStats = {
        median: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0,
        p25: prices.length >= 4 ? prices[Math.floor(prices.length * 0.25)] : prices[0] || 0,
        p75: prices.length >= 4 ? prices[Math.floor(prices.length * 0.75)] : prices[prices.length - 1] || 0,
        min: prices.length > 0 ? prices[0] : 0,
        max: prices.length > 0 ? prices[prices.length - 1] : 0,
        paid_rate: 1.0, // All internal examples are assumed paid
        sample_count: prices.length,
      };

      return {
        internal_examples: internalExamples || [],
        network_examples: [] as PriorPaidExample[], // Network contributions (future)
        price_stats: priceStats,
      };
    },
    enabled: !!params && !!tenantId,
  });
}

// ============================================================
// Supplement Packets
// ============================================================

export function useSupplementPackets(options?: {
  jobId?: string;
  insuranceClaimId?: string;
}) {
  const tenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['supplement-packets', tenantId, options],
    queryFn: async () => {
      let query = supabase
        .from('insurance_supplement_packets')
        .select('*')
        .order('created_at', { ascending: false });

      if (options?.jobId) {
        query = query.eq('job_id', options.jobId);
      }
      if (options?.insuranceClaimId) {
        query = query.eq('insurance_claim_id', options.insuranceClaimId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });
}

interface CreatePacketParams {
  title: string;
  items: Array<{
    canonical_item_id: string;
    line_item_id?: string;
    requested_amount: number;
    dispute_reason: string;
  }>;
  priorExamples: any[];
  jobId?: string;
  insuranceClaimId?: string;
}

export function useCreateSupplementPacket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: CreatePacketParams) => {
      // Get user's tenant_id first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();
      
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant context');

      const { data, error } = await supabase
        .from('insurance_supplement_packets')
        .insert({
          tenant_id: tenantId,
          title: params.title,
          items_json: params.items as any,
          prior_examples_json: params.priorExamples as any,
          job_id: params.jobId || null,
          insurance_claim_id: params.insuranceClaimId || null,
          status: 'draft',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplement-packets'] });
      toast({
        title: 'Packet created',
        description: 'Supplement evidence packet has been created',
      });
    },
    onError: (error) => {
      toast({
        title: 'Creation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
