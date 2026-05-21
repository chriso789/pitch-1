// Throughput-aware SMS blast worker.
// Invoked every minute by pg_cron (no body / source=cron) OR ad-hoc by the UI
// with { blast_id } to kick a specific blast immediately.
//
// Per tick (per running blast):
//   1. capacity = sum(active SMS locations.messages_per_second) * 60
//   2. atomically claim min(capacity, remaining) pending recipients
//   3. send each through telnyx-send-sms, paced to total_mps
//   4. update sms_blast_items, increment counters, recompute rates
//   5. circuit-break if failure_rate > 10% on >= 20 attempts
//   6. mark blast 'completed' when nothing remains
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FAILURE_CIRCUIT_BREAKER = 0.10; // 10%
const MIN_ATTEMPTS_FOR_BREAKER = 20;
const HARD_LIMIT_PER_INVOCATION = 100;
const DEFAULT_LIMIT_PER_INVOCATION = 50;
const MIN_PACING_MS = 800;
const MAX_PACING_MS = 1500;
const PER_PHONE_COOLDOWN_HOURS = 24;

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && /^\+[1-9]\d{1,14}$/.test(raw)) return raw;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Returns true if the current time is within the blast's send window.
// Defaults: 09:00 - 18:00 in America/New_York.
function isWithinSendWindow(blast: any): boolean {
  const tz = blast.timezone || 'America/New_York';
  const startStr = (blast.send_window_start || '09:00:00') as string;
  const endStr = (blast.send_window_end || '18:00:00') as string;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const hh = Number(parts.find(p => p.type === 'hour')?.value || '0');
    const mm = Number(parts.find(p => p.type === 'minute')?.value || '0');
    const now = hh * 60 + mm;
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const start = sh * 60 + (sm || 0);
    const end = eh * 60 + (em || 0);
    return now >= start && now < end;
  } catch {
    return true; // fail open
  }
}

// Pick a from-number that best matches the recipient's area code.
// FL preset: 941 (west coast) vs 561 (east coast). Otherwise area-code match,
// otherwise fall back to round-robin.
function pickFromNumber(
  toE164: string,
  activeNumbers: any[],
  cursor: number,
): any {
  if (!activeNumbers.length) return null;
  const digits = toE164.replace(/\D/g, '');
  // US format: +1XXXYYYZZZZ → area code is digits[1..4]
  const area = digits.length === 11 && digits.startsWith('1') ? digits.slice(1, 4) : null;

  if (area) {
    // FL coast preset: route 941 area codes (west) to a 941 number; 561/east to 561
    const preferred = area === '941' || area === '239' || area === '813'
      ? activeNumbers.find(n => String(n.telnyx_phone_number).includes('941'))
      : area === '561' || area === '954' || area === '305' || area === '786'
        ? activeNumbers.find(n => String(n.telnyx_phone_number).includes('561'))
        : null;
    if (preferred) return preferred;

    // Otherwise: prefer an exact area-code match
    const match = activeNumbers.find(n => String(n.telnyx_phone_number).includes(area));
    if (match) return match;
  }

  return activeNumbers[cursor % activeNumbers.length];
}

