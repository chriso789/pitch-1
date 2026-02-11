import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Test AI Call - Initiates an outbound call to a test number
 * using the tenant's Telnyx number, then triggers the AI gather flow.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { phone_number, tenant_id } = await req.json();

    if (!phone_number || !tenant_id) {
      return new Response(JSON.stringify({ error: 'phone_number and tenant_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      return new Response(JSON.stringify({ error: 'TELNYX_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the tenant's Telnyx phone number from locations
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_phone_number, telnyx_voice_app_id')
      .eq('tenant_id', tenant_id)
      .not('telnyx_phone_number', 'is', null)
      .limit(1)
      .single();

    if (!location?.telnyx_phone_number) {
      return new Response(JSON.stringify({ error: 'No Telnyx phone number configured for this tenant. Set up a location with a phone number first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get connection ID from env or location
    const connectionId = Deno.env.get('TELNYX_CONNECTION_ID') || '';

    // Normalize destination phone
    let toNumber = phone_number.replace(/\D/g, '');
    if (toNumber.length === 10) toNumber = '1' + toNumber;
    if (!toNumber.startsWith('+')) toNumber = '+' + toNumber;

    console.log(`[Test Call] Initiating call from ${location.telnyx_phone_number} to ${toNumber}`);

    // Get the webhook URL for the AI answering function
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const webhookUrl = `${supabaseUrl}/functions/v1/telnyx-ai-answering`;

    // Initiate outbound call via Telnyx
    const callResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: connectionId,
        from: location.telnyx_phone_number,
        to: toNumber,
        webhook_url: webhookUrl,
        client_state: btoa(JSON.stringify({
          tenant_id,
          test_call: true,
          caller_number: toNumber,
        })),
        answering_machine_detection: 'disabled',
      }),
    });

    if (!callResponse.ok) {
      const errorText = await callResponse.text();
      console.error('[Test Call] Telnyx API error:', errorText);
      return new Response(JSON.stringify({ error: `Telnyx error: ${errorText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callData = await callResponse.json();
    console.log('[Test Call] Call initiated:', JSON.stringify(callData));

    return new Response(JSON.stringify({
      success: true,
      call_control_id: callData.data?.call_control_id,
      message: `Test call initiated to ${toNumber}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[Test Call] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
