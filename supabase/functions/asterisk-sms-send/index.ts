import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.tenant_id;
    if (!tenantId) {
      throw new Error('Tenant not found');
    }

    const { to, body, contactId, pipelineId } = await req.json();

    console.log('Sending SMS via Asterisk SMPP:', { to, tenantId });

    if (!to || !body) {
      throw new Error('Missing required fields: to, body');
    }

    // Get communication preferences for Asterisk API URL
    const { data: prefs } = await supabase
      .from('communication_preferences')
      .select('asterisk_api_url, asterisk_api_token, sms_from_number')
      .eq('tenant_id', tenantId)
      .single();

    if (!prefs?.asterisk_api_url) {
      throw new Error('Asterisk API URL not configured for this tenant');
    }

    // Call Asterisk Comms API to send SMS via SMPP
    const asteriskResponse = await fetch(`${prefs.asterisk_api_url}/sms/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(prefs.asterisk_api_token ? { 'Authorization': `Bearer ${prefs.asterisk_api_token}` } : {}),
      },
      body: JSON.stringify({
        to,
        from: prefs.sms_from_number || to, // Use configured FROM number
        body,
        tenantId,
        contactId,
        userId: user.id,
      }),
    });

    if (!asteriskResponse.ok) {
      const errorText = await asteriskResponse.text();
      console.error('Asterisk API error:', errorText);
      throw new Error(`Failed to send SMS: ${errorText}`);
    }

    const asteriskResult = await asteriskResponse.json();

    // Log to communication history
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { error: historyError } = await supabaseAdmin
      .from('communication_history')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        pipeline_entry_id: pipelineId,
        communication_type: 'sms',
        direction: 'outbound',
        content: body,
        metadata: {
          message_id: asteriskResult.messageId,
          to_number: to,
          from_number: prefs.sms_from_number,
          sent_via: 'asterisk_smpp',
        },
      });

    if (historyError) {
      console.error('Error logging SMS to history:', historyError);
    }

    return new Response(
      JSON.stringify({ success: true, messageId: asteriskResult.messageId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('SMS send error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
