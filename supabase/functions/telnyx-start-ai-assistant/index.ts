/**
 * Telnyx Start AI Assistant Edge Function
 * Starts live AI assistant on an active call
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StartAIRequest {
  tenant_id: string;
  call_id: string;
  persona_prompt?: string;
  safety_prompt?: string;
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

    const body = (await req.json()) as StartAIRequest;
    
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
      .select('id, tenant_id, telnyx_call_control_id, conversation_id, brand_id, status')
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

    // Load AI agent config
    const { data: agent } = await admin
      .from('ai_agents')
      .select('enabled, persona_prompt, safety_prompt')
      .eq('tenant_id', body.tenant_id)
      .maybeSingle();

    if (!agent?.enabled && !body.persona_prompt) {
      return new Response(
        JSON.stringify({ error: 'AI agent disabled for tenant (or provide persona_prompt override)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let persona = body.persona_prompt ?? agent?.persona_prompt ?? '';
    let safety = body.safety_prompt ?? agent?.safety_prompt ?? '';

    // Check for brand override
    if (call.brand_id) {
      const { data: brand } = await admin
        .from('brands')
        .select('ai_persona_prompt, ai_safety_prompt')
        .eq('id', call.brand_id)
        .eq('tenant_id', body.tenant_id)
        .maybeSingle();

      if (brand?.ai_persona_prompt) persona = brand.ai_persona_prompt;
      if (brand?.ai_safety_prompt) safety = brand.ai_safety_prompt;
    }

    // Start AI assistant via Telnyx
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    if (!TELNYX_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'TELNYX_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const telnyxResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${call.telnyx_call_control_id}/actions/ai_assistant_start`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          persona,
          safety,
        }),
      }
    );

    const telnyxData = await telnyxResponse.json();

    if (!telnyxResponse.ok) {
      console.error('Telnyx AI assistant start failed:', telnyxData);
      return new Response(
        JSON.stringify({ error: 'Telnyx API error', details: telnyxData }),
        { status: telnyxResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update call to mark AI enabled
    await admin
      .from('calls')
      .update({ ai_enabled: true })
      .eq('id', call.id);

    console.log(`Started AI assistant on call ${call.id}`);

    return new Response(
      JSON.stringify({ success: true, telnyx: telnyxData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('telnyx-start-ai-assistant error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
