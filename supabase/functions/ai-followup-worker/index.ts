// ============================================
// AI FOLLOW-UP WORKER
// Processes ai_outreach_queue to send automated SMS and calls
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, serverError } from '../_shared/http.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { normalizeE164 } from '../_shared/phone.ts';
import { sendTelnyxMessage, initiateCall } from '../_shared/telnyx.ts';
import { ENV } from '../_shared/env.ts';

interface WorkerRequest {
  limit?: number;
}

/**
 * Rule-based AI message generator
 * Replace with LLM call for more sophisticated responses
 */
function generateAiMessage(input: {
  contactName?: string | null;
  contactPhone: string;
  companyName?: string | null;
  lastInboundText?: string | null;
  touchNumber?: number;
}): string {
  const name = input.contactName?.split(' ')?.[0] ?? 'there';
  const company = input.companyName || 'us';
  const touch = input.touchNumber || 1;
  const last = (input.lastInboundText ?? '').toLowerCase();

  // Detect opt-out keywords
  if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].some(k => last.includes(k))) {
    return ''; // Don't send anything
  }

  // Reply-to-interest detection
  if (last.includes('price') || last.includes('cost') || last.includes('quote')) {
    return `Hey ${name} — pricing depends on the scope of work and materials. Want me to get you on the schedule for a free inspection so we can give you an accurate estimate?`;
  }

  if (last.includes('insurance') || last.includes('claim')) {
    return `Hey ${name} — we work with all major insurance companies and can help document everything properly. Would you like us to come take a look and help with the claims process?`;
  }

  if (last.includes('schedule') || last.includes('appointment') || last.includes('when')) {
    return `Hey ${name} — I'd be happy to get you scheduled! What day and time works best for you? We have openings this week.`;
  }

  if (last.includes('yes') || last.includes('interested') || last.includes('sure')) {
    return `Great to hear, ${name}! Let me connect you with one of our specialists who can answer your questions and get you scheduled. They'll reach out shortly!`;
  }

  // Standard follow-up sequences based on touch number
  const followUpMessages = [
    `Hey ${name}, this is ${company} following up. We wanted to make sure you got our previous message. Do you have any questions about your roof?`,
    `Hi ${name}, just checking in. We haven't heard back and wanted to see if you're still interested in a free roof inspection. Reply YES and we'll get you scheduled!`,
    `Hey ${name}, last check-in from ${company}. If you're not interested right now, no worries at all. Just reply STOP and we won't bother you again. Otherwise, we're here when you're ready!`,
  ];

  const messageIndex = Math.min(touch - 1, followUpMessages.length - 1);
  return followUpMessages[messageIndex];
}

/**
 * Check if current time is within working hours
 */
