// Telnyx inbound SMS webhook. (redeploy 2026-05-20)
// - normalizes from/to phone numbers
// - resolves tenant from locations.telnyx_phone_number OR phone_number_routing.system_number
// - handles STOP/UNSUBSCRIBE/CANCEL/END/QUIT -> opt_outs + suppress remaining blast items
// - matches contact and appends to sms_threads/sms_messages
// - falls back to unmatched_inbound when no contact match
// - always logs raw payload to telnyx_webhook_events
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOPALL']);

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.startsWith('+') && /^\+[1-9]\d{1,14}$/.test(raw)) return raw;
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const eventType: string = payload?.data?.event_type || '';
  const p = payload?.data?.payload || {};
  const telnyxEventId: string | null = payload?.data?.id || null;

  // Only handle inbound messages here (delivery receipts go to telnyx-sms-status-webhook)
  if (eventType !== 'message.received') {
    // Still log so we have a complete event trail
    await supabase.from('telnyx_webhook_events').insert({
      kind: 'sms',
      event_type: eventType,
      telnyx_event_id: telnyxEventId,
      payload,
    });
    return new Response('ok', { headers: corsHeaders });
  }

  const fromE164 = normalizePhone(p?.from?.phone_number);
  const toE164 = normalizePhone(p?.to?.[0]?.phone_number);
  const body = String(p?.text || '').trim();
  const providerMessageId = p?.id || null;

  // Resolve tenant by the destination number
  let tenantId: string | null = null;
  let locationId: string | null = null;
  if (toE164) {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, tenant_id')
      .eq('telnyx_phone_number', toE164)
      .maybeSingle();
    if (loc) {
      tenantId = loc.tenant_id;
      locationId = loc.id;
    } else {
      const { data: route } = await supabase
        .from('phone_number_routing')
        .select('tenant_id')
        .eq('system_number', toE164)
        .maybeSingle();
      if (route) tenantId = route.tenant_id;
    }
  }

  // Log raw event
  await supabase.from('telnyx_webhook_events').insert({
    tenant_id: tenantId,
    kind: 'sms',
    event_type: eventType,
    telnyx_event_id: telnyxEventId,
    payload,
  });

  // Opt-out handling
  const upper = body.toUpperCase();
  if (tenantId && fromE164 && STOP_WORDS.has(upper)) {
    await supabase
      .from('opt_outs')
      .upsert(
        {
          tenant_id: tenantId,
          phone: fromE164,
          channel: 'sms',
          reason: upper,
          source: 'inbound_sms',
        },
        { onConflict: 'tenant_id,phone,channel' },
      );
    // Cancel any still-queued blast items for this phone in this tenant
    await supabase
      .from('sms_blast_items')
      .update({ status: 'opted_out' })
      .eq('phone', fromE164)
      .in('status', ['pending', 'claimed'])
      .in(
        'blast_id',
        ((
          await supabase.from('sms_blasts').select('id').eq('tenant_id', tenantId)
        ).data || []).map((b: any) => b.id),
      );
  }

  // Try to match contact across all common phone number storage formats
  let contactId: string | null = null;
  if (tenantId && fromE164) {
    const digits = fromE164.replace(/\D/g, ''); // e.g. 17708420812
    const last10 = digits.slice(-10);            // e.g. 7708420812
    const variants = Array.from(new Set([
      fromE164,            // +17708420812
      digits,              // 17708420812
      last10,              // 7708420812
      `+${digits}`,        // +17708420812
      `1${last10}`,        // 17708420812
    ]));
    const quoted = variants.map((v) => `"${v}"`).join(',');
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(
        `phone.in.(${quoted}),secondary_phone.in.(${quoted})`,
      )
      .limit(1)
      .maybeSingle();
    if (contact) contactId = contact.id;
  }

  if (tenantId && contactId) {
    // Upsert thread
    let threadId: string | null = null;
    const { data: thread } = await supabase
      .from('sms_threads')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('phone_number', fromE164)
      .maybeSingle();
    if (thread) {
      threadId = thread.id;
      await supabase
        .from('sms_threads')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: body.slice(0, 100),
          contact_id: contactId,
          location_id: locationId,
        })
        .eq('id', threadId);
    } else {
      const { data: t } = await supabase
        .from('sms_threads')
        .insert({
          tenant_id: tenantId,
          phone_number: fromE164,
          contact_id: contactId,
          location_id: locationId,
          last_message_at: new Date().toISOString(),
          last_message_preview: body.slice(0, 100),
        })
        .select('id')
        .single();
      threadId = t?.id ?? null;
    }

    await supabase.from('sms_messages').insert({
      tenant_id: tenantId,
      contact_id: contactId,
      thread_id: threadId,
      location_id: locationId,
      direction: 'inbound',
      from_number: fromE164,
      to_number: toE164,
      body,
      provider: 'telnyx',
      provider_message_id: providerMessageId,
      telnyx_message_id: providerMessageId,
      status: 'received',
      is_read: false,
    });

    // If the inbound is a reply to a recent outbound blast for this phone, mark replied.
    // Include 'replied' so multi-turn conversations keep matching the original blast.
    const { data: lastBlastItem } = await supabase
      .from('sms_blast_items')
      .select('id, blast_id')
      .eq('tenant_id', tenantId)
      .eq('phone', fromE164)
      .in('status', ['sent', 'delivered', 'replied'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (lastBlastItem) {
      await supabase
        .from('sms_blast_items')
        .update({ status: 'replied', replied_at: new Date().toISOString() })
        .eq('id', lastBlastItem.id);

      if (!STOP_WORDS.has(upper)) {
        fetch(`${supabaseUrl}/functions/v1/ai-followup-worker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            tenant_id: tenantId,
            contact_id: contactId,
            from_phone: fromE164,
            to_phone: toE164,
            body,
          }),
        }).catch((e) => console.error('[inbound] ai-followup dispatch failed', e));
      }
    } else if (!STOP_WORDS.has(upper)) {
      // Cold / non-blast inbound from a known contact → route to general AI inbound router
      fetch(`${supabaseUrl}/functions/v1/ai-inbound-router`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          tenant_id: tenantId,
          contact_id: contactId,
          inbound_text: body,
          channel: 'sms',
          from_number: fromE164,
        }),
      }).catch((e) => console.error('[inbound] ai-inbound-router dispatch failed', e));
    }
  } else {
    await supabase.from('unmatched_inbound').insert({
      tenant_id: tenantId,
      location_id: locationId,
      channel: 'sms',
      from_e164: fromE164,
      to_e164: toE164,
      event_type: eventType,
    });

  }

  return new Response('ok', { headers: corsHeaders });
});
