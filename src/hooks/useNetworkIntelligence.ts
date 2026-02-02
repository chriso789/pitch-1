// ============================================================
// Network Intelligence Hooks
// Cross-tenant aggregated scope data with PII redaction
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ============================================================
// Types
// ============================================================

export interface NetworkStats {
  total_documents: number;
  total_contributors: number;
  total_line_items: number;
  carrier_distribution: Array<{ carrier: string; count: number }> | null;
  state_distribution: Array<{ state: string; count: number }> | null;
  total_rcv_sum: number;
  avg_rcv: number;
  monthly_trend: Array<{ month: string; count: number }> | null;
}

export interface NetworkDocument {
  document_id: string;
  contributor_hash: string;
  document_type: string;
  carrier_normalized: string | null;
  format_family: string | null;
  parse_status: string;
  loss_year: number | null;
  loss_month: number | null;
  created_at: string;
  total_rcv: number | null;
  total_acv: number | null;
  total_depreciation: number | null;
  recoverable_depreciation: number | null;
  non_recoverable_depreciation: number | null;
  deductible: number | null;
  tax_amount: number | null;
  overhead_amount: number | null;
  profit_amount: number | null;
  total_net_claim: number | null;
  state_code: string | null;
  zip_prefix: string | null;
  price_list_name: string | null;
  price_list_region: string | null;
  line_item_count: number;
}

export interface NetworkFilters {
  carrier_normalized?: string;
  state_code?: string;
  loss_year?: number;
  document_type?: string;
  limit?: number;
  offset?: number;
}

// ============================================================
// Hooks
// ============================================================

/**
 * Fetches cross-tenant aggregated network statistics
 * Data is anonymized - no PII or tenant identification exposed
 */
export function useNetworkIntelligenceStats() {
  return useQuery({
    queryKey: ['network-intelligence-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<NetworkStats>('scope-network-stats');
      
      if (error) {
        console.error('Network stats error:', error);
        throw error;
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetches list of anonymized scope documents across all tenants
 * PII is redacted: no addresses, claim numbers, or tenant identification
 */
export function useNetworkIntelligenceDocuments(filters?: NetworkFilters) {
  return useQuery({
    queryKey: ['network-intelligence-documents', filters],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        documents: NetworkDocument[];
        total: number;
        limit: number;
        offset: number;
      }>('scope-network-list', {
        body: filters,
      });
      
      if (error) {
        console.error('Network documents error:', error);
        throw error;
      }
      
      return data;
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Get unique carriers from network data for filtering
 */
export function useNetworkCarriers() {
  const { data: stats } = useNetworkIntelligenceStats();
  
  return {
    carriers: stats?.carrier_distribution?.map(c => c.carrier) || [],
    carrierCounts: stats?.carrier_distribution || [],
  };
}

/**
 * Get unique states from network data for filtering
 */
export function useNetworkStates() {
  const { data: stats } = useNetworkIntelligenceStats();
  
  return {
    states: stats?.state_distribution?.map(s => s.state) || [],
    stateCounts: stats?.state_distribution || [],
  };
}
