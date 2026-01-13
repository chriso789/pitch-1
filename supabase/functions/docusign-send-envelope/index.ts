import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAuth } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface SendEnvelopeRequest {
  agreement_instance_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = supabaseAuth(req);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { agreement_instance_id }: SendEnvelopeRequest = await req.json();

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
      return new Response(JSON.stringify({ error: 'Envelope already sent or not in draft status' }), {
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

    // Send envelope via DocuSign API
    const sendResponse = await fetch(
      `${docusignAccount.base_uri}/v2.1/accounts/${docusignAccount.account_id}/envelopes/${agreementInstance.envelope_id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'sent' }),
      }
    );

    if (!sendResponse.ok) {
      const errorData = await sendResponse.json();
      throw new Error(`DocuSign send API error: ${errorData.message || 'Unknown error'}`);
    }

    // Update agreement instance status
    const { error: updateError } = await supabaseClient
      .from('agreement_instances')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', agreement_instance_id);

    if (updateError) {
      console.error('Failed to update agreement instance:', updateError);
    }

    // Update recipient statuses
    await supabaseClient
      .from('recipients')
      .update({ status: 'sent' })
      .eq('agreement_instance_id', agreement_instance_id);

    // Log event
    await supabaseClient
      .from('docusign_events')
      .insert({
        tenant_id: user.id,
        agreement_instance_id,
        envelope_id: agreementInstance.envelope_id,
        event_type: 'envelope_sent',
        payload_json: {
          envelope_id: agreementInstance.envelope_id,
          sent_by: user.id,
          sent_at: new Date().toISOString(),
        },
      });

    return new Response(JSON.stringify({
      success: true,
      status: 'sent',
      envelope_id: agreementInstance.envelope_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send envelope error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});