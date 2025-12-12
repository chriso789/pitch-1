import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('Telnyx webhook:', payload.data?.event_type);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const event = payload.data;
    const eventType = event.event_type;
    const callControlId = event.payload?.call_control_id;
    const clientState = event.payload?.client_state;

    // Parse client_state (base64 encoded JSON with campaign_id, lead_id, etc.)
    let parsedClientState: any = {};
    if (clientState) {
      try {
        parsedClientState = JSON.parse(atob(clientState));
      } catch (e) {
        console.warn('Failed to parse client_state:', e);
      }
    }

    // Handle different event types
    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, event, parsedClientState);
        break;

      case 'call.answered':
        await handleCallAnswered(supabase, event, parsedClientState);
        
        // Start recording
        if (callControlId) {
          await startRecording(callControlId);
        }
        
        // Play IVR consent message
        await playConsentMessage(callControlId);
        break;

      case 'call.bridged':
        await handleCallBridged(supabase, event, parsedClientState);
        break;

      case 'call.hangup':
        await handleCallHangup(supabase, event, parsedClientState);
        break;

      case 'call.recording.saved':
        await handleRecordingSaved(supabase, event);
        break;

      default:
        console.log('Unhandled event:', eventType);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Event handlers
async function handleCallInitiated(supabase: any, event: any, clientState: any) {
  const callId = event.payload?.call_control_id;
  
  // Log event
  await supabase.from('call_events').insert({
    tenant_id: clientState.tenant_id,
    telnyx_call_control_id: callId,
    campaign_id: clientState.campaign_id,
    event_type: 'call.initiated',
    event_data: event,
    client_state: clientState,
  });

  // Update campaign metrics
  if (clientState.campaign_id) {
    await supabase.rpc('increment_campaign_attempts', {
      p_campaign_id: clientState.campaign_id
    });
  }
}

async function handleCallAnswered(supabase: any, event: any, clientState: any) {
  const callId = event.payload?.call_control_id;
  
  await supabase.from('call_events').insert({
    tenant_id: clientState.tenant_id,
    telnyx_call_control_id: callId,
    campaign_id: clientState.campaign_id,
    event_type: 'call.answered',
    event_data: event,
    client_state: clientState,
  });

  // Update calls table
  await supabase
    .from('calls')
    .update({ 
      status: 'answered',
      answered_at: new Date().toISOString()
    })
    .eq('telnyx_call_control_id', callId);

  if (clientState.campaign_id) {
    await supabase.rpc('increment_campaign_answered', {
      p_campaign_id: clientState.campaign_id
    });
  }
}

async function handleCallBridged(supabase: any, event: any, clientState: any) {
  const callId = event.payload?.call_control_id;
  
  await supabase.from('call_events').insert({
    tenant_id: clientState.tenant_id,
    telnyx_call_control_id: callId,
    campaign_id: clientState.campaign_id,
    event_type: 'call.bridged',
    event_data: event,
    client_state: clientState,
  });

  await supabase
    .from('calls')
    .update({ status: 'active' })
    .eq('telnyx_call_control_id', callId);

  if (clientState.campaign_id) {
    await supabase.rpc('increment_campaign_bridged', {
      p_campaign_id: clientState.campaign_id
    });
  }
}

async function handleCallHangup(supabase: any, event: any, clientState: any) {
  const callId = event.payload?.call_control_id;
  const duration = event.payload?.call_duration_secs;
  
  await supabase.from('call_events').insert({
    tenant_id: clientState.tenant_id,
    telnyx_call_control_id: callId,
    campaign_id: clientState.campaign_id,
    event_type: 'call.hangup',
    event_data: event,
    client_state: clientState,
  });

  await supabase
    .from('calls')
    .update({ 
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_seconds: duration
    })
    .eq('telnyx_call_control_id', callId);

  // Update campaign avg talk time
  if (clientState.campaign_id && duration) {
    await supabase.rpc('update_campaign_avg_talk_time', {
      p_campaign_id: clientState.campaign_id,
      p_duration: duration
    });
  }
}

async function handleRecordingSaved(supabase: any, event: any) {
  const callId = event.payload?.call_control_id;
  const recordingUrl = event.payload?.recording_urls?.mp3;
  const durationSeconds = event.payload?.recording_duration_secs;

  console.log('Recording saved:', { callId, recordingUrl, durationSeconds });

  if (recordingUrl) {
    // Update calls table
    await supabase
      .from('calls')
      .update({ recording_url: recordingUrl })
      .eq('telnyx_call_control_id', callId);

    // Get the call to find tenant_id and call_log_id
    const { data: call } = await supabase
      .from('calls')
      .select('id, tenant_id, contact_id')
      .eq('telnyx_call_control_id', callId)
      .single();

    if (call) {
      // Also insert into call_recordings table for the Recording Library
      const { error: recordingError } = await supabase
        .from('call_recordings')
        .insert({
          tenant_id: call.tenant_id,
          call_log_id: call.id,
          recording_url: recordingUrl,
          duration_seconds: durationSeconds || null,
          transcription_status: 'pending',
        });

      if (recordingError) {
        console.error('Error inserting call recording:', recordingError);
      } else {
        console.log('Call recording saved to call_recordings table');
      }
    }
  }
}

async function startRecording(callControlId: string) {
  const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
  
  await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      format: 'mp3',
      channels: 'dual',
    }),
  });
}

async function playConsentMessage(callControlId: string) {
  const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
  
  await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: 'This call may be recorded for quality assurance purposes.',
      voice: 'female',
      language: 'en-US',
    }),
  });
}