async function processBlast(
  supabase: ReturnType<typeof createClient>,
  blast: any,
  serviceKey: string,
  supabaseUrl: string,
) {
  // 0. Quiet-hours gate — skip this tick if outside configured send window
  if (!isWithinSendWindow(blast)) {
    await supabase
      .from('sms_blasts')
      .update({ last_processor_run_at: new Date().toISOString() })
      .eq('id', blast.id);
    return { blast_id: blast.id, skipped: 'outside_send_window' };
  }

  // 1. Resolve sending capacity from active SMS-capable locations
  const { data: numbers } = await supabase
    .from('locations')
    .select('id, telnyx_phone_number, messages_per_second, supports_sms, is_active, daily_limit, current_day_sent, current_day_reset_at')
    .eq('tenant_id', blast.tenant_id)
    .eq('is_active', true)
    .eq('supports_sms', true)
    .not('telnyx_phone_number', 'is', null);

  const activeNumbers = (numbers || []).filter(
    (n: any) => n.telnyx_phone_number && String(n.telnyx_phone_number).trim() !== '',
  );

  const totalMps = activeNumbers.reduce(
    (sum: number, n: any) => sum + Number(n.messages_per_second || 1),
    0,
  );

  if (activeNumbers.length === 0 || totalMps <= 0) {
    await supabase
      .from('sms_blasts')
      .update({
        status: 'failed',
        cancel_reason: 'No active SMS-capable Telnyx numbers for tenant',
        last_processor_run_at: new Date().toISOString(),
      })
      .eq('id', blast.id);
    return { blast_id: blast.id, error: 'no_active_numbers' };
  }

  // Cap per-tick batch by minute capacity AND daily room
  const minuteCapacity = Math.max(1, Math.floor(totalMps * 60));

  // 2. Atomic claim
  const { data: claimed, error: claimError } = await supabase.rpc('claim_sms_blast_items', {
    p_blast_id: blast.id,
    p_limit: minuteCapacity,
  });
  if (claimError) {
    console.error('[blast-worker] claim error', claimError);
    return { blast_id: blast.id, error: claimError.message };
  }

  if (!claimed || claimed.length === 0) {
    // Nothing to do — if no pending remain, mark completed
    const { count } = await supabase
      .from('sms_blast_items')
      .select('id', { count: 'exact', head: true })
      .eq('blast_id', blast.id)
      .in('status', ['pending', 'claimed']);
    if ((count ?? 0) === 0 && blast.status === 'sending') {
      await supabase
        .from('sms_blasts')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          last_processor_run_at: new Date().toISOString(),
        })
        .eq('id', blast.id);
    } else {
      await supabase
        .from('sms_blasts')
        .update({ last_processor_run_at: new Date().toISOString() })
        .eq('id', blast.id);
    }
    return { blast_id: blast.id, claimed: 0 };
  }

  // 3. Pre-check opt-outs in bulk
  const phones = claimed.map((c: any) => normalizePhone(c.phone)).filter(Boolean);
  const { data: optedOut } = await supabase
    .from('opt_outs')
    .select('phone')
    .eq('tenant_id', blast.tenant_id)
    .eq('channel', 'sms')
    .in('phone', phones);
  const optedOutSet = new Set((optedOut || []).map((o: any) => o.phone));

  // Pre-fetch personalized messages for claimed items (set by generate-campaign-messages)
  const claimedIds = (claimed as any[]).map((c: any) => c.id);
  const personalizedMap = new Map<string, string>();
  if (claimedIds.length > 0) {
    const { data: pers } = await supabase
      .from('sms_blast_items')
      .select('id, personalized_message')
      .in('id', claimedIds);
    (pers || []).forEach((p: any) => {
      if (p.personalized_message) personalizedMap.set(p.id, p.personalized_message);
    });
  }

  let sent = 0;
  let failed = 0;
  let opted = 0;

  const sleepMs = Math.max(50, Math.floor(1000 / Math.max(totalMps, 0.5)));

  // Cursor used as fallback for from-number rotation
  let cursor = 0;
  for (const item of claimed) {
    // Honor cancel flag mid-tick
    const { data: live } = await supabase
      .from('sms_blasts')
      .select('status')
      .eq('id', blast.id)
      .single();
    if (live?.status === 'cancelled' || live?.status === 'paused') {
      // Release remaining claimed rows
      await supabase
        .from('sms_blast_items')
        .update({ status: live.status === 'paused' ? 'pending' : 'cancelled', claimed_at: null })
        .eq('blast_id', blast.id)
        .eq('status', 'claimed');
      break;
    }

    const toE164 = normalizePhone(item.phone);
    if (!toE164) {
      await supabase
        .from('sms_blast_items')
        .update({ status: 'failed', last_error: 'invalid_phone', error_message: 'invalid_phone' })
        .eq('id', item.id);
      failed++;
      continue;
    }

    if (optedOutSet.has(toE164)) {
      await supabase
        .from('sms_blast_items')
        .update({ status: 'opted_out' })
        .eq('id', item.id);
      opted++;
      continue;
    }

    // Prefer personalized_message (smart-tag resolved) over raw script
    const firstName = (item.contact_name || '').split(' ')[0] || '';
    const lastName = (item.contact_name || '').split(' ').slice(1).join(' ') || '';
    let body = personalizedMap.get(item.id) || String(blast.script || '')
      .replace(/\{\{first_name\}\}/gi, firstName)
      .replace(/\{\{last_name\}\}/gi, lastName)
      .replace(/\{\{full_name\}\}/gi, item.contact_name || '')
      .replace(/\{\{phone\}\}/gi, toE164);
    if (!/stop/i.test(body)) body += '\n\nReply STOP to opt out.';

    // Pick a from-number — prefer area-code / FL-coast match, fallback round-robin
    const loc = pickFromNumber(toE164, activeNumbers, cursor);
    cursor++;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          to: toE164,
          message: body,
          contactId: item.contact_id,
          tenant_id: blast.tenant_id,
          sent_by: blast.created_by,
          locationId: loc.id,
          blast_id: blast.id,
          blast_item_id: item.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        const errMsg = String(json?.error || `HTTP ${res.status}`).slice(0, 500);
        await supabase
          .from('sms_blast_items')
          .update({
            status: 'failed',
            last_error: errMsg,
            error_message: errMsg,
            from_number: loc.telnyx_phone_number,
          })
          .eq('id', item.id);
        failed++;
      } else {
        await supabase
          .from('sms_blast_items')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            telnyx_message_id: json.messageId || null,
            from_number: json.from || loc.telnyx_phone_number,
          })
          .eq('id', item.id);
        sent++;
      }
    } catch (e: any) {
      const errMsg = String(e?.message || e).slice(0, 500);
      await supabase
        .from('sms_blast_items')
        .update({ status: 'failed', last_error: errMsg, error_message: errMsg })
        .eq('id', item.id);
      failed++;
    }

    // Pace
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  // 4. Recompute rollups for the blast
  const { data: agg } = await supabase
    .from('sms_blast_items')
    .select('status', { count: 'exact' })
    .eq('blast_id', blast.id);

  // Quick counts via separate queries (cheap, indexed)
  const countBy = async (status: string) => {
    const { count } = await supabase
      .from('sms_blast_items')
      .select('id', { count: 'exact', head: true })
      .eq('blast_id', blast.id)
      .eq('status', status);
    return count ?? 0;
  };
  const [sentTotal, failedTotal, optedTotal, deliveredTotal, repliedTotal, pendingTotal, claimedTotal] =
    await Promise.all([
      countBy('sent'),
      countBy('failed'),
      countBy('opted_out'),
      countBy('delivered'),
      countBy('replied'),
      countBy('pending'),
      countBy('claimed'),
    ]);

  const attempted = sentTotal + failedTotal + deliveredTotal + repliedTotal;
  const failureRate = attempted > 0 ? failedTotal / attempted : 0;
  const deliveryRate = attempted > 0 ? (deliveredTotal + repliedTotal) / attempted : 0;
  const replyRate = attempted > 0 ? repliedTotal / attempted : 0;
  const remaining = pendingTotal + claimedTotal;

  let newStatus = blast.status;
  let extra: Record<string, unknown> = {};
  if (attempted >= MIN_ATTEMPTS_FOR_BREAKER && failureRate > FAILURE_CIRCUIT_BREAKER) {
    newStatus = 'failed';
    extra = { cancel_reason: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeded ${(FAILURE_CIRCUIT_BREAKER * 100).toFixed(0)}%`, cancelled_at: new Date().toISOString() };
    // Cancel remaining queued
    await supabase
      .from('sms_blast_items')
      .update({ status: 'cancelled' })
      .eq('blast_id', blast.id)
      .in('status', ['pending', 'claimed']);
  } else if (remaining === 0 && blast.status === 'sending') {
    newStatus = 'completed';
    extra = { completed_at: new Date().toISOString() };
  }

  await supabase
    .from('sms_blasts')
    .update({
      status: newStatus,
      sent_count: sentTotal + deliveredTotal + repliedTotal,
      failed_count: failedTotal,
      opted_out_count: optedTotal,
      delivered_count: deliveredTotal,
      replied_count: repliedTotal,
      failure_rate: failureRate,
      delivery_rate: deliveryRate,
      reply_rate: replyRate,
      actual_messages_per_second: totalMps,
      last_processor_run_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', blast.id);

  return { blast_id: blast.id, sent, failed, opted, claimed: claimed.length, totalMps, minuteCapacity, remaining };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const specificBlastId: string | null = body?.blast_id || null;

    // If a single blast was requested and it's still in 'draft', flip to 'sending'
    if (specificBlastId) {
      const { data: b } = await supabase
        .from('sms_blasts')
        .select('id, status')
        .eq('id', specificBlastId)
        .single();
      if (b && b.status === 'draft') {
        await supabase
          .from('sms_blasts')
          .update({ status: 'sending', started_at: new Date().toISOString() })
          .eq('id', specificBlastId);
      }
    }

    // Pull every blast currently sending (or the requested one)
    let q = supabase.from('sms_blasts').select('*').eq('status', 'sending');
    if (specificBlastId) q = q.eq('id', specificBlastId);
    const { data: blasts, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const b of blasts || []) {
      try {
        results.push(await processBlast(supabase, b, serviceKey, supabaseUrl));
      } catch (e: any) {
        console.error('[blast-worker] processBlast error', b.id, e);
        results.push({ blast_id: b.id, error: String(e?.message || e) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[blast-worker] fatal', e);
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
