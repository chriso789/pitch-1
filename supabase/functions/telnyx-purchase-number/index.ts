import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const TELNYX_CONNECTION_ID = Deno.env.get('TELNYX_CONNECTION_ID');
    const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');
    
    if (!TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authorization required');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) throw new Error('Unauthorized');

    const { phoneNumber, locationId, tenantId } = await req.json();

    if (!phoneNumber || !locationId || !tenantId) {
      throw new Error('phoneNumber, locationId, and tenantId are required');
    }

    console.log(`Purchasing number ${phoneNumber} for location ${locationId}`);

    // Step 1: Purchase the phone number
    const orderResponse = await fetch('https://api.telnyx.com/v2/number_orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_numbers: [{ phone_number: phoneNumber }],
        connection_id: TELNYX_CONNECTION_ID,
        messaging_profile_id: TELNYX_SMS_PROFILE_ID,
      }),
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      console.error('Telnyx order error:', orderResponse.status, errorText);
      throw new Error(`Failed to purchase number: ${errorText}`);
    }

    const orderData = await orderResponse.json();
    console.log('Number order created:', orderData.data?.id);

    // Step 2: Wait briefly then update the number's settings
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Configure the number for voice and messaging
    const configResponse = await fetch(
      `https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(phoneNumber)}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: TELNYX_CONNECTION_ID,
          messaging_profile_id: TELNYX_SMS_PROFILE_ID,
          tags: [`location:${locationId}`, `tenant:${tenantId}`],
        }),
      }
    );

    if (!configResponse.ok) {
      console.warn('Failed to configure number, may need manual setup');
    }

    // Step 4: Update the location record
    const { error: updateError } = await supabase
      .from('locations')
      .update({
        telnyx_phone_number: phoneNumber,
        telnyx_messaging_profile_id: TELNYX_SMS_PROFILE_ID,
        telnyx_voice_app_id: TELNYX_CONNECTION_ID,
        phone_porting_status: 'active',
        phone_setup_metadata: {
          setup_type: 'new_purchase',
          order_id: orderData.data?.id,
          purchased_at: new Date().toISOString(),
          purchased_by: user.id,
        },
      })
      .eq('id', locationId);

    if (updateError) {
      console.error('Failed to update location:', updateError);
      throw new Error('Number purchased but failed to update location record');
    }

    console.log(`Successfully purchased and configured ${phoneNumber}`);

    return new Response(
      JSON.stringify({
        success: true,
        phoneNumber,
        orderId: orderData.data?.id,
        message: 'Phone number purchased and configured successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Purchase number error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
