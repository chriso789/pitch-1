// ============================================================
// Scope Comparison Hook
// Compare a scope document against network data
// ============================================================

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ComparisonResult {
  scope_summary: {
    total_items: number;
    total_rcv: number;
    carrier_detected: string | null;
    state_detected: string | null;
  };
  matched_items: Array<{
    line_item_id: string;
    description: string;
    unit_price: number;
    network_avg_price: number;
    network_frequency: number;
  }>;
  missing_items: Array<{
    canonical_key: string;
    description: string;
    raw_code: string | null;
    unit: string | null;
    suggested_unit_price: number;
    network_paid_rate: number;
    network_sample_count: number;
  }>;
  price_discrepancies: Array<{
    line_item_id: string;
    description: string;
    scope_price: number;
    network_avg_price: number;
    difference_percent: number;
  }>;
}

interface ComparisonRequest {
  document_id: string;
  carrier_filter?: string;
}

/**
 * Analyze a scope document against the network
 */
export function useScopeComparison(documentId: string | null, carrierFilter?: string) {
  return useQuery({
    queryKey: ['scope-comparison', documentId, carrierFilter],
    queryFn: async () => {
      if (!documentId) throw new Error('Document ID required');
      
      const { data, error } = await supabase.functions.invoke<ComparisonResult>(
        'scope-comparison-analyze',
        { 
          body: { 
            document_id: documentId,
            carrier_filter: carrierFilter,
          } 
        }
      );
      
      if (error) {
        console.error('Scope comparison error:', error);
        throw error;
      }
      
      return data;
    },
    enabled: !!documentId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Mutation to trigger comparison on demand
 */
export function useScopeComparisonMutation() {
  return useMutation({
    mutationFn: async ({ document_id, carrier_filter }: ComparisonRequest) => {
      const { data, error } = await supabase.functions.invoke<ComparisonResult>(
        'scope-comparison-analyze',
        { 
          body: { document_id, carrier_filter } 
        }
      );
      
      if (error) throw error;
      return data;
    },
  });
}
