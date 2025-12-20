import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
const TELNYX_CONNECTION_ID = Deno.env.get('TELNYX_CONNECTION_ID');
const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ConfigureRequest {
  phoneNumber: string;
  locationId?: string;
  tenantId: string;
  forceUpdate?: boolean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    console.log('🔧 Telnyx Configure Number - Starting');
    console.log('📋 Environment check:', {
      hasApiKey: !!TELNYX_API_KEY,
      connectionId: TELNYX_CONNECTION_ID || 'NOT SET',
      smsProfileId: TELNYX_SMS_PROFILE_ID || 'NOT SET'
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authorization required');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) throw new Error('Unauthorized');

    const body: ConfigureRequest = await req.json();
    const { phoneNumber, locationId, tenantId, forceUpdate = false } = body;

    if (!phoneNumber) throw new Error('phoneNumber is required');
    if (!tenantId) throw new Error('tenantId is required');

    console.log('📞 Configuring number:', { phoneNumber, locationId, tenantId, forceUpdate });

    // Step 1: Find the number in Telnyx
    console.log('🔍 Step 1: Looking up number in Telnyx...');
    const listResponse = await fetch(
      `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error('❌ Failed to find number:', listResponse.status, errorText);
      throw new Error(`Failed to find number in Telnyx: ${errorText}`);
    }

    const listData = await listResponse.json();
    const numberRecord = listData.data?.[0];

    if (!numberRecord) {
      console.error('❌ Number not found in account:', phoneNumber);
      throw new Error(`Number ${phoneNumber} not found in your Telnyx account`);
    }

    console.log('✅ Found number record:', {
      id: numberRecord.id,
      phoneNumber: numberRecord.phone_number,
      status: numberRecord.status,
      currentConnectionId: numberRecord.connection_id || 'NONE',
      currentMessagingProfileId: numberRecord.messaging_profile_id || 'NONE'
    });

    // Step 2: Build the update payload
    console.log('🔧 Step 2: Building update payload...');
    const updatePayload: Record<string, any> = {
      tags: ['pitch-crm', 'configured', new Date().toISOString().split('T')[0]]
    };

    // Add connection ID for voice
    if (TELNYX_CONNECTION_ID) {
      updatePayload.connection_id = TELNYX_CONNECTION_ID;
      console.log('📞 Setting voice connection ID:', TELNYX_CONNECTION_ID);
    } else {
      console.warn('⚠️ TELNYX_CONNECTION_ID not set - voice calls may not work');
    }

    // Add messaging profile ID for SMS
    if (TELNYX_SMS_PROFILE_ID) {
      updatePayload.messaging_profile_id = TELNYX_SMS_PROFILE_ID;
      console.log('💬 Setting messaging profile ID:', TELNYX_SMS_PROFILE_ID);
    } else {
      console.warn('⚠️ TELNYX_SMS_PROFILE_ID not set - SMS will not work');
    }

    console.log('📦 Update payload:', JSON.stringify(updatePayload, null, 2));

    // Step 3: Update the number in Telnyx
    console.log('📤 Step 3: Sending update to Telnyx...');
    const updateResponse = await fetch(
      `https://api.telnyx.com/v2/phone_numbers/${numberRecord.id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    const updateResponseText = await updateResponse.text();
    console.log('📥 Telnyx response status:', updateResponse.status);
    console.log('📥 Telnyx response body:', updateResponseText);

    if (!updateResponse.ok) {
      console.error('❌ Failed to update number:', updateResponse.status, updateResponseText);
      throw new Error(`Failed to update number in Telnyx: ${updateResponseText}`);
    }

    let updateData;
    try {
      updateData = JSON.parse(updateResponseText);
    } catch (e) {
      console.error('Failed to parse response:', e);
      throw new Error('Invalid response from Telnyx');
    }

    const updatedNumber = updateData.data;
    console.log('✅ Number updated successfully:', {
      id: updatedNumber?.id,
      connectionId: updatedNumber?.connection_id || 'NONE',
      messagingProfileId: updatedNumber?.messaging_profile_id || 'NONE',
      status: updatedNumber?.status
    });

    // Step 4: Verify the messaging profile was assigned
    const messagingConfigured = updatedNumber?.messaging_profile_id === TELNYX_SMS_PROFILE_ID;
    const voiceConfigured = updatedNumber?.connection_id === TELNYX_CONNECTION_ID;

    console.log('📋 Configuration verification:', {
      messagingConfigured,
      voiceConfigured,
      expectedMessagingProfile: TELNYX_SMS_PROFILE_ID,
      actualMessagingProfile: updatedNumber?.messaging_profile_id,
      expectedConnectionId: TELNYX_CONNECTION_ID,
      actualConnectionId: updatedNumber?.connection_id
    });

    // Step 5: Update location in database if provided
    if (locationId) {
      console.log('💾 Step 5: Updating location in database...');
      const { error: updateError } = await supabase
        .from('locations')
        .update({
          telnyx_phone_number: phoneNumber,
          telnyx_messaging_profile_id: TELNYX_SMS_PROFILE_ID,
          telnyx_voice_app_id: TELNYX_CONNECTION_ID,
          phone_porting_status: 'active',
          phone_setup_metadata: {
            configured_at: new Date().toISOString(),
            configured_by: user.id,
            messaging_profile_id: TELNYX_SMS_PROFILE_ID,
            connection_id: TELNYX_CONNECTION_ID,
            telnyx_number_id: updatedNumber?.id
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', locationId);

      if (updateError) {
        console.error('❌ Failed to update location:', updateError);
      } else {
        console.log('✅ Location updated successfully');
      }
    }

    // Step 6: Log the activity
    await supabase.from('call_activity_log').insert({
      tenant_id: tenantId,
      location_id: locationId || null,
      from_number: phoneNumber,
      to_number: phoneNumber,
      activity: 'phone_number_reconfigured',
      status: 'completed',
      metadata: {
        telnyx_number_id: updatedNumber?.id,
        messaging_profile_id: updatedNumber?.messaging_profile_id,
        connection_id: updatedNumber?.connection_id,
        configured_by: user.id,
        voice_configured: voiceConfigured,
        messaging_configured: messagingConfigured
      }
    });

    console.log('✅ Configuration complete!');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Phone number configured successfully',
        phoneNumber,
        telnyxNumberId: updatedNumber?.id,
        configuration: {
          voice: {
            configured: voiceConfigured,
            connectionId: updatedNumber?.connection_id
          },
          messaging: {
            configured: messagingConfigured,
            profileId: updatedNumber?.messaging_profile_id
          }
        },
        warnings: [
          !voiceConfigured ? 'Voice connection may not be properly configured' : null,
          !messagingConfigured ? 'Messaging profile may not be properly configured' : null
        ].filter(Boolean)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Configure number error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        hint: 'Check that the TELNYX_SMS_PROFILE_ID secret is correctly set in Supabase'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
