// ============================================
// TELNYX CALL WEBHOOK -- Receives call events from Telnyx
// Updates call records, stores recordings, handles AMD, bridges calls
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, serverError } from '../_shared/http.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { telnyxFetch } from '../_shared/telnyx.ts';

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

        // ---- BRIDGE MODE: Prompt rep with DTMF gate before connecting to lead ----
        if (clientState.bridge_mode === true || clientState.bridge_mode === 'true') {
          const callControlId = payload.call_control_id;

          if (callControlId) {
            console.log(`[telnyx-call-webhook] Bridge mode: sending DTMF prompt to rep`);
            try {
              // Use gather + speak to ask rep to press 9
              await telnyxFetch(`/v2/calls/${callControlId}/actions/gather`, {
                method: 'POST',
                body: JSON.stringify({
                  valid_digits: '9',
                  timeout_millis: 15000,
                  inter_digit_timeout_millis: 10000,
                  maximum_digits: 1,
                  minimum_digits: 1,
                  client_state: payload.client_state,
                }),
              });

              // Speak the prompt after gather is listening
              await telnyxFetch(`/v2/calls/${callControlId}/actions/speak`, {
                method: 'POST',
                body: JSON.stringify({
                  payload: 'Press 9 to connect to your next lead.',
                  voice: 'female',
                  language: 'en-US',
                  client_state: payload.client_state,
                }),
              });

              console.log(`[telnyx-call-webhook] DTMF gather + speak sent`);

              if (callId) {
                await admin.from('calls').update({
                  status: 'awaiting_confirmation',
                }).eq('id', callId);
              }
            } catch (gatherErr) {
              console.error('[telnyx-call-webhook] Gather/speak failed:', gatherErr);
              if (callId) {
                await admin.from('calls').update({
                  raw_payload: { gather_error: String(gatherErr) },
                }).eq('id', callId);
              }
            }
          } else {
            console.warn('[telnyx-call-webhook] Bridge mode but missing call_control_id');
          }
        }
        break;
      }

      case 'call.gather.ended': {
        // Rep pressed a digit (or timed out) during the DTMF gate
        const digits = payload.digits;
        const callControlId = payload.call_control_id;
        const isBridge = clientState.bridge_mode === true || clientState.bridge_mode === 'true';

        if (isBridge && callControlId) {
          if (digits === '9') {
            // Rep confirmed — transfer to lead
            const leadNumber = clientState.lead_number;
            const fromNumber = clientState.from_number || payload.from;

            if (leadNumber) {
              console.log(`[telnyx-call-webhook] Rep confirmed (9). Transferring to lead ${leadNumber} from ${fromNumber}`);
              try {
                await telnyxFetch(`/v2/calls/${callControlId}/actions/transfer`, {
                  method: 'POST',
                  body: JSON.stringify({
                    to: leadNumber,
                    from: fromNumber,
                    caller_id_number: fromNumber,
                    client_state: payload.client_state,
                  }),
                });
                console.log(`[telnyx-call-webhook] Transfer initiated to ${leadNumber}`);

                // Start recording on the bridged conversation
                try {
                  await telnyxFetch(`/v2/calls/${callControlId}/actions/record_start`, {
                    method: 'POST',
                    body: JSON.stringify({
                      format: 'mp3',
                      channels: 'dual',
                      client_state: payload.client_state,
                    }),
                  });
                  console.log(`[telnyx-call-webhook] Recording started for bridged call`);
                } catch (recErr) {
                  console.error('[telnyx-call-webhook] record_start failed:', recErr);
                }

                if (callId) {
                  await admin.from('calls').update({
                    status: 'bridging',
                  }).eq('id', callId);
                }
              } catch (transferErr) {
                console.error('[telnyx-call-webhook] Transfer failed:', transferErr);
                if (callId) {
                  await admin.from('calls').update({
                    raw_payload: { bridge_transfer_error: String(transferErr) },
                  }).eq('id', callId);
                }
              }
            } else {
              console.warn('[telnyx-call-webhook] Gather confirmed but no lead_number in state');
            }
          } else {
            // Rep didn't press 9 (timeout or wrong digit) — hang up
            console.log(`[telnyx-call-webhook] Rep did not confirm (digits: ${digits}). Hanging up.`);
            try {
              await telnyxFetch(`/v2/calls/${callControlId}/actions/hangup`, {
                method: 'POST',
                body: JSON.stringify({
                  client_state: payload.client_state,
                }),
              });
            } catch (hangupErr) {
              console.error('[telnyx-call-webhook] Hangup failed:', hangupErr);
            }

            if (callId) {
              await admin.from('calls').update({
                status: 'no_confirmation',
                ended_at: new Date().toISOString(),
              }).eq('id', callId);
            }
          }
        }
        break;
      }

      case 'call.bridged': {
        // Fires when the transfer/bridge connects to the lead
        if (callId) {
          await admin.from('calls').update({
            status: 'in-progress',
          }).eq('id', callId);
          console.log(`[telnyx-call-webhook] Call ${callId} bridged successfully`);
        }
        break;
      }

      case 'call.hangup': {
        if (callId) {
          const endedAt = new Date();
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
          await admin.from('calls').update({
            recording_url: recordingUrl,
          }).eq('id', callId);
          console.log(`[telnyx-call-webhook] Recording saved for call ${callId}`);
        }
        break;
      }

      case 'call.machine.detection.ended': {
        const result = payload.result;
        if (callId) {
          await admin.from('calls').update({
            raw_payload: { amd_result: result },
          }).eq('id', callId);

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
