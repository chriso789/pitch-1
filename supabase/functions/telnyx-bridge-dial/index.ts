// ============================================
// TELNYX BRIDGE DIAL - OUTBOUND BRIDGE CALL
// Calls the rep's personal phone first, then bridges to the lead
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, unauthorized, serverError } from '../_shared/http.ts';
import { supabaseAnon, supabaseService, getAuthUser } from '../_shared/supabase.ts';
import { normalizeE164, isValidE164 } from '../_shared/phone.ts';
import { initiateCall } from '../_shared/telnyx.ts';
import { ENV } from '../_shared/env.ts';

interface BridgeDialRequest {
  tenant_id: string;
  contact_id: string;
  callback_number: string;
  location_id?: string;
  record?: boolean;
  answering_machine_detection?: 'disabled' | 'detect' | 'premium';
  list_item_id?: string;
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

    const body = (await req.json()) as BridgeDialRequest;

    if (!body.tenant_id || !body.contact_id || !body.callback_number) {
      return badRequest('Missing required fields: tenant_id, contact_id, callback_number');
    }

    if (user.tenantId !== body.tenant_id) {
      return unauthorized('Not a member of this tenant');
    }

    // Validate callback number
    const callbackE164 = normalizeE164(body.callback_number);
    if (!isValidE164(callbackE164)) {
      return badRequest('Invalid callback number');
    }

    const admin = supabaseService();

    // Load contact
    const { data: contact, error: contactErr } = await admin
      .from('contacts')
      .select('id, phone, first_name, last_name, location_id')
      .eq('id', body.contact_id)
      .eq('tenant_id', body.tenant_id)
      .single();

    if (contactErr || !contact) {
      return badRequest('Contact not found');
    }

    const leadNumber = normalizeE164(contact.phone);
    if (!leadNumber || !isValidE164(leadNumber)) {
      return badRequest('Invalid or missing contact phone number');
    }

    // Determine location for caller ID
    let locationId = body.location_id || contact.location_id;
    let fromNumber: string | null = null;
    let connectionId: string | null = null;

    if (locationId) {
      const { data: location } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_voice_app_id')
        .eq('id', locationId)
        .eq('tenant_id', body.tenant_id)
        .single();

      if (location) {
        fromNumber = location.telnyx_phone_number;
        connectionId = location.telnyx_voice_app_id;
      }
    }

    // Fallback: primary location
    if (!fromNumber) {
      const { data: primaryLocation } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_voice_app_id')
        .eq('tenant_id', body.tenant_id)
        .eq('is_primary', true)
        .single();

      if (primaryLocation?.telnyx_phone_number) {
        fromNumber = primaryLocation.telnyx_phone_number;
        connectionId = primaryLocation.telnyx_voice_app_id;
        locationId = primaryLocation.id;
      }
    }

    // Fallback: any location with phone
    if (!fromNumber) {
      const { data: anyLocation } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_voice_app_id')
        .eq('tenant_id', body.tenant_id)
        .not('telnyx_phone_number', 'is', null)
        .limit(1)
        .maybeSingle();

      if (anyLocation?.telnyx_phone_number) {
        fromNumber = anyLocation.telnyx_phone_number;
        connectionId = anyLocation.telnyx_voice_app_id;
        locationId = anyLocation.id;
      }
    }

    fromNumber = fromNumber || ENV.TELNYX_PHONE_NUMBER;
    connectionId = connectionId || ENV.TELNYX_CONNECTION_ID;

    if (!fromNumber) {
      return badRequest('No from number configured.');
    }
    if (!connectionId) {
      return badRequest('No Telnyx connection ID configured.');
    }

    const formattedFrom = normalizeE164(fromNumber);
    if (!isValidE164(formattedFrom)) {
      return badRequest(`Invalid from number: ${fromNumber}`);
    }

    // Get or create conversation
    const { data: convId, error: convErr } = await admin.rpc('rpc_create_or_get_conversation', {
      _tenant_id: body.tenant_id,
      _contact_id: body.contact_id,
      _channel: 'call',
      _location_id: locationId || null,
    });
    if (convErr) throw convErr;

    // Create call record (rep leg)
    const { data: callRow, error: callInsertErr } = await admin
      .from('calls')
      .insert({
        tenant_id: body.tenant_id,
        contact_id: body.contact_id,
        conversation_id: convId,
        location_id: locationId,
        created_by: user.id,
        direction: 'outbound',
        from_number: formattedFrom,
        to_number: leadNumber,
        status: 'initiated',
        call_type: 'bridge',
        raw_payload: {
          bridge_mode: true,
          callback_number: callbackE164,
          lead_number: leadNumber,
        },
      })
      .select('id')
      .single();

    if (callInsertErr) throw callInsertErr;

    console.log('Bridge call record created:', callRow.id);

    // Client state for webhook correlation
    const clientState = btoa(JSON.stringify({
      tenant_id: body.tenant_id,
      contact_id: body.contact_id,
      conversation_id: convId,
      call_id: callRow.id,
      location_id: locationId,
      user_id: user.id,
      bridge_mode: true,
      lead_number: leadNumber,
      from_number: formattedFrom,
      amd_pref: body.answering_machine_detection || 'disabled',
      record_pref: body.record || false,
    }));

    // Step 1: Call the rep's personal phone (NO AMD — AMD is for the lead leg only)
    const webhookUrl = `${ENV.SUPABASE_URL}/functions/v1/telnyx-call-webhook`;
    console.log(`Bridge: calling rep at ${callbackE164} from ${formattedFrom}, webhook: ${webhookUrl}`);
    const telnyxResp = await initiateCall({
      connection_id: connectionId,
      from: formattedFrom,
      to: callbackE164,
      caller_id_number: formattedFrom,
      client_state: clientState,
      timeout_secs: 60,
      webhook_url: webhookUrl,
    });

    console.log('Telnyx bridge call initiated (rep leg):', telnyxResp);

    // Update call record with Telnyx IDs
    await admin
      .from('calls')
      .update({
        telnyx_call_control_id: telnyxResp.call_control_id,
        telnyx_call_leg_id: telnyxResp.call_leg_id,
        raw_payload: {
          bridge_mode: true,
          callback_number: callbackE164,
          lead_number: leadNumber,
          rep_call_control_id: telnyxResp.call_control_id,
        },
      })
      .eq('id', callRow.id);

    // Update conversation activity
    await admin
      .from('conversations')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', convId);

    return json({
      ok: true,
      call: {
        id: callRow.id,
        conversation_id: convId,
        telnyx_call_control_id: telnyxResp.call_control_id,
        telnyx_call_leg_id: telnyxResp.call_leg_id,
        from: formattedFrom,
        to: callbackE164,
        lead_number: leadNumber,
        status: 'initiated',
        bridge_mode: true,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
