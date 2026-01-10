/**
 * Telnyx Start Recording Edge Function
 * Manually triggers call recording on an active call
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StartRecordingRequest {
  tenant_id: string;
  call_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'POST only' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json()) as StartRecordingRequest;
    
    if (!body.tenant_id || !body.call_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: tenant_id, call_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Load call record
    const { data: call, error: callErr } = await admin
      .from('calls')
      .select('id, tenant_id, telnyx_call_control_id, status')
      .eq('id', body.call_id)
      .eq('tenant_id', body.tenant_id)
      .single();

    if (callErr || !call) {
      return new Response(
        JSON.stringify({ error: 'Call not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!call.telnyx_call_control_id) {
      return new Response(
        JSON.stringify({ error: 'Call missing telnyx_call_control_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start recording via Telnyx
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    if (!TELNYX_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'TELNYX_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const telnyxResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${call.telnyx_call_control_id}/actions/record_start`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          format: 'mp3',
          channels: 'dual',
        }),
      }
    );

    const telnyxData = await telnyxResponse.json();

    if (!telnyxResponse.ok) {
      console.error('Telnyx record start failed:', telnyxData);
      return new Response(
        JSON.stringify({ error: 'Telnyx API error', details: telnyxData }),
        { status: telnyxResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Started recording on call ${call.id}`);

    return new Response(
      JSON.stringify({ success: true, telnyx: telnyxData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('telnyx-start-recording error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
