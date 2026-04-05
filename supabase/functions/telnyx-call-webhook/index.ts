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

    // Idempotency: deduplicate by Telnyx event ID
    const telnyxEventId = event.id || body?.meta?.event_id;

    console.log(`[telnyx-call-webhook] Event: ${eventType}, id: ${telnyxEventId || 'unknown'}`);

    // Decode client_state to correlate back to our records
    let clientState: Record<string, unknown> = {};
    if (payload.client_state) {
      try {
        clientState = JSON.parse(atob(payload.client_state));
      } catch {
        console.warn('Failed to decode client_state');
      }
    }

    const callId = clientState.call_id as string | undefined;
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
              await telnyxFetch(`/v2/calls/${callControlId}/actions/gather_using_speak`, {
                method: 'POST',
                body: JSON.stringify({
                  payload: 'Press 9 to connect to your next lead.',
                  voice: 'female',
                  language: 'en-US',
                  valid_digits: '9',
                  maximum_digits: 1,
                  minimum_digits: 1,
                  timeout_secs: 15,
                  client_state: payload.client_state,
                }),
              });

              console.log(`[telnyx-call-webhook] gather_using_speak sent`);

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
          }
        }
        break;
      }

      case 'call.gather.ended': {
        const digits = payload.digits;
        const callControlId = payload.call_control_id;
        const isBridge = clientState.bridge_mode === true || clientState.bridge_mode === 'true';

        if (isBridge && callControlId) {
          if (digits === '9') {
            const leadNumber = clientState.lead_number;
            const fromNumber = clientState.from_number || payload.from;

            if (leadNumber) {
              console.log(`[telnyx-call-webhook] Rep confirmed (9). Transferring to lead ${leadNumber}`);
              try {
                const transferBody: Record<string, unknown> = {
                  to: leadNumber,
                  from: fromNumber,
                  caller_id_number: fromNumber,
                  client_state: payload.client_state,
                };

                const amdPref = clientState.amd_pref;
                if (amdPref && amdPref !== 'disabled') {
                  transferBody.answering_machine_detection = amdPref;
                }

                await telnyxFetch(`/v2/calls/${callControlId}/actions/transfer`, {
                  method: 'POST',
                  body: JSON.stringify(transferBody),
                });

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
              }
            }
          } else {
            const alreadyRetried = clientState.gather_retry === true || clientState.gather_retry === 'true';

            if (!alreadyRetried && (!digits || digits === '')) {
              console.log(`[telnyx-call-webhook] Empty digits, reprompting once...`);
              try {
                const retryState = { ...clientState, gather_retry: true };
                const retryClientState = btoa(JSON.stringify(retryState));

                await telnyxFetch(`/v2/calls/${callControlId}/actions/gather_using_speak`, {
                  method: 'POST',
                  body: JSON.stringify({
                    payload: 'Sorry, I didn\'t catch that. Press 9 to connect to your next lead.',
                    voice: 'female',
                    language: 'en-US',
                    valid_digits: '9',
                    maximum_digits: 1,
                    minimum_digits: 1,
                    timeout_secs: 15,
                    client_state: retryClientState,
                  }),
                });
              } catch (repromptErr) {
                console.error('[telnyx-call-webhook] Reprompt failed:', repromptErr);
              }
            } else {
              console.log(`[telnyx-call-webhook] Rep did not confirm. Hanging up.`);
              try {
                await telnyxFetch(`/v2/calls/${callControlId}/actions/hangup`, {
                  method: 'POST',
                  body: JSON.stringify({ client_state: payload.client_state }),
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
        }
        break;
      }

      case 'call.bridged': {
        if (callId) {
          await admin.from('calls').update({ status: 'in-progress' }).eq('id', callId);
          console.log(`[telnyx-call-webhook] Call ${callId} bridged`);
        }
        break;
      }

      case 'call.hangup': {
        if (callId) {
          const endedAt = new Date();
          const { data: callRow } = await admin
            .from('calls')
            .select('answered_at, list_item_id')
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

          // Update dialer list item status if linked
          if (callRow?.list_item_id) {
            await admin.from('dialer_list_items').update({
              status: 'called',
              updated_at: new Date().toISOString(),
            }).eq('id', callRow.list_item_id);
            console.log(`[telnyx-call-webhook] Updated list item ${callRow.list_item_id} to 'called'`);
          }
        }
        break;
      }

      case 'call.recording.saved': {
        const recordingUrl = payload.recording_urls?.mp3;
        if (callId && recordingUrl) {
          console.log(`[telnyx-call-webhook] Downloading recording for call ${callId}`);
          try {
            // 1. Download from Telnyx before presigned URL expires (600s)
            const audioRes = await fetch(recordingUrl);
            if (!audioRes.ok) {
              throw new Error(`Failed to fetch recording: ${audioRes.status}`);
            }
            const audioBytes = new Uint8Array(await audioRes.arrayBuffer());
            const tenantId = clientState.tenant_id || 'unknown';
            const storagePath = `${tenantId}/${callId}.mp3`;

            // 2. Upload to Supabase Storage
            const { error: uploadErr } = await admin.storage
              .from('call-recordings')
              .upload(storagePath, audioBytes, {
                contentType: 'audio/mpeg',
                upsert: true,
              });
            if (uploadErr) {
              console.error('[telnyx-call-webhook] Storage upload error:', uploadErr.message);
              await admin.from('calls').update({ recording_url: recordingUrl }).eq('id', callId);
              break;
            }

            // 3. Get permanent public URL
            const { data: publicUrlData } = admin.storage
              .from('call-recordings')
              .getPublicUrl(storagePath);
            const permanentUrl = publicUrlData?.publicUrl || recordingUrl;

            // 4. Update calls table (triggers trg_sync_call_recording → call_recordings)
            await admin.from('calls').update({
              recording_url: permanentUrl,
            }).eq('id', callId);
            console.log(`[telnyx-call-webhook] Recording stored permanently: ${storagePath}`);

            // 5. Trigger transcription
            try {
              const base64Audio = btoa(
                audioBytes.reduce((data, byte) => data + String.fromCharCode(byte), '')
              );

              const { data: transcriptData, error: transcriptErr } = await admin.functions.invoke(
                'voice-transcribe',
                {
                  body: {
                    audio: base64Audio,
                    callId,
                    tenantId: tenantId !== 'unknown' ? tenantId : null,
                    contactId: clientState.contact_id || null,
                  },
                }
              );

              if (transcriptErr) {
                console.error('[telnyx-call-webhook] Transcription error:', transcriptErr);
              } else if (transcriptData?.text) {
                await admin.from('calls').update({
                  transcript: transcriptData.text,
                }).eq('id', callId);
                console.log(`[telnyx-call-webhook] Transcript saved for call ${callId}`);
              }
            } catch (txErr) {
              console.error('[telnyx-call-webhook] Transcription invoke failed:', txErr);
            }
          } catch (dlErr) {
            console.error('[telnyx-call-webhook] Recording download failed:', dlErr);
            await admin.from('calls').update({ recording_url: recordingUrl }).eq('id', callId);
          }
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
