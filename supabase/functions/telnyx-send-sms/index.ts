import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validate E.164 phone number format
function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

// Format phone number to E.164
function formatToE164(phone: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If no + prefix, assume US number
  if (!cleaned.startsWith('+')) {
    // Remove leading 1 if present (US country code without +)
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  
  return cleaned;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');
    const TELNYX_PHONE_NUMBER = Deno.env.get('TELNYX_PHONE_NUMBER');

    if (!TELNYX_API_KEY) {
      console.error('Missing TELNYX_API_KEY secret');
      throw new Error('Telnyx API key not configured. Please add TELNYX_API_KEY in Lovable Secrets.');
    }

    if (!TELNYX_SMS_PROFILE_ID) {
      console.error('Missing TELNYX_SMS_PROFILE_ID secret');
      throw new Error('Telnyx SMS Profile ID not configured. Please add TELNYX_SMS_PROFILE_ID in Lovable Secrets.');
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

    // Get user's active tenant
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;

    // Parse request body
    const { to, message, contactId, jobId, fromNumber } = await req.json();

    if (!to || !message) {
      throw new Error('Missing required fields: to, message');
    }

    // Format and validate recipient number
    const formattedTo = formatToE164(to);
    if (!isValidE164(formattedTo)) {
      throw new Error(`Invalid recipient phone number format: ${to}. Must be E.164 format (e.g., +12345678901)`);
    }

    // Determine from number with priority:
    // 1. Explicit fromNumber parameter
    // 2. Location-specific number from tenant settings
    // 3. Communication preferences sms_from_number
    // 4. Default TELNYX_PHONE_NUMBER from secrets
    let fromNum = fromNumber;

    if (!fromNum && tenantId) {
      // Try to get from communication preferences first
      const { data: prefs } = await supabaseAdmin
        .from('communication_preferences')
        .select('sms_from_number')
        .eq('tenant_id', tenantId)
        .single();

      fromNum = prefs?.sms_from_number;
    }

    // Fall back to environment variable
    if (!fromNum) {
      fromNum = TELNYX_PHONE_NUMBER;
    }

    if (!fromNum) {
      throw new Error('No from number configured. Please set up SMS from number in Communication Preferences or add TELNYX_PHONE_NUMBER secret.');
    }

    // Format and validate from number
    const formattedFrom = formatToE164(fromNum);
    if (!isValidE164(formattedFrom)) {
      throw new Error(`Invalid from phone number format: ${fromNum}. Must be E.164 format.`);
    }

    console.log('Sending SMS via Telnyx:', {
      to: formattedTo,
      from: formattedFrom,
      messageLength: message.length,
      profileId: TELNYX_SMS_PROFILE_ID
    });

    // Send SMS via Telnyx API
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formattedFrom,
        to: formattedTo,
        text: message,
        messaging_profile_id: TELNYX_SMS_PROFILE_ID,
      }),
    });

    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse Telnyx response:', responseText);
      throw new Error(`Telnyx API returned invalid response: ${responseText.substring(0, 200)}`);
    }

    if (!response.ok) {
      console.error('Telnyx API error:', {
        status: response.status,
        statusText: response.statusText,
        errors: data.errors || data
      });
      
      // Extract meaningful error message from Telnyx response
      const errorMessage = data.errors?.[0]?.detail 
        || data.errors?.[0]?.title 
        || data.message 
        || `Telnyx API error: ${response.status}`;
      
      throw new Error(errorMessage);
    }

    console.log('Telnyx SMS sent successfully:', {
      messageId: data.data?.id,
      to: formattedTo,
      from: formattedFrom
    });

    // Log to communication history
    if (tenantId) {
      await supabaseAdmin.from('communication_history').insert({
        tenant_id: tenantId,
        rep_id: user.id,
        contact_id: contactId || null,
        pipeline_entry_id: jobId || null,
        communication_type: 'sms',
        direction: 'outbound',
        content: message,
        metadata: {
          message_id: data.data?.id,
          to_number: formattedTo,
          from_number: formattedFrom,
          sent_via: 'telnyx',
          messaging_profile_id: TELNYX_SMS_PROFILE_ID,
        },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: data.data?.id,
        message: 'SMS sent successfully',
        to: formattedTo,
        from: formattedFrom
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
