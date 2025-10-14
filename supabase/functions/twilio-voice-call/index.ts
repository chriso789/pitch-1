import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contactId, phoneNumber, pipelineEntryId } = await req.json();

    if (!contactId || !phoneNumber) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: contactId and phoneNumber' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Twilio credentials
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      throw new Error('Twilio credentials not configured');
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get auth header
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseClient.auth.getUser(token);

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get tenant_id
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.tenant_id;

    // Format phone number (remove any non-digits, ensure E.164 format)
    const cleanedNumber = phoneNumber.replace(/\D/g, '');
    const formattedNumber = cleanedNumber.startsWith('1') ? `+${cleanedNumber}` : `+1${cleanedNumber}`;

    // Create TwiML response URL for handling the call
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-call-status`;

    // Initiate call via Twilio
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: twilioPhoneNumber,
          To: formattedNumber,
          Url: `${statusCallbackUrl}?action=twiml`,
          StatusCallback: statusCallbackUrl,
          StatusCallbackEvent: 'initiated,ringing,answered,completed',
          StatusCallbackMethod: 'POST',
          Record: 'true',
          RecordingStatusCallback: statusCallbackUrl,
          RecordingStatusCallbackMethod: 'POST'
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Twilio API error:', result);
      throw new Error(result.message || 'Failed to initiate call');
    }

    // Create call log entry
    const { data: callLog, error: callLogError } = await supabaseClient
      .from('call_logs')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntryId,
        caller_id: twilioPhoneNumber,
        callee_number: formattedNumber,
        direction: 'outbound',
        status: 'initiated',
        call_sid: result.sid,
        created_by: user.id,
        metadata: {
          twilio_response: result
        }
      })
      .select()
      .single();

    if (callLogError) {
      console.error('Error creating call log:', callLogError);
      throw callLogError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        callSid: result.sid,
        callLog: callLog
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error initiating call:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
