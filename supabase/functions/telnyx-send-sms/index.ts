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
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  if (!cleaned.startsWith('+')) {
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

    // Parse request body - now accepts locationId
    const { to, message, contactId, jobId, fromNumber, locationId } = await req.json();

    if (!to || !message) {
      throw new Error('Missing required fields: to, message');
    }

    // Format and validate recipient number
    const formattedTo = formatToE164(to);
    if (!isValidE164(formattedTo)) {
      throw new Error(`Invalid recipient phone number format: ${to}. Must be E.164 format (e.g., +12345678901)`);
    }

    // Determine from number with location awareness
    // Priority: 1. Explicit fromNumber, 2. locationId lookup, 3. User's current location, 4. Tenant primary location, 5. Comm prefs, 6. Env var
    let fromNum = fromNumber;
    let resolvedLocationId = locationId;

    if (!fromNum && tenantId) {
      // If locationId provided, get that location's phone number
      if (locationId) {
        const { data: location } = await supabaseAdmin
          .from('locations')
          .select('telnyx_phone_number')
          .eq('id', locationId)
          .eq('tenant_id', tenantId)
          .single();

        if (location?.telnyx_phone_number) {
          fromNum = location.telnyx_phone_number;
          console.log('Using location-specific phone number:', fromNum);
        }
      }

      // Try user's current location from app_settings
      if (!fromNum) {
        const { data: userSettings } = await supabaseAdmin
          .from('app_settings')
          .select('setting_value')
          .eq('user_id', user.id)
          .eq('tenant_id', tenantId)
          .eq('setting_key', 'current_location_id')
          .single();

        if (userSettings?.setting_value) {
          const currentLocationId = typeof userSettings.setting_value === 'string' 
            ? userSettings.setting_value 
            : userSettings.setting_value?.value;

          if (currentLocationId) {
            const { data: userLocation } = await supabaseAdmin
              .from('locations')
              .select('id, telnyx_phone_number')
              .eq('id', currentLocationId)
              .eq('tenant_id', tenantId)
              .single();

            if (userLocation?.telnyx_phone_number) {
              fromNum = userLocation.telnyx_phone_number;
              resolvedLocationId = userLocation.id;
              console.log('Using user current location phone number:', fromNum);
            }
          }
        }
      }

      // Try primary location
      if (!fromNum) {
        const { data: primaryLocation } = await supabaseAdmin
          .from('locations')
          .select('id, telnyx_phone_number')
          .eq('tenant_id', tenantId)
          .eq('is_primary', true)
          .single();

        if (primaryLocation?.telnyx_phone_number) {
          fromNum = primaryLocation.telnyx_phone_number;
          resolvedLocationId = primaryLocation.id;
          console.log('Using primary location phone number:', fromNum);
        }
      }

      // Try any location with a phone number
      if (!fromNum) {
        const { data: anyLocation } = await supabaseAdmin
          .from('locations')
          .select('id, telnyx_phone_number')
          .eq('tenant_id', tenantId)
          .not('telnyx_phone_number', 'is', null)
          .limit(1)
          .single();

        if (anyLocation?.telnyx_phone_number) {
          fromNum = anyLocation.telnyx_phone_number;
          resolvedLocationId = anyLocation.id;
          console.log('Using available location phone number:', fromNum);
        }
      }

      // Fall back to communication preferences
      if (!fromNum) {
        const { data: prefs } = await supabaseAdmin
          .from('communication_preferences')
          .select('sms_from_number')
          .eq('tenant_id', tenantId)
          .single();

        fromNum = prefs?.sms_from_number;
        if (fromNum) {
          console.log('Using communication preferences phone number:', fromNum);
        }
      }
    }

    // Final fallback to environment variable
    if (!fromNum) {
      fromNum = TELNYX_PHONE_NUMBER;
      console.log('Using environment variable phone number:', fromNum);
    }

    if (!fromNum) {
      throw new Error('No from number configured. Please set up a phone number for your location or add TELNYX_PHONE_NUMBER secret.');
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
      profileId: TELNYX_SMS_PROFILE_ID,
      locationId: resolvedLocationId || 'none'
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
      
      const errorMessage = data.errors?.[0]?.detail 
        || data.errors?.[0]?.title 
        || data.message 
        || `Telnyx API error: ${response.status}`;
      
      throw new Error(errorMessage);
    }

    console.log('Telnyx SMS sent successfully:', {
      messageId: data.data?.id,
      to: formattedTo,
      from: formattedFrom,
      locationId: resolvedLocationId
    });

    // Log to communication history with location_id
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
          location_id: resolvedLocationId || null,
        },
      });

      // Also update/create SMS thread with location_id
      const { data: existingThread } = await supabaseAdmin
        .from('sms_threads')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone_number', formattedTo)
        .single();

      if (existingThread) {
        await supabaseAdmin
          .from('sms_threads')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: message.substring(0, 100),
            location_id: resolvedLocationId || null,
          })
          .eq('id', existingThread.id);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: data.data?.id,
        message: 'SMS sent successfully',
        to: formattedTo,
        from: formattedFrom,
        locationId: resolvedLocationId
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
