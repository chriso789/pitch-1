// ============================================================
// Scope Network Line Items Search
// Returns anonymized line items across all tenants for research
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService, supabaseAuth, getAuthUser } from '../_shared/supabase.ts';

interface LineItemSearchFilters {
  search?: string;
  carrier_normalized?: string;
  category?: string;
  unit?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user exists
    const supabase = supabaseAuth(req);
    const user = await getAuthUser(supabase);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: LineItemSearchFilters = await req.json().catch(() => ({}));
    const {
      search,
      carrier_normalized,
      category,
      unit,
      min_price,
      max_price,
      limit = 100,
      offset = 0,
    } = body;

    // Use service role to bypass RLS for cross-tenant aggregation
    const adminClient = supabaseService();

    // Call the RPC function
    const { data, error } = await adminClient.rpc('search_network_line_items', {
      p_search: search || null,
      p_carrier: carrier_normalized || null,
      p_category: category || null,
      p_unit: unit || null,
      p_min_price: min_price ?? null,
      p_max_price: max_price ?? null,
      p_limit: Math.min(limit, 500),
      p_offset: offset,
    });

    if (error) {
      console.error('Line item search error:', error);
      throw error;
    }

    // Get total count for pagination
    const { count } = await adminClient
      .from('insurance_scope_line_items')
      .select('id', { count: 'exact', head: true });

    return new Response(
      JSON.stringify({
        line_items: data || [],
        total: count || 0,
        limit,
        offset,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('scope-network-line-items error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