function isWithinWorkingHours(workingHours: {
  tz: string;
  days: number[];
  start: string;
  end: string;
}): boolean {
  try {
    const now = new Date();
    
    // Get current time in configured timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: workingHours.tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const weekday = parts.find(p => p.type === 'weekday')?.value;
    
    // Map weekday to number (0=Sun, 1=Mon, etc.)
    const dayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    const currentDay = dayMap[weekday || 'Mon'] ?? 1;
    
    // Check if today is a working day
    if (!workingHours.days.includes(currentDay)) {
      return false;
    }
    
    // Check time range
    const [startHour, startMin] = workingHours.start.split(':').map(Number);
    const [endHour, endMin] = workingHours.end.split(':').map(Number);
    
    const currentMinutes = hour * 60 + minute;
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch (err) {
    console.error('Error checking working hours:', err);
    return true; // Default to allow if error
  }
}

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method !== 'POST') return badRequest('POST only');

    const { limit = 25 } = (await req.json().catch(() => ({}))) as WorkerRequest;
    
    const admin = supabaseService();

    // Pull due queue rows
    const { data: queueRows, error: qErr } = await admin
      .from('ai_outreach_queue')
      .select(`
        id, tenant_id, contact_id, conversation_id, channel, 
        scheduled_for, attempts, state
      `)
      .eq('state', 'queued')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(limit);

    if (qErr) throw qErr;
    if (!queueRows?.length) {
      return json({ ok: true, processed: 0, message: 'No items in queue' });
    }

    console.log(`Processing ${queueRows.length} queue items`);

    let processed = 0;
    let failed = 0;

    for (const row of queueRows) {
      // Lock row (optimistic locking)
      const { data: locked } = await admin
        .from('ai_outreach_queue')
        .update({ 
          state: 'running', 
          attempts: (row.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('state', 'queued')
        .select()
        .maybeSingle();

      if (!locked) {
        console.log(`Queue item ${row.id} already locked by another worker`);
        continue;
      }

      try {
        // Load AI agent config
        const { data: agent } = await admin
          .from('ai_agents')
          .select('id, enabled, location_id, working_hours, persona_prompt')
          .eq('tenant_id', row.tenant_id)
          .eq('enabled', true)
          .maybeSingle();

        if (!agent) {
          await admin.from('ai_outreach_queue').update({
            state: 'failed',
            last_error: 'AI agent not enabled for this tenant',
          }).eq('id', row.id);
          failed++;
          continue;
        }

        // Check working hours
        const workingHours = agent.working_hours as {
          tz: string;
          days: number[];
          start: string;
          end: string;
        };

        if (!isWithinWorkingHours(workingHours)) {
          // Reschedule for next business hour
          console.log(`Queue item ${row.id} outside working hours, rescheduling`);
          await admin.from('ai_outreach_queue').update({
            state: 'queued',
            scheduled_for: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // +2 hours
          }).eq('id', row.id);
          continue;
        }

        // Get location config
        const locationId = agent.location_id;
        let fromNumber: string | null = null;
        let connectionId: string | null = null;

        if (locationId) {
          const { data: location } = await admin
            .from('locations')
            .select('id, telnyx_phone_number, telnyx_connection_id')
            .eq('id', locationId)
            .eq('tenant_id', row.tenant_id)
            .single();

          if (location) {
            fromNumber = location.telnyx_phone_number;
            connectionId = location.telnyx_connection_id;
          }
        }

        // Fallback to any location with phone
        if (!fromNumber) {
          const { data: anyLoc } = await admin
            .from('locations')
            .select('id, telnyx_phone_number, telnyx_connection_id')
            .eq('tenant_id', row.tenant_id)
            .not('telnyx_phone_number', 'is', null)
            .limit(1)
            .maybeSingle();

          if (anyLoc) {
            fromNumber = anyLoc.telnyx_phone_number;
            connectionId = anyLoc.telnyx_connection_id;
          }
        }

        // Use env defaults
        fromNumber = fromNumber || ENV.TELNYX_PHONE_NUMBER;
        connectionId = connectionId || ENV.TELNYX_CONNECTION_ID;

        if (!fromNumber) {
          throw new Error('No from number configured for AI agent');
        }

        // Load contact
        const { data: contact } = await admin
          .from('contacts')
          .select('id, first_name, last_name, phone')
          .eq('id', row.contact_id)
          .eq('tenant_id', row.tenant_id)
          .single();

        if (!contact?.phone) {
          throw new Error('Contact not found or missing phone');
        }

        // Load tenant/company name
        const { data: tenant } = await admin
          .from('tenants')
          .select('name')
          .eq('id', row.tenant_id)
          .single();

        // Get last inbound message for context
        const { data: lastMsg } = await admin
          .from('sms_messages')
          .select('body, direction')
          .eq('contact_id', row.contact_id)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const from = normalizeE164(fromNumber);
        const to = normalizeE164(contact.phone);

        // Get or create conversation if not set
        let conversationId = row.conversation_id;
        if (!conversationId) {
          const { data: convId } = await admin.rpc('rpc_create_or_get_conversation', {
            _tenant_id: row.tenant_id,
            _contact_id: row.contact_id,
            _channel: row.channel,
            _location_id: locationId || null,
          });
          conversationId = convId;
          
          await admin.from('ai_outreach_queue')
            .update({ conversation_id: conversationId })
            .eq('id', row.id);
        }

        // Process based on channel
        if (row.channel === 'sms') {
          const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
          
          const text = generateAiMessage({
            contactName,
            contactPhone: to,
            companyName: tenant?.name,
            lastInboundText: lastMsg?.body,
            touchNumber: row.attempts + 1,
          });

          // If empty (STOP detected), mark done without sending
          if (!text) {
            console.log(`Queue item ${row.id}: Detected opt-out, marking done`);
            await admin.from('ai_outreach_queue').update({ state: 'done' }).eq('id', row.id);
            processed++;
            continue;
          }

          // Send SMS
          const telnyxResp = await sendTelnyxMessage({
            from,
            to,
            text,
          });

          console.log(`AI SMS sent: ${telnyxResp.id}`);

          // Log message
          await admin.from('sms_messages').insert({
            tenant_id: row.tenant_id,
            contact_id: row.contact_id,
            conversation_id: conversationId,
            location_id: locationId,
            direction: 'outbound',
            from_number: from,
            to_number: to,
            body: text,
            status: 'sent',
            provider: 'telnyx',
            provider_message_id: telnyxResp.id,
            sent_at: new Date().toISOString(),
          });

          // Update conversation
          if (conversationId) {
            await admin.from('conversations')
              .update({ last_activity_at: new Date().toISOString() })
              .eq('id', conversationId);
          }

          await admin.from('ai_outreach_queue').update({ state: 'done' }).eq('id', row.id);
          processed++;
        } else if (row.channel === 'call') {
          if (!connectionId) {
            throw new Error('No Telnyx connection ID configured for AI calling');
          }

          // Create call record
          const { data: callRow } = await admin
            .from('calls')
            .insert({
              tenant_id: row.tenant_id,
              contact_id: row.contact_id,
              conversation_id: conversationId,
              location_id: locationId,
              direction: 'outbound',
              from_number: from,
              to_number: to,
              status: 'initiated',
              call_type: 'ai_followup',
            })
            .select('id')
            .single();

          const clientState = btoa(JSON.stringify({
            tenant_id: row.tenant_id,
            contact_id: row.contact_id,
            conversation_id: conversationId,
            call_id: callRow?.id,
            ai: true,
          }));

          const telnyxResp = await initiateCall({
            connection_id: connectionId,
            from,
            to,
            client_state: clientState,
          });

          console.log(`AI call initiated: ${telnyxResp.call_control_id}`);

          // Update call record
          if (callRow?.id) {
            await admin.from('calls').update({
              telnyx_call_control_id: telnyxResp.call_control_id,
              telnyx_call_leg_id: telnyxResp.call_leg_id,
              raw_payload: telnyxResp,
            }).eq('id', callRow.id);
          }

          // Update conversation
          if (conversationId) {
            await admin.from('conversations')
              .update({ last_activity_at: new Date().toISOString() })
              .eq('id', conversationId);
          }

          await admin.from('ai_outreach_queue').update({ state: 'done' }).eq('id', row.id);
          processed++;
        } else {
          throw new Error(`Unsupported channel: ${row.channel}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Queue item ${row.id} failed:`, msg);
        
        await admin.from('ai_outreach_queue').update({
          state: 'failed',
          last_error: msg,
        }).eq('id', row.id);
        
        failed++;
      }
    }

    return json({ 
      ok: true, 
      processed, 
      failed,
      message: `Processed ${processed} items, ${failed} failed`,
    });
  } catch (err) {
    return serverError(err);
  }
});
