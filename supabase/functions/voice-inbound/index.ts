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
        
        // Run inbound AI qualification only for organic inbound calls
        if (isUncorrelatedInbound) {
          await playInboundGreeting(supabase, callControlId, inboundContext.tenantId);
        }
        break;

      case 'call.ai_gather.partial_results':
      case 'call.ai_gather.message_history_updated':
        await mergeCallRawPayload(supabase, callControlId, {
          inbound_ai_progress: event.payload,
          inbound_ai_progress_at: new Date().toISOString(),
        });
        break;

      case 'call.ai_gather.ended':
        await handleInboundAIGatherEnded(supabase, event, inboundContext);
        await playVoicemailPrompt(callControlId);
        break;

      case 'call.speak.ended':
        if (parsedClientState?.flow === 'inbound_voicemail_prompt') {
          await playVoicemailTone(callControlId);
        }
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

async function upsertUnifiedInboxCall(supabase: any, callId: string, context: any, status: string, event: any) {
  if (!context.tenantId) return;

  const content = status === 'completed'
    ? `Inbound call completed from ${context.fromNumber || 'unknown caller'}`
    : `Inbound call from ${context.fromNumber || 'unknown caller'}`;

  const { data: existing } = await supabase
    .from('unified_inbox')
    .select('id')
    .eq('tenant_id', context.tenantId)
    .eq('channel', 'call')
    .contains('metadata', { telnyx_call_control_id: event.payload.call_control_id })
    .maybeSingle();

  const inboxPayload = {
    tenant_id: context.tenantId,
    contact_id: context.contactId,
    channel: 'call',
    direction: 'inbound',
    content,
    subject: context.locationName ? `Inbound call — ${context.locationName}` : 'Inbound call',
    phone_number: context.fromNumber,
    is_read: false,
    assigned_to: context.managerId,
    metadata: {
      calls_table_id: callId,
      telnyx_call_control_id: event.payload.call_control_id,
      to_number: context.toNumber,
      status,
      location_id: context.locationId,
      location_name: context.locationName,
    },
  };

  const result = existing?.id
    ? await supabase.from('unified_inbox').update(inboxPayload).eq('id', existing.id)
    : await supabase.from('unified_inbox').insert(inboxPayload);

  if (result.error) console.error('Failed to upsert unified inbox call:', result.error);
}

async function completeInboundCall(supabase: any, event: any, context: any) {
  const callControlId = event.payload?.call_control_id;
  if (!context.tenantId || !callControlId) return;

  const duration = event.payload?.call_duration_secs || event.payload?.duration_secs || null;
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
      raw_payload: { telnyx_event: event, location_name: context.locationName },
    })
    .eq('telnyx_call_control_id', callControlId);

  if (error) console.error('Failed to complete inbound call:', error);
  const { data: call } = await supabase
    .from('calls')
    .select('id')
    .eq('telnyx_call_control_id', callControlId)
    .maybeSingle();

  await upsertUnifiedInboxCall(supabase, call?.id || callControlId, context, 'completed', event);
}

async function answerInboundCall(callControlId?: string) {
  if (!callControlId) return;
  const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
  if (!TELNYX_API_KEY) return;

  const response = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    console.error('Failed to answer inbound call:', response.status, await response.text());
  }
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
          call_log_id: null,
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

async function handleInboundAIGatherEnded(supabase: any, event: any, context: any) {
  const callControlId = event.payload?.call_control_id;
  if (!callControlId) return;

  const gatheredData = event.payload?.result || event.payload?.parameters || event.payload?.collected || event.payload?.data || null;
  const messageHistory = event.payload?.message_history || event.payload?.messages || null;
  const summaryParts = formatGatheredLeadSummary(gatheredData);

  const updatePayload: Record<string, unknown> = {
    raw_payload: {
      telnyx_event: event,
      location_name: context.locationName,
      inbound_ai_qualification: gatheredData,
      inbound_ai_message_history: messageHistory,
    },
  };

  if (summaryParts.length) {
    updatePayload.notes = `AI qualification:\n${summaryParts.join('\n')}`;
  }

  const { error } = await supabase
    .from('calls')
    .update(updatePayload)
    .eq('telnyx_call_control_id', callControlId);
  if (error) console.error('Failed to save inbound AI gather result:', error);

  await upsertUnifiedInboxCall(supabase, callControlId, context, 'qualified', event);
}

function formatGatheredLeadSummary(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([key, v]) => `- ${key.replace(/_/g, ' ')}: ${String(v)}`);
}

