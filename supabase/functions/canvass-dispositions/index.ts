import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

function validateSession(sessionToken: string) {
  try {
    const decoded = atob(sessionToken);
    const [repId, timestamp] = decoded.split(':');
    
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 24 * 60 * 60 * 1000) {
      return null;
    }
    
    return repId;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method === 'GET') {
      // Get dispositions for the canvassing app
      const url = new URL(req.url);
      const sessionToken = url.searchParams.get('session_token');
      
      if (!sessionToken) {
        return new Response(
          JSON.stringify({ error: 'Session token required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const repId = validateSession(sessionToken);
      if (!repId) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get rep's active tenant (supports multi-company switching)
      const { data: rep, error: repError } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', repId)
        .single();

      if (repError || !rep) {
        return new Response(
          JSON.stringify({ error: 'Representative not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tenantId = rep.active_tenant_id || rep.tenant_id;

      // Get available dispositions
      const { data: dispositions, error: dispError } = await supabase
        .from('dialer_dispositions')
        .select('id, name, description, is_positive')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');

      if (dispError) {
        console.error('Error fetching dispositions:', dispError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch dispositions' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          dispositions: dispositions || []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST') {
      // Update contact disposition
      const { session_token, contact_id, disposition_id, notes } = await req.json();
      
      const repId = validateSession(session_token);
      if (!repId) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get rep's active tenant (supports multi-company switching)
      const { data: rep, error: repError } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', repId)
        .single();

      if (repError || !rep) {
        return new Response(
          JSON.stringify({ error: 'Representative not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tenantId = rep.active_tenant_id || rep.tenant_id;

      // Get disposition details
      const { data: disposition, error: dispError } = await supabase
        .from('dialer_dispositions')
        .select('name, description, is_positive')
        .eq('id', disposition_id)
        .eq('tenant_id', tenantId)
        .single();

      if (dispError || !disposition) {
        return new Response(
          JSON.stringify({ error: 'Disposition not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update contact qualification status
      const qualificationStatus = disposition.is_positive ? 'qualified' : 'not_interested';
      
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          qualification_status: qualificationStatus,
          notes: notes ? `${notes}\n\nDisposition: ${disposition.name}` : `Disposition: ${disposition.name}`,
          metadata: {
            canvassing_disposition: {
              disposition_id: disposition_id,
              disposition_name: disposition.name,
              is_positive: disposition.is_positive,
              updated_at: new Date().toISOString(),
              updated_by: repId,
              notes: notes
            }
          }
        })
        .eq('id', contact_id)
        .eq('tenant_id', tenantId);

      if (updateError) {
        console.error('Error updating contact:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to update contact disposition' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create or update pipeline entry if positive disposition
      if (disposition.is_positive) {
        const { data: existingPipeline } = await supabase
          .from('pipeline_entries')
          .select('id')
          .eq('contact_id', contact_id)
          .eq('tenant_id', tenantId)
          .single();

        if (!existingPipeline) {
          await supabase
            .from('pipeline_entries')
            .insert({
              tenant_id: tenantId,
              contact_id: contact_id,
              status: 'lead',
              lead_quality_score: 80,
              assigned_to: repId,
              metadata: {
                source: 'canvassing',
                disposition: disposition.name,
                created_from_disposition: true
              },
              created_by: repId
            });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          disposition: disposition.name,
          qualification_status: qualificationStatus,
          pipeline_created: disposition.is_positive
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Disposition sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Disposition synchronization failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});