// ============================================
// TELNYX CALL WEBHOOK -- Receives call events from Telnyx
// Updates call records, stores recordings, handles AMD
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, serverError } from '../_shared/http.ts';
import { supabaseService } from '../_shared/supabase.ts';

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method !== 'POST') return badRequest('POST only');

    const body = await req.json();
    const event = body?.data;
    if (!event) return badRequest('Missing event data');

    const eventType = event.event_type;
    const payload = event.payload;

    if (!eventType || !payload) {
      return badRequest('Missing event_type or payload');
    }

    console.log(`[telnyx-call-webhook] Event: ${eventType}`);

    // Decode client_state to correlate back to our records
    let clientState: Record<string, string> = {};
    if (payload.client_state) {
      try {
        clientState = JSON.parse(atob(payload.client_state));
      } catch {
        console.warn('Failed to decode client_state');
      }
    }

    const callId = clientState.call_id;
    const admin = supabaseService();

    switch (eventType) {
      case 'call.initiated': {
        if (callId) {
          await admin.from('calls').update({
            status: 'initiated',
            telnyx_call_control_id: payload.call_control_id,
            telnyx_call_leg_id: payload.call_leg_id,
          }).eq('id', callId);
        }
        break;
      }

      case 'call.answered': {
        if (callId) {
          await admin.from('calls').update({
            status: 'in-progress',
            answered_at: new Date().toISOString(),
          }).eq('id', callId);
        }
        break;
      }

      case 'call.hangup': {
        if (callId) {
          const endedAt = new Date();
          // Calculate duration if we have answered_at
          const { data: callRow } = await admin
            .from('calls')
            .select('answered_at')
            .eq('id', callId)
            .single();

          let durationSeconds: number | null = null;
          if (callRow?.answered_at) {
            durationSeconds = Math.round(
              (endedAt.getTime() - new Date(callRow.answered_at).getTime()) / 1000
            );
          }

          await admin.from('calls').update({
            status: 'completed',
            ended_at: endedAt.toISOString(),
            duration_seconds: durationSeconds,
          }).eq('id', callId);
        }
        break;
      }

      case 'call.recording.saved': {
        const recordingUrl = payload.recording_urls?.mp3;
        if (callId && recordingUrl) {
          // Store the recording URL directly
          await admin.from('calls').update({
            recording_url: recordingUrl,
          }).eq('id', callId);

          console.log(`[telnyx-call-webhook] Recording saved for call ${callId}`);
        }
        break;
      }

      case 'call.machine.detection.ended': {
        const result = payload.result; // human | machine | not_sure
        if (callId) {
          await admin.from('calls').update({
            raw_payload: { amd_result: result },
          }).eq('id', callId);

          // Broadcast AMD result via Realtime for frontend to react
          if (clientState.tenant_id) {
            const channel = admin.channel(`amd-${callId}`);
            await channel.send({
              type: 'broadcast',
              event: 'amd_result',
              payload: { call_id: callId, result },
            });
          }
        }
        break;
      }

      default:
        console.log(`[telnyx-call-webhook] Unhandled event: ${eventType}`);
    }

    return json({ ok: true, event_type: eventType });
  } catch (err) {
    return serverError(err);
  }
});
