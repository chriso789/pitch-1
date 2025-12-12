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

    const { 
      phoneNumber, 
      locationId, 
      tenantId,
      currentCarrier,
      accountNumber,
      accountPin,
      accountName,
      billingAddress,
      action = 'submit' // 'submit' or 'check_status'
    } = await req.json();

    // Check status of existing port request
    if (action === 'check_status') {
      const { data: portRequest } = await supabase
        .from('phone_port_requests')
        .select('*')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!portRequest?.telnyx_port_order_id) {
        return new Response(
          JSON.stringify({ success: true, status: 'no_request' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check status with Telnyx
      const statusResponse = await fetch(
        `https://api.telnyx.com/v2/porting_orders/${portRequest.telnyx_port_order_id}`,
        {
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        const telnyxStatus = statusData.data?.status;
        
        // Update our record
        await supabase
          .from('phone_port_requests')
          .update({
            status: mapTelnyxStatus(telnyxStatus),
            status_details: statusData.data?.status_details || telnyxStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', portRequest.id);

        // If completed, update the location
        if (telnyxStatus === 'ported') {
          await supabase
            .from('locations')
            .update({
              phone_porting_status: 'active',
              telnyx_messaging_profile_id: TELNYX_SMS_PROFILE_ID,
              telnyx_voice_app_id: TELNYX_CONNECTION_ID,
            })
            .eq('id', locationId);

          await supabase
            .from('phone_port_requests')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', portRequest.id);
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            status: statusData.data?.status,
            details: statusData.data,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, status: portRequest.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Submit new port request
    if (!phoneNumber || !locationId || !tenantId) {
      throw new Error('phoneNumber, locationId, and tenantId are required');
    }

    // Format phone number to E.164
    const formattedPhone = phoneNumber.replace(/\D/g, '');
    const e164Phone = formattedPhone.startsWith('1') ? `+${formattedPhone}` : `+1${formattedPhone}`;

    console.log(`Submitting port request for ${e164Phone}`);

    // Step 1: Create port request record in our database
    const { data: portRequest, error: insertError } = await supabase
      .from('phone_port_requests')
      .insert({
        tenant_id: tenantId,
        location_id: locationId,
        phone_number: e164Phone,
        current_carrier: currentCarrier,
        account_number: accountNumber,
        account_pin: accountPin,
        account_name: accountName,
        billing_address: billingAddress,
        status: 'draft',
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create port request record:', insertError);
      throw new Error('Failed to create port request');
    }

    // Step 2: Update location status to pending
    await supabase
      .from('locations')
      .update({
        telnyx_phone_number: e164Phone,
        phone_porting_status: 'pending_port',
        phone_setup_metadata: {
          setup_type: 'port',
          port_request_id: portRequest.id,
          initiated_at: new Date().toISOString(),
          initiated_by: user.id,
        },
      })
      .eq('id', locationId);

    // Step 3: Submit to Telnyx Porting API
    const portPayload = {
      phone_numbers: [e164Phone],
      connection_id: TELNYX_CONNECTION_ID,
      messaging_profile_id: TELNYX_SMS_PROFILE_ID,
      user_info: {
        first_name: accountName?.split(' ')[0] || 'Account',
        last_name: accountName?.split(' ').slice(1).join(' ') || 'Holder',
        phone: e164Phone,
        email: user.email,
      },
      authorization_info: {
        authorized_person_name: accountName,
        account_number: accountNumber,
        pin: accountPin,
        carrier_name: currentCarrier,
      },
    };

    if (billingAddress) {
      portPayload.user_info = {
        ...portPayload.user_info,
        street_address: billingAddress.street,
        city: billingAddress.city,
        state_code: billingAddress.state,
        zip: billingAddress.zip,
        country_code: 'US',
      };
    }

    const portResponse = await fetch('https://api.telnyx.com/v2/porting_orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(portPayload),
    });

    if (!portResponse.ok) {
      const errorText = await portResponse.text();
      console.error('Telnyx porting error:', portResponse.status, errorText);
      
      // Update our record with failure
      await supabase
        .from('phone_port_requests')
        .update({
          status: 'failed',
          status_details: `Telnyx error: ${errorText}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', portRequest.id);

      await supabase
        .from('locations')
        .update({ phone_porting_status: 'failed' })
        .eq('id', locationId);

      throw new Error(`Port request failed: ${errorText}`);
    }

    const portData = await portResponse.json();
    console.log('Port order created:', portData.data?.id);

    // Step 4: Update our records with Telnyx order ID
    await supabase
      .from('phone_port_requests')
      .update({
        telnyx_port_order_id: portData.data?.id,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        estimated_completion: portData.data?.foc_date,
        updated_at: new Date().toISOString(),
      })
      .eq('id', portRequest.id);

    await supabase
      .from('locations')
      .update({ phone_porting_status: 'port_submitted' })
      .eq('id', locationId);

    return new Response(
      JSON.stringify({
        success: true,
        portOrderId: portData.data?.id,
        estimatedCompletion: portData.data?.foc_date,
        message: 'Port request submitted successfully. You will receive email updates on the status.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Port request error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function mapTelnyxStatus(telnyxStatus: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'submitted',
    'submitted': 'submitted',
    'in_progress': 'in_progress',
    'ported': 'completed',
    'port_completed': 'completed',
    'cancelled': 'cancelled',
    'failed': 'failed',
  };
  return statusMap[telnyxStatus] || 'in_progress';
}
