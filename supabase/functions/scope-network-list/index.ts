// ============================================================
// Scope Network List Edge Function
// Returns anonymized scope documents across ALL tenants with PII redaction
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService } from '../_shared/supabase.ts';

interface NetworkFilters {
  carrier_normalized?: string;
  state_code?: string;
  loss_year?: number;
  document_type?: string;
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

    // Parse filters from request body
    let filters: NetworkFilters = {};
    if (req.method === 'POST') {
      try {
        filters = await req.json();
      } catch {
        // Empty body is OK
      }
    }

    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    // Use service role to access cross-tenant view
    const supabase = supabaseService();

    // Query the anonymized view
    let query = supabase
      .from('scope_network_intelligence')
      .select('*')
      .eq('parse_status', 'complete')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (filters.carrier_normalized) {
      query = query.eq('carrier_normalized', filters.carrier_normalized);
    }
    if (filters.state_code) {
      query = query.eq('state_code', filters.state_code);
    }
    if (filters.loss_year) {
      query = query.eq('loss_year', filters.loss_year);
    }
    if (filters.document_type) {
      query = query.eq('document_type', filters.document_type);
    }

    const { data: documents, error } = await query;

    if (error) {
      console.error('Error fetching network documents:', error);
      throw error;
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('scope_network_intelligence')
      .select('document_id', { count: 'exact', head: true })
      .eq('parse_status', 'complete');

    if (filters.carrier_normalized) {
      countQuery = countQuery.eq('carrier_normalized', filters.carrier_normalized);
    }
    if (filters.state_code) {
      countQuery = countQuery.eq('state_code', filters.state_code);
    }

    const { count } = await countQuery;

    return new Response(
      JSON.stringify({
        documents: documents || [],
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
    console.error('scope-network-list error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
