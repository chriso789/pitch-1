// ============================================================
// Network Line Item Search Hook
// Search across all tenants for approved line items (anonymized)
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LineItemSearchFilters {
  search?: string;
  carrier_normalized?: string;
  category?: string;
  unit?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}

export interface NetworkLineItem {
  id: string;
  raw_code: string | null;
  raw_description: string;
  raw_category: string | null;
  unit: string | null;
  unit_price: number | null;
  total_rcv: number | null;
  carrier_normalized: string | null;
  contributor_hash: string;
  state_code: string | null;
  network_frequency: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

interface LineItemSearchResponse {
  line_items: NetworkLineItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Search line items across the network database
 * Returns anonymized data with price statistics
 */
export function useNetworkLineItemSearch(filters: LineItemSearchFilters, enabled = true) {
  return useQuery({
    queryKey: ['network-line-items', filters],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<LineItemSearchResponse>(
        'scope-network-line-items',
        { body: filters }
      );
      
      if (error) {
        console.error('Network line item search error:', error);
        throw error;
      }
      
      return data;
    },
    enabled: enabled && (!!filters.search || !!filters.carrier_normalized || !!filters.category),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Get unique units from network data
 */
export const NETWORK_UNITS = ['SQ', 'SF', 'LF', 'EA', 'HR', 'BDL', 'RL'] as const;

/**
 * Get categories for filtering
 */
export const NETWORK_CATEGORIES = [
  'Roofing',
  'Gutters', 
  'Siding',
  'Windows',
  'Interior',
  'Solar',
  'General',
] as const;
