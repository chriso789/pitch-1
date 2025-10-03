import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { messageId } = await req.json();

    // Fetch message from queue
    const { data: message, error: fetchError } = await supabaseClient
      .from('message_queue')
      .select('*, messaging_providers(*)')
      .eq('id', messageId)
      .single();

    if (fetchError) throw fetchError;
    if (!message) throw new Error('Message not found');

    // Update status to sending
    await supabaseClient
      .from('message_queue')
      .update({ status: 'sending' })
      .eq('id', messageId);

    // Get Twilio credentials from secrets
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      throw new Error('Twilio credentials not configured');
    }

    // Send SMS via Twilio
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: message.recipient,
          From: twilioPhoneNumber,
          Body: message.message_body,
        }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      // Update message as sent
      await supabaseClient
        .from('message_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: result.sid,
          metadata: { ...message.metadata, twilioResponse: result },
        })
        .eq('id', messageId);

      return new Response(
        JSON.stringify({ success: true, messageSid: result.sid }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Update message as failed
      await supabaseClient
        .from('message_queue')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_message: result.message || 'Unknown error',
          retry_count: message.retry_count + 1,
        })
        .eq('id', messageId);

      throw new Error(result.message || 'Failed to send SMS');
    }
  } catch (error) {
    console.error('Error in messaging-send-sms:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
