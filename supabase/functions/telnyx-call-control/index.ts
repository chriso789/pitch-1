// ============================================
// TELNYX CALL CONTROL - Hangup / Mute / Unmute
// Sends Call Control commands to active Telnyx calls
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, unauthorized, serverError } from '../_shared/http.ts';
import { supabaseAnon, supabaseService, getAuthUser } from '../_shared/supabase.ts';
import { telnyxFetch } from '../_shared/telnyx.ts';

interface CallControlRequest {
  action: 'hangup' | 'mute' | 'unmute';
  call_id: string; // Our internal call ID
}

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method !== 'POST') return badRequest('POST only');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return unauthorized('Missing Authorization header');

    const supa = supabaseAnon(authHeader);
    const user = await getAuthUser(supa);
    if (!user) return unauthorized('Invalid JWT');

    const body = (await req.json()) as CallControlRequest;

    if (!body.call_id || !body.action) {
      return badRequest('Missing required fields: call_id, action');
    }

    const validActions = ['hangup', 'mute', 'unmute'];
    if (!validActions.includes(body.action)) {
      return badRequest(`Invalid action. Must be one of: ${validActions.join(', ')}`);
    }

    const admin = supabaseService();

    // Load call record to get telnyx_call_control_id
    const { data: callRow, error: callErr } = await admin
      .from('calls')
      .select('id, telnyx_call_control_id, tenant_id, status')
      .eq('id', body.call_id)
      .single();

    if (callErr || !callRow) {
      return badRequest('Call not found');
    }

    // Verify user belongs to the tenant
    if (user.tenantId !== callRow.tenant_id) {
      return unauthorized('Not authorized for this call');
    }

    if (!callRow.telnyx_call_control_id) {
      return badRequest('No Telnyx call control ID — call may not be active');
    }

    const callControlId = callRow.telnyx_call_control_id;

    switch (body.action) {
      case 'hangup': {
        await telnyxFetch(`/v2/calls/${callControlId}/actions/hangup`, {
          method: 'POST',
          body: JSON.stringify({}),
        });

        // Update our record
        await admin.from('calls').update({
          status: 'completed',
          ended_at: new Date().toISOString(),
        }).eq('id', body.call_id);

        console.log(`[telnyx-call-control] Hangup sent for call ${body.call_id}`);
        break;
      }

      case 'mute': {
        // Telnyx doesn't have a direct mute endpoint for Call Control v2 basic calls.
        // For bridge/transfer calls we can use the "suppress" action or rely on WebRTC mute.
        // Using the gather/playback suppress approach or just tracking state.
        // For now, we'll track mute state in the DB and let the UI handle WebRTC mute.
        await admin.from('calls').update({
          raw_payload: { muted: true },
        }).eq('id', body.call_id);
        console.log(`[telnyx-call-control] Mute recorded for call ${body.call_id}`);
        break;
      }

      case 'unmute': {
        await admin.from('calls').update({
          raw_payload: { muted: false },
        }).eq('id', body.call_id);
        console.log(`[telnyx-call-control] Unmute recorded for call ${body.call_id}`);
        break;
      }
    }

    return json({ ok: true, action: body.action, call_id: body.call_id });
  } catch (err) {
    return serverError(err);
  }
});
