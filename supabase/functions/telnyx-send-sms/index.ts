import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');

    if (!TELNYX_API_KEY) {
      throw new Error('Telnyx API key not configured');
    }

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's active tenant (supports multi-company switching)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;

    // Parse request body
    const { to, message, contactId, jobId } = await req.json();

    if (!to || !message) {
      throw new Error('Missing required fields: to, message');
    }

    // Get messaging profile from tenant settings or use default
    const { data: prefs } = await supabaseAdmin
      .from('communication_preferences')
      .select('sms_from_number')
      .eq('tenant_id', tenantId)
      .single();

    const fromNumber = prefs?.sms_from_number || '+1';

    console.log('Sending SMS via Telnyx:', { to, from: fromNumber });

    // Send SMS via Telnyx API
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromNumber,
        to,
        text: message,
        ...(TELNYX_SMS_PROFILE_ID ? { messaging_profile_id: TELNYX_SMS_PROFILE_ID } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telnyx API error:', response.status, errorText);
      throw new Error(`Telnyx API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Telnyx SMS response:', data);

    // Log to communication history
    await supabaseAdmin.from('communication_history').insert({
      tenant_id: tenantId,
      rep_id: user.id,
      contact_id: contactId,
      pipeline_entry_id: jobId,
      communication_type: 'sms',
      direction: 'outbound',
      content: message,
      metadata: {
        message_id: data.data.id,
        to_number: to,
        from_number: fromNumber,
        sent_via: 'telnyx',
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: data.data.id,
        message: 'SMS sent successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('SMS send error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
