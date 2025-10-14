import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Handle TwiML request
    if (action === 'twiml') {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting your call, please wait.</Say>
  <Dial record="record-from-answer" recordingStatusCallback="${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-call-status" recordingStatusCallbackMethod="POST">
  </Dial>
</Response>`;

      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
      });
    }

    // Handle status callback
    const contentType = req.headers.get('content-type') || '';
    
    if (!contentType.includes('application/x-www-form-urlencoded')) {
      return new Response('Invalid content type', { status: 400 });
    }

    const formData = await req.formData();
    const callSid = formData.get('CallSid') as string;
    const callStatus = formData.get('CallStatus') as string;
    const callDuration = formData.get('CallDuration') as string;
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingSid = formData.get('RecordingSid') as string;

    console.log('Twilio callback:', { callSid, callStatus, callDuration, recordingUrl });

    if (!callSid) {
      return new Response('Missing CallSid', { status: 400 });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find the call log entry
    const { data: callLog } = await supabaseClient
      .from('call_logs')
      .select('*')
      .eq('call_sid', callSid)
      .single();

    if (!callLog) {
      console.error('Call log not found for SID:', callSid);
      return new Response('Call log not found', { status: 404 });
    }

    // Prepare update data
    const updateData: any = {
      status: callStatus.toLowerCase(),
      updated_at: new Date().toISOString()
    };

    // Set timestamps based on status
    if (callStatus === 'in-progress' && !callLog.answered_at) {
      updateData.answered_at = new Date().toISOString();
      updateData.started_at = new Date().toISOString();
    } else if (['completed', 'failed', 'busy', 'no-answer'].includes(callStatus.toLowerCase()) && !callLog.ended_at) {
      updateData.ended_at = new Date().toISOString();
    }

    // Add duration if available
    if (callDuration) {
      updateData.duration_seconds = parseInt(callDuration);
    }

    // Add recording URL if available
    if (recordingUrl) {
      updateData.recording_url = recordingUrl;
      updateData.metadata = {
        ...callLog.metadata,
        recording_sid: recordingSid,
        recording_url: recordingUrl
      };
    }

    // Update call log
    const { error: updateError } = await supabaseClient
      .from('call_logs')
      .update(updateData)
      .eq('id', callLog.id);

    if (updateError) {
      console.error('Error updating call log:', updateError);
      throw updateError;
    }

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Error processing callback:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
