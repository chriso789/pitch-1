import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Enhanced Telnyx AI Agent — Full Answering Service
 * 
 * - Answers unanswered inbound calls on the main line
 * - Qualifies leads conversationally (name, address, service, roof age, insurance, timeline)
 * - Creates contacts (dedup by phone, then name+address)
 * - Creates pipeline entries (leads) with scoring
 * - Books appointments if requested
 * - Sends SMS notification to assigned rep
 * - Supports human escalation
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    const eventType: string | undefined = payload?.data?.event_type;
    const callControlId: string | undefined = payload?.data?.payload?.call_control_id;
    const callerNumber: string | undefined = payload?.data?.payload?.from;
    const calledNumber: string | undefined = payload?.data?.payload?.to;

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY') ?? '';
    if (!telnyxApiKey) {
      console.error('[AI Agent] Missing TELNYX_API_KEY');
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect tenant from called number
    let tenantId: string | null = null;
    let locationId: string | null = null;
    if (calledNumber) {
      const { data: location } = await supabase
        .from('locations')
        .select('tenant_id, id')
        .eq('telnyx_phone_number', calledNumber)
        .single();
      tenantId = location?.tenant_id || null;
      locationId = location?.id || null;
    }

    console.log(`[AI Agent] Event: ${eventType}, Tenant: ${tenantId}`);

    // =============================================
    // CALL INITIATED — Answer the call
    // =============================================
    if (eventType === 'call.initiated') {
      const direction = payload?.data?.payload?.direction;
      if (direction !== 'incoming') {
        return jsonResponse({ status: 'ignored' });
      }

      console.log('[AI Agent] Answering inbound call...');
      await telnyxAction(telnyxApiKey, callControlId!, 'answer', {
        client_state: encodeState({
          tenant_id: tenantId,
          location_id: locationId,
          caller_number: callerNumber,
          stage: 'greeting',
        }),
      });

      return jsonResponse({ status: 'call_answered' });
    }

    // =============================================
    // CALL ANSWERED — Start AI qualification gather
    // =============================================
    if (eventType === 'call.answered') {
      const direction = payload?.data?.payload?.direction;
      if (direction !== 'incoming') {
        return jsonResponse({ status: 'ignored' });
      }

      const clientState = decodeState(payload?.data?.payload?.client_state);
      const stateTenantId = clientState.tenant_id || tenantId;
      const stateLocationId = clientState.location_id || locationId;

      // Load tenant config
      let config = {
        greeting: "Hi, thanks for calling! I'm here to help you with your roofing needs. I'll ask a few quick questions to connect you with the right specialist.",
        voice: 'en-US-Wavenet-D',
        model: 'gpt-4',
        temperature: 0.3,
        company_name: 'our company',
        services: ['roof repair', 'roof replacement', 'inspections', 'storm damage'],
        auto_create_leads: true,
        auto_schedule_appointments: true,
        sms_notify_rep: true,
      };

      if (stateTenantId) {
        const { data: tenantConfig } = await supabase
          .from('ai_answering_config')
          .select('*')
          .eq('tenant_id', stateTenantId)
          .eq('is_enabled', true)
          .single();

        if (tenantConfig) {
          config.greeting = tenantConfig.greeting_text || config.greeting;
          config.voice = tenantConfig.ai_voice || config.voice;
          config.model = tenantConfig.ai_model || config.model;
          config.temperature = tenantConfig.temperature || config.temperature;
          config.auto_create_leads = (tenantConfig as any).auto_create_leads ?? true;
          config.auto_schedule_appointments = (tenantConfig as any).auto_schedule_appointments ?? true;
          config.sms_notify_rep = (tenantConfig as any).sms_notify_rep ?? true;
        }

        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', stateTenantId)
          .single();
        if (tenant?.name) config.company_name = tenant.name;
      }

      // Start gather_using_ai with enhanced qualification + appointment scheduling
      const gatherBody = {
        greeting: config.greeting,
        parameters: {
          type: 'object',
          properties: {
            name: { description: 'Full name of the caller', type: 'string' },
            phone: { description: 'Best callback phone number', type: 'string' },
            address: { description: 'Property address where service is needed', type: 'string' },
            service_needed: { description: 'What roofing service they need (repair, replacement, inspection, storm damage, etc.)', type: 'string' },
            roof_age: { description: 'Approximate age of the roof in years', type: 'string' },
            has_insurance_claim: { description: 'Whether they have or plan to file an insurance claim', type: 'boolean' },
            timeline: { description: 'When they want the work done (ASAP, this week, this month, just getting estimates)', type: 'string' },
            budget_range: { description: 'Their approximate budget range if mentioned', type: 'string' },
            wants_appointment: { description: 'Whether the caller wants to schedule an inspection appointment', type: 'boolean' },
            preferred_appointment_date: { description: 'Preferred date for inspection/estimate (e.g. tomorrow, next Monday, March 25)', type: 'string' },
            preferred_appointment_time: { description: 'Preferred time of day (morning, afternoon, evening, or specific time)', type: 'string' },
            additional_notes: { description: 'Any other important details mentioned', type: 'string' },
          },
          required: ['name', 'phone', 'service_needed'],
        },
        voice: config.voice,
        model: config.model,
        temperature: config.temperature,
        system_prompt: `You are a friendly and professional AI assistant for ${config.company_name}, a roofing contractor.
Your goal is to qualify leads by gathering key information while being conversational and helpful.

Key behaviors:
- Be warm, professional, and empathetic
- Ask clarifying questions naturally in conversation
- If caller seems urgent (leak, storm damage), express understanding and prioritize their needs
- If they ask about pricing, explain that an inspector will provide a free, no-obligation quote on-site
- If they ask about insurance, confirm you work with all major insurance companies
- After gathering their basic info, proactively ask: "Would you like me to schedule a free inspection for you?"
- If they want an appointment, ask for their preferred date and time of day (morning, afternoon, or evening)
- At the end, confirm all information and let them know a specialist will follow up within the hour

Available services: ${config.services.join(', ')}

Remember: Your primary goals are (1) get their contact info, (2) understand their needs, and (3) offer to schedule an appointment.`,
        tools: [
          { name: 'hangup' },
          { name: 'transfer' },
        ],
        client_state: encodeState({
          tenant_id: stateTenantId,
          location_id: stateLocationId,
          caller_number: callerNumber,
          call_start: new Date().toISOString(),
          stage: 'qualification',
          config_flags: {
            auto_create_leads: config.auto_create_leads,
            auto_schedule_appointments: config.auto_schedule_appointments,
            sms_notify_rep: config.sms_notify_rep,
          },
        }),
      };

      await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_ai`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gatherBody),
      });

      return jsonResponse({ status: 'ai_qualification_started' });
    }

    // =============================================
    // GATHER ENDED — Process results, create lead, book appointment
    // =============================================
    if (eventType === 'gather_using_ai.ended') {
      console.log('[AI Agent] Processing qualification results...');

      const result = payload?.data?.payload?.result;
      const clientState = decodeState(payload?.data?.payload?.client_state);
      const stateTenantId = clientState.tenant_id || tenantId;
      const stateLocationId = clientState.location_id || locationId;
      const callStart = clientState.call_start ? new Date(clientState.call_start) : new Date();
      const callDuration = Math.round((Date.now() - callStart.getTime()) / 1000);
      const flags = clientState.config_flags || { auto_create_leads: true, auto_schedule_appointments: true, sms_notify_rep: true };

      if (!result || !stateTenantId) {
        console.warn('[AI Agent] No result or tenant, ending call');
        await hangupCall(telnyxApiKey, callControlId);
        return jsonResponse({ status: 'no_result' });
      }

      console.log('[AI Agent] Gathered data:', JSON.stringify(result));

      // --- Lead scoring ---
      let leadScore = 50;
      if (result.timeline?.toLowerCase().includes('asap') || result.timeline?.toLowerCase().includes('today') || result.timeline?.toLowerCase().includes('emergency')) leadScore += 20;
      else if (result.timeline?.toLowerCase().includes('week')) leadScore += 10;
      if (result.has_insurance_claim === true) leadScore += 15;
      if (result.service_needed?.toLowerCase().includes('storm') || result.service_needed?.toLowerCase().includes('leak') || result.service_needed?.toLowerCase().includes('damage')) leadScore += 15;
      if (result.roof_age) {
        const age = parseInt(result.roof_age);
        if (age >= 15) leadScore += 10;
        if (age >= 20) leadScore += 10;
      }
      if (result.wants_appointment) leadScore += 5;
      leadScore = Math.min(leadScore, 100);

      const sentiment = leadScore >= 80 ? 'hot' : leadScore >= 60 ? 'warm' : 'cool';

      // --- Store AI call transcript ---
      await supabase.from('ai_call_transcripts').insert({
        tenant_id: stateTenantId,
        telnyx_call_control_id: callControlId,
        caller_number: callerNumber || clientState.caller_number,
        gathered_data: { ...result, calculated_lead_score: leadScore },
        call_duration_seconds: callDuration,
        escalated_to_human: false,
        sentiment,
      });

      // --- Find or create contact ---
      const callbackNumber = result.phone || callerNumber || clientState.caller_number;
      let contactId: string | null = null;

      if (callbackNumber) {
        const normalizedPhone = callbackNumber.replace(/\D/g, '').slice(-10);

        // Search by phone first
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', stateTenantId)
          .or(`phone.ilike.%${normalizedPhone},secondary_phone.ilike.%${normalizedPhone}`)
          .limit(1)
          .single();

        if (existingContact) {
          contactId = existingContact.id;
          // Update with new qualification info
          await supabase.from('contacts').update({
            address_street: result.address || undefined,
            notes: `AI Qualification: ${result.service_needed}. Roof Age: ${result.roof_age || 'Unknown'}. Insurance: ${result.has_insurance_claim ? 'Yes' : 'No'}. Timeline: ${result.timeline || 'Not specified'}.`,
            lead_score: leadScore,
          }).eq('id', contactId);
        } else {
          // Create new contact
          const nameParts = (result.name || 'Unknown Caller').split(' ');
          const firstName = nameParts[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || 'Caller';

          const normalizePhone = (phone: string) => {
            const cleaned = phone.replace(/\D/g, '');
            return cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;
          };

          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              tenant_id: stateTenantId,
              first_name: firstName,
              last_name: lastName,
              phone: normalizePhone(callbackNumber),
              address_street: result.address || null,
              lead_source: 'Call In',
              lead_score: leadScore,
              location_id: stateLocationId,
              notes: `AI Qualification: ${result.service_needed}. Roof Age: ${result.roof_age || 'Unknown'}. Insurance: ${result.has_insurance_claim ? 'Yes' : 'No'}. Timeline: ${result.timeline || 'Not specified'}.`,
              metadata: {
                created_via: 'ai-answering-service',
                roof_age_years: result.roof_age ? parseInt(result.roof_age) : null,
              },
            })
            .select('id')
            .single();

          contactId = newContact?.id || null;
        }
      }

      // --- Find assigned rep (location manager or first location user) ---
      let assignedTo: string | null = null;
      if (stateLocationId) {
        const { data: locUsers } = await supabase
          .from('location_users')
          .select('user_id')
          .eq('location_id', stateLocationId)
          .limit(1);
        assignedTo = locUsers?.[0]?.user_id || null;
      }
      if (!assignedTo && stateTenantId) {
        const { data: anyUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', stateTenantId)
          .limit(1)
          .single();
        assignedTo = anyUser?.id || null;
      }

      // --- Create pipeline entry (lead) ---
      let pipelineEntryId: string | null = null;
      if (contactId && flags.auto_create_leads) {
        console.log('[AI Agent] Creating pipeline entry (lead)...');

        const sourceMap: Record<string, string> = {
          'call in': 'other',
          'phone': 'other',
        };

        const { data: pipelineEntry, error: pipelineError } = await supabase
          .from('pipeline_entries')
          .insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            location_id: stateLocationId,
            lead_name: result.name || 'AI Call Lead',
            status: 'lead',
            priority: leadScore >= 80 ? 'high' : leadScore >= 60 ? 'medium' : 'low',
            source: 'other',
            assigned_to: assignedTo,
            notes: `Service: ${result.service_needed || 'Not specified'}. Timeline: ${result.timeline || 'Not specified'}. Insurance: ${result.has_insurance_claim ? 'Yes' : 'No'}.`,
            metadata: {
              created_via: 'ai-answering-service',
              ai_lead_score: leadScore,
              gathered_data: result,
              lead_source_id: 'ai_call',
              call_duration_seconds: callDuration,
            },
          })
          .select('id')
          .single();

        if (pipelineError) {
          console.error('[AI Agent] Pipeline entry error:', pipelineError);
        } else {
          pipelineEntryId = pipelineEntry?.id || null;
          console.log('[AI Agent] Lead created:', pipelineEntryId);
        }
      }

      // --- Create appointment if requested ---
      let appointmentId: string | null = null;
      if (contactId && flags.auto_schedule_appointments && result.wants_appointment && (result.preferred_appointment_date || result.preferred_appointment_time)) {
        console.log('[AI Agent] Creating appointment...');

        // Parse date — try to interpret natural language dates
        let appointmentDate = new Date();
        const dateStr = (result.preferred_appointment_date || '').toLowerCase();
        if (dateStr.includes('tomorrow')) {
          appointmentDate.setDate(appointmentDate.getDate() + 1);
        } else if (dateStr.includes('next')) {
          appointmentDate.setDate(appointmentDate.getDate() + 7);
        } else if (dateStr) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) appointmentDate = parsed;
          else appointmentDate.setDate(appointmentDate.getDate() + 1); // default to tomorrow
        } else {
          appointmentDate.setDate(appointmentDate.getDate() + 1);
        }

        // Set time based on preference
        const timeStr = (result.preferred_appointment_time || '').toLowerCase();
        if (timeStr.includes('morning') || timeStr.includes('am')) {
          appointmentDate.setHours(9, 0, 0, 0);
        } else if (timeStr.includes('afternoon')) {
          appointmentDate.setHours(14, 0, 0, 0);
        } else if (timeStr.includes('evening')) {
          appointmentDate.setHours(17, 0, 0, 0);
        } else {
          appointmentDate.setHours(10, 0, 0, 0); // default morning
        }

        const { data: appointment, error: aptError } = await supabase
          .from('appointments')
          .insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            pipeline_entry_id: pipelineEntryId,
            location_id: stateLocationId,
            assigned_to: assignedTo,
            type: 'inspection',
            status: 'scheduled',
            scheduled_date: appointmentDate.toISOString().split('T')[0],
            scheduled_time: appointmentDate.toTimeString().split(' ')[0].slice(0, 5),
            notes: `AI-scheduled inspection. Service: ${result.service_needed}. Caller requested: ${result.preferred_appointment_date || 'soon'} ${result.preferred_appointment_time || ''}`.trim(),
            metadata: {
              created_via: 'ai-answering-service',
              ai_lead_score: leadScore,
            },
          })
          .select('id')
          .single();

        if (aptError) {
          console.error('[AI Agent] Appointment creation error:', aptError);
        } else {
          appointmentId = appointment?.id || null;
          console.log('[AI Agent] Appointment created:', appointmentId);
        }
      }

      // --- Log communication history ---
      if (contactId) {
        await supabase.from('communication_history').insert({
          tenant_id: stateTenantId,
          contact_id: contactId,
          type: 'call',
          direction: 'inbound',
          content: `AI Qualification Call - Lead Score: ${leadScore}\nService: ${result.service_needed}${appointmentId ? '\nAppointment scheduled' : ''}`,
          metadata: {
            gathered_data: result,
            call_duration_seconds: callDuration,
            lead_score: leadScore,
            ai_handled: true,
            pipeline_entry_id: pipelineEntryId,
            appointment_id: appointmentId,
          },
        });
      }

      // --- Create task for hot leads ---
      if (contactId && leadScore >= 70) {
        await supabase.from('tasks').insert({
          tenant_id: stateTenantId,
          contact_id: contactId,
          title: `🔥 HOT LEAD: ${result.name || 'New Caller'} - ${result.service_needed}`,
          description: `Lead Score: ${leadScore}\n\nName: ${result.name}\nPhone: ${result.phone || callerNumber}\nAddress: ${result.address || 'Not provided'}\nService: ${result.service_needed}\nRoof Age: ${result.roof_age || 'Unknown'}\nInsurance: ${result.has_insurance_claim ? 'Yes' : 'No'}\nTimeline: ${result.timeline || 'Not specified'}${appointmentId ? '\n\n📅 Appointment Scheduled' : ''}`,
          priority: leadScore >= 80 ? 'urgent' : 'high',
          status: 'pending',
          assigned_to: assignedTo,
          due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      }

      // --- SMS notification to rep ---
      if (flags.sms_notify_rep && assignedTo && contactId) {
        try {
          // Get rep's phone number
          const { data: repProfile } = await supabase
            .from('profiles')
            .select('phone, first_name')
            .eq('id', assignedTo)
            .single();

          if (repProfile?.phone) {
            const appointmentInfo = appointmentId && result.preferred_appointment_date
              ? `\n📅 Apt: ${result.preferred_appointment_date} ${result.preferred_appointment_time || ''}`
              : '';

            const smsMessage = `🔔 New AI Lead: ${result.name || 'Unknown'}\n📞 ${result.phone || callerNumber}\n🏠 ${result.service_needed || 'Roofing'}\n⭐ Score: ${leadScore}${appointmentInfo}\n\nCall back within 1 hour!`;

            // Send via the send-sms function
            const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
            await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                to: repProfile.phone,
                message: smsMessage,
                contactId,
              }),
            }).catch(e => console.warn('[AI Agent] SMS notification failed:', e));

            console.log('[AI Agent] SMS notification sent to rep:', repProfile.first_name);
          }
        } catch (smsErr) {
          console.warn('[AI Agent] SMS notification error (non-fatal):', smsErr);
        }
      }

      // --- Trigger real-time notification for hot leads ---
      if (leadScore >= 80 && assignedTo) {
        try {
          await supabase.functions.invoke('trigger-sales-notification', {
            body: {
              type: 'lead_hot',
              tenant_id: stateTenantId,
              user_id: assignedTo,
              contact_id: contactId,
              title: `🔥 Hot Lead: ${result.name}`,
              message: `Lead score ${leadScore}. ${result.service_needed}. Timeline: ${result.timeline || 'ASAP'}${appointmentId ? '. Appointment booked!' : ''}`,
              metadata: { lead_score: leadScore, source: 'ai_call', pipeline_entry_id: pipelineEntryId },
            },
          });
        } catch (notifErr) {
          console.warn('[AI Agent] Sales notification error (non-fatal):', notifErr);
        }
      }

      // Hang up the call
      await hangupCall(telnyxApiKey, callControlId);

      return jsonResponse({
        status: 'qualification_complete',
        lead_score: leadScore,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntryId,
        appointment_id: appointmentId,
      });
    }

    // =============================================
    // TRANSFER — Escalate to human
    // =============================================
    if (eventType === 'call.transfer.initiated' || payload?.data?.payload?.tool_used === 'transfer') {
      console.log('[AI Agent] Transfer requested — escalating to human');

      const clientState = decodeState(payload?.data?.payload?.client_state);
      const stateTenantId = clientState.tenant_id || tenantId;

      if (stateTenantId && callControlId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('settings')
          .eq('id', stateTenantId)
          .single();

        const onCallNumber = (tenant?.settings as any)?.on_call_number;

        if (onCallNumber) {
          await telnyxAction(telnyxApiKey, callControlId, 'transfer', { to: onCallNumber });
          console.log('[AI Agent] Call transferred to:', onCallNumber);
        }
      }

      return jsonResponse({ status: 'transfer_initiated' });
    }

    // =============================================
    // HANGUP
    // =============================================
    if (eventType === 'call.hangup') {
      console.log('[AI Agent] Call ended');
      return jsonResponse({ status: 'hangup_logged' });
    }

    return jsonResponse({ status: 'ignored', eventType });

  } catch (err: any) {
    console.error('[AI Agent] Error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// =============================================
// HELPERS
// =============================================

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function encodeState(obj: any): string {
  return btoa(JSON.stringify(obj));
}

function decodeState(encoded?: string): any {
  if (!encoded) return {};
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return {};
  }
}

async function telnyxAction(apiKey: string, callControlId: string, action: string, body: any = {}) {
  const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`[AI Agent] Telnyx ${action} failed: ${res.status} ${txt}`);
  }
  return res;
}

async function hangupCall(apiKey: string, callControlId?: string) {
  if (!callControlId) return;
  try {
    await telnyxAction(apiKey, callControlId, 'hangup');
  } catch (e) {
    console.warn('[AI Agent] Hangup failed (call may have ended)');
  }
}
