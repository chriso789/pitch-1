import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// Secure token validation using database lookup
async function validateSession(sessionToken: string): Promise<{ userId: string; tenantId: string } | null> {
  try {
    const { data, error } = await supabase
      .rpc('validate_canvass_token', { p_token: sessionToken });
    
    if (error || !data || data.length === 0) {
      return null;
    }
    return { userId: data[0].user_id, tenantId: data[0].tenant_id };
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
      const url = new URL(req.url);
      const sessionToken = url.searchParams.get('session_token');
      
      if (!sessionToken) {
        return new Response(
          JSON.stringify({ error: 'Session token required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const session = await validateSession(sessionToken);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: dispositions, error: dispError } = await supabase
        .from('dialer_dispositions')
        .select('id, name, description, is_positive')
        .eq('tenant_id', session.tenantId)
        .eq('is_active', true)
        .order('name');

      if (dispError) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch dispositions' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, dispositions: dispositions || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST') {
      const { session_token, contact_id, disposition_id, notes } = await req.json();
      
      const session = await validateSession(session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { userId: repId, tenantId } = session;

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

      const qualificationStatus = disposition.is_positive ? 'qualified' : 'not_interested';
      
      await supabase
        .from('contacts')
        .update({
          qualification_status: qualificationStatus,
          notes: notes ? `${notes}\n\nDisposition: ${disposition.name}` : `Disposition: ${disposition.name}`,
        })
        .eq('id', contact_id)
        .eq('tenant_id', tenantId);

      if (disposition.is_positive) {
        const { data: existingPipeline } = await supabase
          .from('pipeline_entries')
          .select('id')
          .eq('contact_id', contact_id)
          .eq('tenant_id', tenantId)
          .single();

        if (!existingPipeline) {
          await supabase.from('pipeline_entries').insert({
            tenant_id: tenantId,
            contact_id: contact_id,
            status: 'lead',
            lead_quality_score: 80,
            assigned_to: repId,
            metadata: { source: 'canvassing', disposition: disposition.name },
            created_by: repId
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, disposition: disposition.name, qualification_status: qualificationStatus }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Disposition error:', error);
    return new Response(
      JSON.stringify({ error: 'Disposition synchronization failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
