// ============================================================
// Scope Comparison Analysis
// Compare an uploaded scope against network data to find missing items
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService, supabaseAuth, getAuthUser } from '../_shared/supabase.ts';

interface ComparisonRequest {
  document_id: string;
  carrier_filter?: string;
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
    const body: ComparisonRequest = await req.json();
    const { document_id, carrier_filter } = body;

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: 'document_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for cross-tenant analysis
    const adminClient = supabaseService();

    // Verify user has access to the document
    const { data: docCheck } = await adminClient
      .from('insurance_scope_documents')
      .select('id, tenant_id')
      .eq('id', document_id)
      .single();

    if (!docCheck) {
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify tenant access
    if (docCheck.tenant_id !== user.tenantId) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this document' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call the RPC function for comparison analysis
    const { data, error } = await adminClient.rpc('analyze_scope_comparison', {
      p_document_id: document_id,
      p_carrier_filter: carrier_filter || null,
    });

    if (error) {
      console.error('Comparison analysis error:', error);
      throw error;
    }

    return new Response(
      JSON.stringify(data),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('scope-comparison-analyze error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
