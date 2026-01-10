// ============================================
// TELNYX DIAL - OUTBOUND CALL INITIATION
// Creates conversation, call record, and initiates via Telnyx Call Control
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, unauthorized, serverError } from '../_shared/http.ts';
import { supabaseAnon, supabaseService, getAuthUser } from '../_shared/supabase.ts';
import { normalizeE164, isValidE164 } from '../_shared/phone.ts';
import { initiateCall } from '../_shared/telnyx.ts';
import { ENV } from '../_shared/env.ts';

interface DialRequest {
  tenant_id: string;
  contact_id: string;
  conversation_id?: string;
  location_id?: string;
  to_e164?: string;
  record?: boolean;
  answering_machine_detection?: 'disabled' | 'detect' | 'premium';
}

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method !== 'POST') return badRequest('POST only');

    // Authenticate user
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return unauthorized('Missing Authorization header');

    const supa = supabaseAnon(authHeader);
    const user = await getAuthUser(supa);
    if (!user) return unauthorized('Invalid JWT');

    const body = (await req.json()) as DialRequest;
    
    if (!body.tenant_id || !body.contact_id) {
      return badRequest('Missing required fields: tenant_id, contact_id');
    }

    // Verify tenant membership
    if (user.tenantId !== body.tenant_id) {
      return unauthorized('Not a member of this tenant');
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

    const toNumber = normalizeE164(body.to_e164 || contact.phone);
    if (!toNumber || !isValidE164(toNumber)) {
      return badRequest('Invalid or missing phone number');
    }

    // Determine location (from request, contact, or default)
    let locationId = body.location_id || contact.location_id;
    
    // Get location's Telnyx configuration
    let fromNumber: string | null = null;
    let connectionId: string | null = null;

    if (locationId) {
      const { data: location } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_connection_id')
        .eq('id', locationId)
        .eq('tenant_id', body.tenant_id)
        .single();

      if (location) {
        fromNumber = location.telnyx_phone_number;
        connectionId = location.telnyx_connection_id;
      }
    }

    // Fallback: try primary location
    if (!fromNumber) {
      const { data: primaryLocation } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_connection_id')
        .eq('tenant_id', body.tenant_id)
        .eq('is_primary', true)
        .single();

      if (primaryLocation?.telnyx_phone_number) {
        fromNumber = primaryLocation.telnyx_phone_number;
        connectionId = primaryLocation.telnyx_connection_id;
        locationId = primaryLocation.id;
      }
    }

    // Fallback: try any location with phone number
    if (!fromNumber) {
      const { data: anyLocation } = await admin
        .from('locations')
        .select('id, telnyx_phone_number, telnyx_connection_id')
        .eq('tenant_id', body.tenant_id)
        .not('telnyx_phone_number', 'is', null)
        .limit(1)
        .maybeSingle();

      if (anyLocation?.telnyx_phone_number) {
        fromNumber = anyLocation.telnyx_phone_number;
        connectionId = anyLocation.telnyx_connection_id;
        locationId = anyLocation.id;
      }
    }

    // Use environment defaults if no location-specific config
    fromNumber = fromNumber || ENV.TELNYX_PHONE_NUMBER;
    connectionId = connectionId || ENV.TELNYX_CONNECTION_ID;

    if (!fromNumber) {
      return badRequest('No from number configured. Please provision a Telnyx phone number for your location.');
    }

    if (!connectionId) {
      return badRequest('No Telnyx connection ID configured. Please configure voice settings in Admin.');
    }

    const formattedFrom = normalizeE164(fromNumber);
    if (!isValidE164(formattedFrom)) {
      return badRequest(`Invalid from number: ${fromNumber}`);
    }

    // Get or create conversation
    let conversationId = body.conversation_id;
    
    if (!conversationId) {
      const { data: convId, error: convErr } = await admin.rpc('rpc_create_or_get_conversation', {
        _tenant_id: body.tenant_id,
        _contact_id: body.contact_id,
        _channel: 'call',
        _location_id: locationId || null,
      });

      if (convErr) {
        console.error('Failed to create conversation:', convErr);
        throw convErr;
      }
      conversationId = convId;
    }

    // Create call record
    const { data: callRow, error: callInsertErr } = await admin
      .from('calls')
      .insert({
        tenant_id: body.tenant_id,
        contact_id: body.contact_id,
        conversation_id: conversationId,
        location_id: locationId,
        user_id: user.id,
        direction: 'outbound',
        from_number: formattedFrom,
        to_number: toNumber,
        status: 'initiated',
        call_type: 'manual',
      })
      .select('id')
      .single();

    if (callInsertErr) {
      console.error('Failed to create call record:', callInsertErr);
      throw callInsertErr;
    }

    console.log('Call record created:', callRow.id);

    // Encode client state for webhook correlation
    const clientState = btoa(JSON.stringify({
      tenant_id: body.tenant_id,
      contact_id: body.contact_id,
      conversation_id: conversationId,
      call_id: callRow.id,
      location_id: locationId,
      user_id: user.id,
    }));

    // Initiate call via Telnyx
    const telnyxResp = await initiateCall({
      connection_id: connectionId,
      from: formattedFrom,
      to: toNumber,
      client_state: clientState,
      record: body.record ? 'record-from-answer' : undefined,
      answering_machine_detection: body.answering_machine_detection,
    });

    console.log('Telnyx call initiated:', telnyxResp);

    // Update call record with Telnyx IDs
    await admin
      .from('calls')
      .update({
        telnyx_call_control_id: telnyxResp.call_control_id,
        telnyx_call_leg_id: telnyxResp.call_leg_id,
        raw_payload: telnyxResp,
      })
      .eq('id', callRow.id);

    // Update conversation activity
    if (conversationId) {
      await admin
        .from('conversations')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    return json({
      ok: true,
      call: {
        id: callRow.id,
        conversation_id: conversationId,
        telnyx_call_control_id: telnyxResp.call_control_id,
        telnyx_call_leg_id: telnyxResp.call_leg_id,
        from: formattedFrom,
        to: toNumber,
        status: 'initiated',
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