async function mergeCallRawPayload(supabase: any, callControlId: string | undefined, patch: Record<string, unknown>) {
  if (!callControlId) return;
  const { data: call } = await supabase
    .from('calls')
    .select('raw_payload')
    .eq('telnyx_call_control_id', callControlId)
    .maybeSingle();

  await supabase
    .from('calls')
    .update({ raw_payload: { ...(call?.raw_payload || {}), ...patch } })
    .eq('telnyx_call_control_id', callControlId);
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

async function playInboundGreeting(supabase: any, callControlId: string | undefined, tenantId: string | null) {
  if (!callControlId) return;
  const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
  if (!TELNYX_API_KEY) return;

  // Use Telnyx Gather Using AI so the caller is actually asked each required question.
  let aiGatherStarted = false;
  if (tenantId) {
    const { data: aiAgent } = await supabase
      .from('ai_agents')
      .select('enabled, persona_prompt, safety_prompt')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: aiConfig } = await supabase
      .from('ai_answering_config')
      .select('greeting_text, enabled, qualification_questions')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (aiAgent?.enabled || aiConfig?.enabled) {
      const companyGreeting = aiConfig?.greeting_text || '';
      const qualificationQuestions = aiConfig?.qualification_questions || '';

      const instructions = `${aiAgent?.persona_prompt || 'You are a friendly and professional virtual receptionist for a roofing and construction company.'}

Ask one question at a time and wait for the caller's answer before continuing. Confirm unclear answers briefly, then move to the next missing required field. Do not skip required fields. Keep responses concise and natural.

Required call flow:
1. Greet the caller warmly.
2. Ask for their full name.
3. Ask what they are calling about, such as roof repair, new roof, storm damage, insurance claim, estimate request, leak, gutters, siding, or another construction need.
4. Ask for the property address.
5. Ask for the best callback number, especially if different from the number they called from.
6. Ask how urgent the issue is and whether there is active leaking or storm damage.
${qualificationQuestions ? `7. Also gather these additional details: ${qualificationQuestions}` : ''}

${aiAgent?.safety_prompt || 'Never provide pricing or estimates. Never make promises about timelines. Never share internal company information. If the caller asks something you cannot answer, say the team will follow up.'}`;

      try {
        const aiResponse = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_ai`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              greeting: companyGreeting || 'Thank you for calling. I’m the virtual receptionist. I’ll ask a few quick questions so the team can follow up properly. First, may I have your full name?',
              assistant: { instructions },
              voice: 'Telnyx.KokoroTTS.af',
              user_response_timeout_ms: 15000,
              send_partial_results: true,
              send_message_history_updates: true,
              client_state: btoa(JSON.stringify({ flow: 'inbound_ai_qualification', tenant_id: tenantId })),
              gather_ended_speech: 'Thanks, I have the information I need. Someone from our team will follow up with you shortly. You can leave any additional details after the tone.',
              parameters: buildInboundGatherSchema(qualificationQuestions),
            }),
          }
        );

        if (aiResponse.ok) {
          aiGatherStarted = true;
          console.log('[voice-inbound] AI gather started on inbound call');
        } else {
          const errText = await aiResponse.text();
          console.error('[voice-inbound] AI gather start failed:', aiResponse.status, errText);
        }
      } catch (err) {
        console.error('[voice-inbound] AI gather error:', err);
      }
    }
  }

  // Fallback: play simple greeting if AI gather didn't start
  if (!aiGatherStarted) {
    let greeting = 'Thank you for calling. Please leave your name, property address, callback number, and what you are calling about after the tone.';
    if (tenantId) {
      const { data: aiConfig } = await supabase
        .from('ai_answering_config')
        .select('greeting_text')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (aiConfig?.greeting_text) greeting = `${aiConfig.greeting_text} Please leave your name, property address, callback number, and what you are calling about after the tone.`;
    }

    await speak(callControlId, greeting, { flow: 'inbound_voicemail_prompt' });
  }
}

function extractPhone(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return normalizePhone(value);
  if (typeof value === 'object') {
    const candidate = (value as Record<string, unknown>).phone_number
      || (value as Record<string, unknown>).number
      || (value as Record<string, unknown>).sip_address;
    return typeof candidate === 'string' ? normalizePhone(candidate) : '';
  }
  return '';
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  const digits = digitsOnly(cleaned);
  if (cleaned.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return cleaned;
}

function digitsOnly(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

function phoneVariants(phone: string): string[] {
  const digits = digitsOnly(phone);
  const variants = new Set<string>();
  if (phone) variants.add(phone);
  if (digits.length === 10) variants.add(`+1${digits}`);
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add(`+${digits}`);
    variants.add(digits.slice(1));
  }
  variants.add(digits);
  return [...variants].filter(Boolean);
}
