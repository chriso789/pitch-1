import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

interface UpdateDocGenRequest {
  agreement_instance_id: string;
  fields: Record<string, string>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { agreement_instance_id, fields }: UpdateDocGenRequest = await req.json();

    // Get agreement instance
    const { data: agreementInstance, error: instanceError } = await supabaseClient
      .from('agreement_instances')
      .select('*')
      .eq('id', agreement_instance_id)
      .single();

    if (instanceError || !agreementInstance) {
      return new Response(JSON.stringify({ error: 'Agreement instance not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (agreementInstance.status !== 'draft') {
      return new Response(JSON.stringify({ error: 'Cannot update sent envelope' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get DocuSign account
    const { data: docusignAccount, error: accountError } = await supabaseClient
      .from('docusign_accounts')
      .select('*')
      .eq('tenant_id', user.id)
      .eq('is_active', true)
      .single();

    if (accountError || !docusignAccount) {
      return new Response(JSON.stringify({ error: 'DocuSign account not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get access token
    const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/docusign-auth`, {
      method: 'POST',
      headers: {
        'Authorization': req.headers.get('Authorization')!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'get_token' }),
    });

    const { access_token } = await tokenResponse.json();
    if (!access_token) {
      throw new Error('Failed to get access token');
    }

    // Update DocuSign document generation fields
    const docGenPayload = {
      documentGeneration: {
        envelopeId: agreementInstance.envelope_id,
        mergeFieldInfo: Object.entries(fields).map(([name, value]) => ({
          name,
          value,
        })),
      },
    };

    const docGenResponse = await fetch(
      `${docusignAccount.base_uri}/v2.1/accounts/${docusignAccount.account_id}/envelopes/${agreementInstance.envelope_id}/docGenFormFields`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(docGenPayload),
      }
    );

    if (!docGenResponse.ok) {
      const errorData = await docGenResponse.json();
      throw new Error(`DocuSign DocGen API error: ${errorData.message || 'Unknown error'}`);
    }

    // Store fields in database
    const fieldInserts = Object.entries(fields).map(([field_key, value]) => ({
      tenant_id: user.id,
      agreement_instance_id,
      field_key,
      value,
    }));

    // Delete existing fields and insert new ones
    await supabaseClient
      .from('docgen_fields')
      .delete()
      .eq('agreement_instance_id', agreement_instance_id);

    if (fieldInserts.length > 0) {
      await supabaseClient
        .from('docgen_fields')
        .insert(fieldInserts);
    }

    return new Response(JSON.stringify({
      success: true,
      fields_updated: Object.keys(fields).length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Update DocGen error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});