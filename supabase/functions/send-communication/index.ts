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

    // Get user's active tenant
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;

    // Parse request
    const { type, to, message, subject, contactId, pipelineEntryId } = await req.json();

    if (!type || !to || !message) {
      throw new Error('Missing required fields: type, to, message');
    }

    console.log(`Processing ${type} communication to:`, to);

    let result;
    let metadata: Record<string, any> = {};

    // Route based on communication type
    switch (type) {
      case 'sms': {
        const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

        // Try Twilio first (preferred), then Telnyx
        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
          console.log('Sending SMS via Twilio');
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const response = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: to,
              From: TWILIO_PHONE_NUMBER,
              Body: message,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Twilio error:', errorText);
            throw new Error(`Twilio API error: ${response.status}`);
          }

          result = await response.json();
          metadata = {
            message_sid: result.sid,
            provider: 'twilio',
            from_number: TWILIO_PHONE_NUMBER,
          };
        } else if (TELNYX_API_KEY) {
          console.log('Sending SMS via Telnyx');
          
          const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');
          const { data: prefs } = await supabaseAdmin
            .from('communication_preferences')
            .select('sms_from_number')
            .eq('tenant_id', tenantId)
            .single();

          const fromNumber = prefs?.sms_from_number || '+1';

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
            console.error('Telnyx error:', errorText);
            throw new Error(`Telnyx API error: ${response.status}`);
          }

          result = await response.json();
          metadata = {
            message_id: result.data.id,
            provider: 'telnyx',
            from_number: fromNumber,
          };
        } else {
          throw new Error('No SMS provider configured. Set TWILIO or TELNYX credentials.');
        }
        break;
      }

      case 'email': {
        const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
        if (!RESEND_API_KEY) {
          throw new Error('RESEND_API_KEY not configured');
        }

        // Get tenant info for branding
        const { data: tenant } = await supabaseAdmin
          .from('tenants')
          .select('name')
          .eq('id', tenantId)
          .single();

        const fromAddress = `${tenant?.name || 'PITCH CRM'} <onboarding@resend.dev>`;

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [to],
            subject: subject || 'Message from your contractor',
            html: message,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Resend error:', errorData);
          
          if (errorData.message?.includes('domain')) {
            throw new Error('Email domain not verified. Please verify your domain in Resend dashboard.');
          }
          throw new Error(`Resend API error: ${response.status}`);
        }

        result = await response.json();
        metadata = {
          email_id: result.id,
          provider: 'resend',
        };
        break;
      }

      default:
        throw new Error(`Unknown communication type: ${type}`);
    }

    // Log to communication history
    const { error: logError } = await supabaseAdmin.from('communication_history').insert({
      tenant_id: tenantId,
      rep_id: user.id,
      contact_id: contactId,
      pipeline_entry_id: pipelineEntryId,
      communication_type: type,
      direction: 'outbound',
      subject: subject,
      content: message,
      metadata: {
        ...metadata,
        to,
      },
    });

    if (logError) {
      console.error('Error logging communication:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${type.toUpperCase()} sent successfully`,
        provider: metadata.provider,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Communication error:', error);
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
