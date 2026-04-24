// ============================================================
// Scope Network Stats Edge Function
// Returns anonymized, aggregated scope intelligence across ALL tenants
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated (any authenticated user can access network stats)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role to bypass RLS and aggregate across all tenants
    const supabase = supabaseService();

    // Call the helper function that aggregates stats
    const { data: stats, error } = await supabase.rpc('get_scope_network_stats');

    if (error) {
      console.error('Error fetching network stats:', error);
      throw error;
    }

    return new Response(
      JSON.stringify(stats),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('scope-network-stats error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
