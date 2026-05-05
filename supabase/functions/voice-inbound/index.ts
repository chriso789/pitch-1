import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
    const eventPayload = event.payload || {};
    const callControlId = eventPayload.call_control_id;
    const clientState = eventPayload.client_state;

    // Parse client_state (base64 encoded JSON with campaign_id, lead_id, etc.)
    let parsedClientState: any = {};
    if (clientState) {
      try {
        parsedClientState = JSON.parse(atob(clientState));
      } catch (e) {
        console.warn('Failed to parse client_state:', e);
      }
    }

    const inboundContext = await resolveInboundContext(supabase, event, parsedClientState);
    await logVoiceWebhookEvent(supabase, payload, event, inboundContext.tenantId);

    const isUncorrelatedInbound = inboundContext.locationId && !parsedClientState.campaign_id && !parsedClientState.call_id;

    // Handle different event types
    switch (eventType) {
      case 'call.initiated':
        if (isUncorrelatedInbound) {
          await upsertInboundCall(supabase, event, inboundContext, 'ringing');
          await answerInboundCall(callControlId);
        } else {
          await handleCallInitiated(supabase, event, parsedClientState);
        }
        break;

      case 'call.answered':
        if (isUncorrelatedInbound) {
          await upsertInboundCall(supabase, event, inboundContext, 'in-progress');
        } else {
          await handleCallAnswered(supabase, event, parsedClientState);
        }
        
        // Start recording
        if (callControlId) {
          await startRecording(callControlId);
        }
        
        // Play inbound greeting / voicemail prompt
        await playInboundGreeting(supabase, callControlId, inboundContext.tenantId);
        break;

      case 'call.bridged':
        await handleCallBridged(supabase, event, parsedClientState);
        break;

      case 'call.hangup':
        if (isUncorrelatedInbound) {
          await completeInboundCall(supabase, event, inboundContext);
        } else {
          await handleCallHangup(supabase, event, parsedClientState);
        }
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
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function resolveInboundContext(supabase: any, event: any, clientState: any) {
  const payload = event.payload || {};
  const fromNumber = extractPhone(payload.from || payload.from_number || payload.caller_id_number);
  const toNumber = extractPhone(payload.to || payload.to_number || payload.called_number);
  const toVariants = phoneVariants(toNumber);

  let location: any = null;
  if (toVariants.length) {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, tenant_id, manager_id, telnyx_phone_number')
      .in('telnyx_phone_number', toVariants)
      .limit(1)
      .maybeSingle();
    if (error) console.error('Location lookup failed:', error);
    location = data;
  }

  const tenantId = (clientState.tenant_id as string | undefined) || location?.tenant_id || null;
  let contactId: string | null = null;
  const callerLast10 = digitsOnly(fromNumber).slice(-10);

  if (tenantId && callerLast10) {
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`phone.ilike.%${callerLast10}%`)
      .limit(1)
      .maybeSingle();
    if (error) console.error('Contact lookup failed:', error);
    contactId = contact?.id || null;
  }

  return {
    tenantId,
    locationId: location?.id || null,
    locationName: location?.name || null,
    managerId: location?.manager_id || null,
    fromNumber,
    toNumber,
    contactId,
  };
}

async function logVoiceWebhookEvent(supabase: any, body: any, event: any, tenantId: string | null) {
  const { error } = await supabase.from('telnyx_webhook_events').insert({
    tenant_id: tenantId,
    kind: 'voice',
    event_type: event.event_type,
    telnyx_event_id: event.id || body?.meta?.event_id || null,
    occurred_at: event.occurred_at || event.created_at || null,
    payload: body,
  });
  if (error) console.error('Failed to audit voice webhook:', error);
}

async function upsertInboundCall(supabase: any, event: any, context: any, status: string) {
  if (!context.tenantId || !event.payload?.call_control_id) return;

  const callPayload = {
    tenant_id: context.tenantId,
    contact_id: context.contactId,
    from_number: context.fromNumber,
    to_number: context.toNumber,
    direction: 'inbound',
    status,
    telnyx_call_control_id: event.payload.call_control_id,
    telnyx_call_leg_id: event.payload.call_leg_id || null,
    location_id: context.locationId,
    call_type: 'inbound',
    raw_payload: { telnyx_event: event, location_name: context.locationName },
  };

  const { data: existing } = await supabase
    .from('calls')
    .select('id')
    .eq('telnyx_call_control_id', event.payload.call_control_id)
    .maybeSingle();

  const result = existing?.id
    ? await supabase.from('calls').update(callPayload).eq('id', existing.id).select('id').single()
    : await supabase.from('calls').insert(callPayload).select('id').single();

  if (result.error) {
    console.error('Failed to upsert inbound call:', result.error);
    return;
  }

  await upsertUnifiedInboxCall(supabase, result.data.id, context, status, event);
}

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
