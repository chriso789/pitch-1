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
import { trackUsage, checkUsageLimit } from '../_shared/track-usage.ts';
import {
  classifyTelnyxResponse,
  computeNextAttemptAt,
  deriveCountryFromE164,
  extractCountryFromErrorText,
} from '../_shared/telnyx/rateLimit.ts';

// Repair #2: hard ceiling for rate-limited retryable provider attempts before
// the row is moved to failed. Distinct from the general processor claim retries.
const RATE_LIMIT_RETRY_CEILING = 8;

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
const LINE_TYPE_CACHE_TTL_DAYS = 90;
const ADDRESS_TOKEN_RE = /\b(drive|street|st|ave|avenue|road|rd|blvd|boulevard|ln|lane|ct|court|way|circle|cir|pl|place|dr|pkwy|parkway|terrace|ter|trail|trl|hwy|highway|ne|nw|se|sw)\b/i;

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && /^\+[1-9]\d{1,14}$/.test(raw)) return raw;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function suppressAddressFirstNameArtifacts(text: string, item: any): string {
  let out = text;
  // 1) Generic safety net: any "Hi/Hello/Hey <digits...>," pattern is junk (house number leaked as first name)
  out = out.replace(/\b(Hi|Hello|Hey)\s+\d[\w-]*\s*,/gi, '$1,');
  // 2) Greeting followed by an address-token word
  out = out.replace(/\b(Hi|Hello|Hey)\s+(?:drive|street|st|ave|avenue|road|rd|blvd|boulevard|ln|lane|ct|court|way|circle|cir|pl|place|dr|pkwy|parkway|terrace|ter|trail|trl|hwy|highway)\s*,/gi, '$1,');
  // 3) If contact_name first word is junk, strip its exact form after a greeting
  const firstName = String(item?.contact_name || '').trim().split(/\s+/)[0] || '';
  if (firstName && (/^\d/.test(firstName) || ADDRESS_TOKEN_RE.test(firstName))) {
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b(Hi|Hello|Hey)\\s+${escaped}\\s*,`, 'gi'), '$1,');
  }
  // 4) Collapse "Hi ," → "Hi," and extra spaces
  out = out.replace(/\b(Hi|Hello|Hey)\s+,/gi, '$1,').replace(/[ \t]{2,}/g, ' ');
  return out;
}

// Returns 'mobile' | 'landline' | 'voip' | 'unknown'. Cached in phone_line_types.
async function lookupLineType(
  supabase: ReturnType<typeof createClient>,
  phoneE164: string,
): Promise<{ line_type: string; carrier_name: string | null }> {
  // 1) cache check
  const { data: cached } = await supabase
    .from('phone_line_types')
    .select('line_type, carrier_name, checked_at')
    .eq('phone', phoneE164)
    .maybeSingle();
  if (cached) {
    const age = Date.now() - new Date((cached as any).checked_at).getTime();
    if (age < LINE_TYPE_CACHE_TTL_DAYS * 86400 * 1000) {
      return { line_type: (cached as any).line_type, carrier_name: (cached as any).carrier_name || null };
    }
  }

  // 2) Telnyx Number Lookup
  const apiKey = Deno.env.get('TELNYX_API_KEY');
  if (!apiKey) return { line_type: 'unknown', carrier_name: null };

  try {
    const url = `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(phoneE164)}?type=carrier`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const json = await res.json().catch(() => ({}));
    const carrier = json?.data?.carrier || {};
    // Telnyx returns carrier.type values like "mobile", "landline", "voip", "fixed_or_mobile"
    const rawType = String(carrier.type || '').toLowerCase();
    let line_type: string = 'unknown';
    if (rawType.includes('landline') || rawType.includes('fixed')) line_type = 'landline';
    else if (rawType.includes('mobile') || rawType.includes('wireless')) line_type = 'mobile';
    else if (rawType.includes('voip')) line_type = 'voip';
    const carrier_name = carrier.name || null;

    await supabase.from('phone_line_types').upsert({
      phone: phoneE164,
      line_type,
      carrier_name,
      raw: json,
      checked_at: new Date().toISOString(),
    });
    return { line_type, carrier_name };
  } catch (e) {
    console.error('[blast-worker] line type lookup failed', phoneE164, e);
    return { line_type: 'unknown', carrier_name: null };
  }
}

// Pull the contact's full phone list (primary + secondary + additional) in priority order,
// minus any number already attempted in this blast.
async function getNextPhoneForContact(
  supabase: ReturnType<typeof createClient>,
  contactId: string,
  blastId: string,
  excludePhone: string,
): Promise<string | null> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('phone, secondary_phone, additional_phones')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return null;

  const candidates: string[] = [];
  const add = (p?: string | null) => {
    const n = p ? normalizePhone(p) : null;
    if (n && !candidates.includes(n)) candidates.push(n);
  };
  add((contact as any).phone);
  add((contact as any).secondary_phone);
  for (const p of ((contact as any).additional_phones || [])) add(p);

  // Drop any already attempted on this blast (including the one we just landlined)
  const { data: prior } = await supabase
    .from('sms_blast_items')
    .select('phone')
    .eq('blast_id', blastId)
    .eq('contact_id', contactId);
  const attempted = new Set<string>([
    excludePhone,
    ...((prior || []).map((r: any) => normalizePhone(r.phone)).filter(Boolean) as string[]),
  ]);

  return candidates.find((c) => !attempted.has(c)) || null;
}

// Remove a landline number from a contact's phone fields and log it under
// scrubbed_landline_phones so we never re-blast it.
async function scrubLandlineFromContact(
  supabase: ReturnType<typeof createClient>,
  contactId: string,
  badPhone: string,
) {
  const { data: contact } = await supabase
    .from('contacts')
    .select('phone, secondary_phone, additional_phones, scrubbed_landline_phones')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return;

  const eq = (p?: string | null) => p ? normalizePhone(p) === badPhone : false;
  const patch: Record<string, unknown> = {};
  if (eq((contact as any).phone)) patch.phone = (contact as any).secondary_phone || null;
  if (eq((contact as any).secondary_phone)) patch.secondary_phone = null;
  const addl = ((contact as any).additional_phones || []) as string[];
  const filteredAddl = addl.filter((p) => !eq(p));
  if (filteredAddl.length !== addl.length) patch.additional_phones = filteredAddl;

  // If the primary just got nulled out, promote the next available number.
  if (patch.phone === null) {
    const next =
      (patch.secondary_phone === undefined ? (contact as any).secondary_phone : patch.secondary_phone) ||
      (patch.additional_phones as string[] | undefined)?.[0] ||
      filteredAddl[0] ||
      null;
    if (next) {
      patch.phone = next;
      if (patch.secondary_phone === undefined && (contact as any).secondary_phone === next) patch.secondary_phone = null;
      if (Array.isArray(patch.additional_phones)) {
        patch.additional_phones = (patch.additional_phones as string[]).filter((p) => normalizePhone(p) !== normalizePhone(next));
      } else {
        const trimmedAddl = filteredAddl.filter((p) => normalizePhone(p) !== normalizePhone(next));
        if (trimmedAddl.length !== filteredAddl.length) patch.additional_phones = trimmedAddl;
      }
    }
  }

  const scrubbed = new Set<string>([...(((contact as any).scrubbed_landline_phones) || []), badPhone]);
  patch.scrubbed_landline_phones = Array.from(scrubbed);

  if (Object.keys(patch).length > 0) {
    await supabase.from('contacts').update(patch).eq('id', contactId);
  }
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
  opts: { limit?: number; dryRun?: boolean } = {},
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

  let activeNumbers = (numbers || []).filter(
    (n: any) => n.telnyx_phone_number && String(n.telnyx_phone_number).trim() !== '',
  );

  // Lock sends to the blast's originating location number, if specified.
  // West coast blasts must use the 941 number, east coast must use the 561, etc.
  if (blast.from_location_id) {
    let lockedLoc = activeNumbers.find((n: any) => n.id === blast.from_location_id);
    if (!lockedLoc) {
      const { data: locRow } = await supabase
        .from('locations')
        .select('id, telnyx_phone_number, messages_per_second, supports_sms, is_active, daily_limit, current_day_sent, current_day_reset_at')
        .eq('id', blast.from_location_id)
        .eq('tenant_id', blast.tenant_id)
        .maybeSingle();
      if (locRow && locRow.telnyx_phone_number && String(locRow.telnyx_phone_number).trim() !== '') {
        lockedLoc = locRow as any;
      }
    }
    if (lockedLoc) {
      activeNumbers = [lockedLoc];
    } else {
      await supabase
        .from('sms_blasts')
        .update({
          status: 'failed',
          cancel_reason: 'Originating location has no active SMS number assigned',
          last_processor_run_at: new Date().toISOString(),
        })
        .eq('id', blast.id);
      return { blast_id: blast.id, error: 'from_location_has_no_number' };
    }
  }

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

  // Cap per-tick batch by minute capacity AND launch-control hard limit
  const requestedLimit = Math.min(
    Math.max(1, opts.limit ?? DEFAULT_LIMIT_PER_INVOCATION),
    HARD_LIMIT_PER_INVOCATION,
  );
  const minuteCapacity = Math.min(requestedLimit, Math.max(1, Math.floor(totalMps * 60)));

  // Dry-run mode short-circuits: do not claim or send, just report state.
  if (opts.dryRun) {
    const { count: pendingCount } = await supabase
      .from('sms_blast_items')
      .select('id', { count: 'exact', head: true })
      .eq('blast_id', blast.id)
      .in('status', ['pending', 'rendered']);
    await supabase
      .from('sms_blasts')
      .update({ last_processor_run_at: new Date().toISOString() })
      .eq('id', blast.id);
    return { blast_id: blast.id, dry_run: true, remaining: pendingCount ?? 0 };
  }

  // 1b. Reap any items stuck in `claimed` from a prior processor crash so
  // this cycle can safely re-claim them. Runs BEFORE the atomic claim, uses
  // FOR UPDATE SKIP LOCKED internally so it never races with a live sender.
  // Never touches sent/delivered/failed/opted-out/cancelled rows, and never
  // requeues anything with a Telnyx message ID. Does NOT bump attempt_count.
  try {
    const { data: reaped, error: reapErr } = await supabase.rpc('reap_stale_sms_claims', {
      max_age_minutes: 5,
      batch_limit: 500,
    });
    if (reapErr) {
      console.warn('[blast-worker] reap error (non-fatal)', reapErr);
    } else if (reaped && reaped.length) {
      const total = reaped.reduce((s: number, r: any) => s + Number(r.reaped_count || 0), 0);
      if (total > 0) console.log('[blast-worker] reaped stale claims', { total, per_blast: reaped });
    }
  } catch (e) {
    console.warn('[blast-worker] reap exception (non-fatal)', e);
  }

  // Each processor tick owns a claim token. Any row we claim gets stamped with
  // this token so only THIS worker can later release it back to pending (e.g.
  // when Telnyx rate-limits us). An expired/parallel worker cannot overwrite a
  // row we've reclaimed.
  const processorRunId = crypto.randomUUID();
  const claimToken = processorRunId;

  // 2. Atomic claim (honors next_attempt_at from prior rate-limit releases)
  const { data: claimed, error: claimError } = await supabase.rpc('claim_sms_blast_items', {
    p_blast_id: blast.id,
    p_limit: minuteCapacity,
    p_claim_token: claimToken,
  });
  if (claimError) {
    console.error('[blast-worker] claim error', claimError);
    return { blast_id: blast.id, error: claimError.message };
  }

  if (!claimed || claimed.length === 0) {
    // Nothing to do — if no sendable items remain, mark completed.
    // Skipped terminal states are intentionally excluded so cooldown/duplicate
    // guards do not leave the parent blast stuck in "sending".
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

  // 2b. Pre-flight monthly SMS quota check (Priority 7).
  // Estimate 1 segment per recipient as the lower-bound; multi-segment
  // messages still get logged at send time via telnyx-send-sms.
  try {
    const gate = await checkUsageLimit({
      tenantId: blast.tenant_id,
      eventType: 'sms_outbound',
      quantity: claimed.length,
    });
    if (gate && gate.allowed === false) {
      trackUsage({
        tenantId: blast.tenant_id,
        provider: 'telnyx',
        eventType: 'sms_outbound',
        featureArea: 'bulk_sms',
        edgeFunction: 'sms-blast-processor',
        status: 'blocked_limit',
        quantity: claimed.length,
        metadata: {
          blast_id: blast.id,
          campaign_id: blast.campaign_id ?? null,
          contact_count: claimed.length,
          reason: gate.reason ?? 'monthly_limit_reached',
          current_usage: gate.current_usage,
          limit: gate.limit,
        },
      });
      await supabase
        .from('sms_blasts')
        .update({
          status: 'paused',
          last_error: 'Monthly SMS limit reached. Upgrade or purchase additional SMS.',
          last_processor_run_at: new Date().toISOString(),
        })
        .eq('id', blast.id);
      // Release claimed items back to pending so they can be retried after upgrade.
      await supabase
        .from('sms_blast_items')
        .update({ status: 'pending' })
        .eq('blast_id', blast.id)
        .eq('status', 'claimed');
      return {
        blast_id: blast.id,
        blocked_limit: true,
        message: 'Monthly SMS limit reached. Upgrade or purchase additional SMS.',
      };
    }
  } catch { /* swallow — fail open */ }



  // 3. Pre-check opt-outs in bulk
  const phones = claimed.map((c: any) => normalizePhone(c.phone)).filter(Boolean);
  const { data: optedOut } = await supabase
    .from('opt_outs')
    .select('phone')
    .eq('tenant_id', blast.tenant_id)
    .eq('channel', 'sms')
    .in('phone', phones);
  const optedOutSet = new Set((optedOut || []).map((o: any) => o.phone));

  // 3b. Per-phone 24h cooldown — block resends to the same number within window.
  // TEST MODE: set env SMS_BLAST_BYPASS_COOLDOWN=true, mark the blast as test mode,
  // or name the blast like "Test 3" while QA'ing.
  const envBypassCooldown = String(Deno.env.get('SMS_BLAST_BYPASS_COOLDOWN') || '').trim().toLowerCase() === 'true';
  const blastTestMode = blast.is_test_mode === true || /\btest\b/i.test(String(blast.name || ''));
  const bypassCooldown = envBypassCooldown || blastTestMode;
  const cooldownSet = new Set<string>();
  if (!bypassCooldown && phones.length > 0) {
    const since = new Date(Date.now() - PER_PHONE_COOLDOWN_HOURS * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('sms_messages')
      .select('to_number')
      .eq('tenant_id', blast.tenant_id)
      .eq('direction', 'outbound')
      .in('to_number', phones)
      .gte('created_at', since);
    (recent || []).forEach((r: any) => { if (r.to_number) cooldownSet.add(r.to_number); });
  }


  // 3c. In-blast phone dedupe — only allow first occurrence per phone in this run.
  const seenInBlast = new Set<string>();

  // Pre-fetch personalized messages + address snapshots for claimed items (set by generate-campaign-messages)
  const claimedIds = (claimed as any[]).map((c: any) => c.id);
  const personalizedMap = new Map<string, string>();
  const addrSnapMap = new Map<string, string | null>();
  if (claimedIds.length > 0) {
    const { data: pers } = await supabase
      .from('sms_blast_items')
      .select('id, personalized_message, address_street_snapshot')
      .in('id', claimedIds);
    (pers || []).forEach((p: any) => {
      if (p.personalized_message) personalizedMap.set(p.id, p.personalized_message);
      addrSnapMap.set(p.id, p.address_street_snapshot || null);
    });
  }

  const isEmailCaptureGoal = String(blast.goal || '') === 'collect_homeowner_email_for_roof_estimate';

  let sent = 0;
  let failed = 0;
  let opted = 0;
  let blockedByGuard = 0;
  let blockedByCooldown = 0;
  let blockedByDedupe = 0;
  let rateLimited = 0;         // Repair #2: releases back to pending
  let rateLimitExhausted = 0;  // Repair #2: hit ceiling → failed
  let ownershipConflicts = 0;  // Repair #2: another worker owns the row
  let quarantined = 0;         // Repair #3: permanent destination rejections
  const quarantineCountryBreakdown = new Map<string, number>();
  let retryDelaySumMs = 0;
  let retryDelayMaxMs = 0;

  // Safe pacing window — 800–1500ms between messages regardless of MPS capacity.
  const sleepMs = Math.max(
    MIN_PACING_MS,
    Math.min(MAX_PACING_MS, Math.floor(1000 / Math.max(totalMps, 0.5))),
  );

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

    // 24h per-phone cooldown — block re-sending to same number.
    if (cooldownSet.has(toE164)) {
      await supabase.from('sms_blast_items').update({
        status: 'skipped_cooldown',
        last_error: 'per_phone_24h_cooldown',
        error_message: 'Skipped: already messaged this phone in last 24h',
      }).eq('id', item.id);
      blockedByCooldown++;
      continue;
    }

    // In-blast dedupe — only first occurrence per phone in this run.
    if (seenInBlast.has(toE164)) {
      await supabase.from('sms_blast_items').update({
        status: 'skipped_duplicate',
        last_error: 'duplicate_phone_in_blast',
        error_message: 'Skipped: duplicate phone in this blast',
      }).eq('id', item.id);
      blockedByDedupe++;
      continue;
    }
    seenInBlast.add(toE164);

    // Production guard: email-capture campaigns require locked message + address snapshot
    if (isEmailCaptureGoal) {
      const lockedMsg = personalizedMap.get(item.id);
      const addrSnap = addrSnapMap.get(item.id);
      if (!lockedMsg || !lockedMsg.trim() || !addrSnap || !String(addrSnap).trim()) {
        await supabase.from('sms_blast_items').update({
          status: 'failed',
          last_error: 'production_guard_blocked',
          error_message: 'Production guard blocked send: missing locked address/message',
        }).eq('id', item.id);
        blockedByGuard++;
        failed++;
        continue;
      }
    }

    // Landline guard — never blast a landline. If detected, scrub it off the contact
    // and queue the next phone number on that contact so the blast moves on automatically.
    const lineInfo = await lookupLineType(supabase, toE164);
    if (lineInfo.line_type === 'landline') {
      if (item.contact_id) {
        await scrubLandlineFromContact(supabase, item.contact_id, toE164);
        const nextPhone = await getNextPhoneForContact(supabase, item.contact_id, blast.id, toE164);
        if (nextPhone) {
          // Queue a fresh item for the next number on this contact. The next
          // processor tick will pick it up; personalization is re-run because
          // the body doesn't depend on which phone we send to.
          await supabase.from('sms_blast_items').insert({
            blast_id: blast.id,
            tenant_id: blast.tenant_id,
            contact_id: item.contact_id,
            contact_name: item.contact_name,
            phone: nextPhone,
            personalized_message: personalizedMap.get(item.id) || null,
            address_street_snapshot: addrSnapMap.get(item.id) || null,
            status: 'pending',
          });
        }
      }
      await supabase.from('sms_blast_items').update({
        status: 'skipped_landline',
        last_error: 'landline_detected',
        error_message: `Skipped: ${toE164} is a landline (${lineInfo.carrier_name || 'unknown carrier'}). Removed from contact.`,
      }).eq('id', item.id);
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
    body = suppressAddressFirstNameArtifacts(body, item);
    // Note: STOP verbiage intentionally NOT auto-appended. Inbound STOP keyword handling still opts recipients out.

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

      // Provider-id safety: if Telnyx returned a message id despite an odd
      // response, treat as sent — NEVER requeue a row with a provider id.
      const providerMessageId = json?.messageId || json?.rate_limit?.provider_message_id || null;

      if (json?.success && providerMessageId) {
        await supabase
          .from('sms_blast_items')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            telnyx_message_id: providerMessageId,
            from_number: json.from || loc.telnyx_phone_number,
          })
          .eq('id', item.id);
        sent++;
      } else if (!res.ok || !json?.success) {
        // Prefer the structured classification returned by telnyx-send-sms.
        // Fall back to classifying whatever we can see locally.
        const norm = json?.rate_limit && typeof json.rate_limit === 'object'
          ? json.rate_limit
          : classifyTelnyxResponse({ status: res.status, body: json });

        const errMsg = String(json?.error || norm?.provider_error_message || `HTTP ${res.status}`).slice(0, 500);
        const currentAttempts = Number((item as any).attempt_count || 0);

        if (norm?.is_rate_limited && !providerMessageId) {
          if (currentAttempts >= RATE_LIMIT_RETRY_CEILING) {
            await supabase
              .from('sms_blast_items')
              .update({
                status: 'failed',
                last_error: `retry_exhausted: rate_limit (${currentAttempts} attempts)`,
                error_message: `retry_exhausted: rate_limit — ${errMsg}`,
                from_number: loc.telnyx_phone_number,
                provider_error_code: norm.provider_error_code || null,
                provider_request_id: norm.provider_request_id || null,
              })
              .eq('id', item.id);
            rateLimitExhausted++;
            failed++;
          } else {
            const { nextAttemptAt, delayMs } = computeNextAttemptAt(
              norm.retry_after_ms ?? null,
              currentAttempts,
            );
            const { data: rel } = await supabase.rpc('release_sms_blast_item_rate_limited', {
              p_item_id: item.id,
              p_claim_token: claimToken,
              p_next_attempt_at: nextAttemptAt.toISOString(),
              p_last_error: `rate_limited: ${errMsg}`,
              p_provider_error_code: norm.provider_error_code || null,
              p_provider_request_id: norm.provider_request_id || null,
              p_retry_after_ms: norm.retry_after_ms ?? null,
              p_processor_run_id: processorRunId,
            });
            const released = Array.isArray(rel) && rel[0]?.released === true;
            if (released) {
              rateLimited++;
              retryDelaySumMs += delayMs;
              if (delayMs > retryDelayMaxMs) retryDelayMaxMs = delayMs;
            } else {
              // Ownership conflict — another worker reclaimed OR a telnyx id
              // landed on the row. Do NOT overwrite. Just log and move on.
              ownershipConflicts++;
              console.warn('[blast-worker] rate-limit release ownership conflict', {
                item_id: item.id, blast_id: blast.id, run_id: processorRunId,
              });
            }
          }
        } else if (norm?.is_retryable && norm?.category !== 'rate_limit') {
          // Non-rate-limit transient (network/5xx). Piggy-back on same
          // conditional-release path so the row still respects backoff, but
          // give it a shorter delay window.
          const { nextAttemptAt, delayMs } = computeNextAttemptAt(null, currentAttempts);
          const { data: rel } = await supabase.rpc('release_sms_blast_item_rate_limited', {
            p_item_id: item.id,
            p_claim_token: claimToken,
            p_next_attempt_at: nextAttemptAt.toISOString(),
            p_last_error: `${norm.category}: ${errMsg}`,
            p_provider_error_code: norm.provider_error_code || null,
            p_provider_request_id: norm.provider_request_id || null,
            p_retry_after_ms: null,
            p_processor_run_id: processorRunId,
          });
          const released = Array.isArray(rel) && rel[0]?.released === true;
          if (released) {
            retryDelaySumMs += delayMs;
            if (delayMs > retryDelayMaxMs) retryDelayMaxMs = delayMs;
          } else {
            ownershipConflicts++;
          }
        } else if (norm?.category === 'destination_not_permitted') {
          // Repair #3: Permanent destination rejection (e.g. Canadian NANP on
          // a US-only messaging profile). Quarantine immediately; never retry,
          // never increment attempt_count again, never count as "failed" for
          // reporting purposes.
          const country =
            extractCountryFromErrorText(norm?.provider_error_message || errMsg) ||
            deriveCountryFromE164(toE164 || item.phone);
          const reason = `permanent_destination_rejection: ${errMsg}`;
          await supabase
            .from('sms_blast_items')
            .update({
              status: 'quarantined',
              quarantine_reason: reason,
              country_code: country,
              quarantined_at: new Date().toISOString(),
              last_error: reason,
              error_message: reason,
              from_number: loc.telnyx_phone_number,
              provider_error_code: norm?.provider_error_code || null,
              provider_request_id: norm?.provider_request_id || null,
            })
            .eq('id', item.id);
          await supabase.from('sms_item_quarantine_events').insert({
            tenant_id: (item as any).tenant_id || blast.tenant_id,
            blast_id: blast.id,
            item_id: item.id,
            phone: toE164 || item.phone || null,
            country_code: country,
            reason,
            provider_error_code: norm?.provider_error_code || null,
            provider_request_id: norm?.provider_request_id || null,
            provider_status: typeof res.status === 'number' ? res.status : null,
            processor_run_id: processorRunId,
          });
          quarantined++;
          if (country) {
            quarantineCountryBreakdown.set(country, (quarantineCountryBreakdown.get(country) || 0) + 1);
          }
        } else {
          // Permanent — record and let existing behaviour flag as failed.
          await supabase
            .from('sms_blast_items')
            .update({
              status: 'failed',
              last_error: errMsg,
              error_message: errMsg,
              from_number: loc.telnyx_phone_number,
              provider_error_code: norm?.provider_error_code || null,
              provider_request_id: norm?.provider_request_id || null,
            })
            .eq('id', item.id);
          failed++;
        }
      } else {
        // Normal success path.
        await supabase
          .from('sms_blast_items')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            telnyx_message_id: providerMessageId,
            from_number: json.from || loc.telnyx_phone_number,
          })
          .eq('id', item.id);
        sent++;
      }
    } catch (e: any) {
      // Network exception talking to telnyx-send-sms itself. Treat as retryable
      // and release the claim so it can be retried on next tick.
      const errMsg = String(e?.message || e).slice(0, 500);
      const currentAttempts = Number((item as any).attempt_count || 0);
      const { nextAttemptAt, delayMs } = computeNextAttemptAt(null, currentAttempts);
      const { data: rel } = await supabase.rpc('release_sms_blast_item_rate_limited', {
        p_item_id: item.id,
        p_claim_token: claimToken,
        p_next_attempt_at: nextAttemptAt.toISOString(),
        p_last_error: `connection_error: ${errMsg}`,
        p_provider_error_code: null,
        p_provider_request_id: null,
        p_retry_after_ms: null,
        p_processor_run_id: processorRunId,
      });
      const released = Array.isArray(rel) && rel[0]?.released === true;
      if (released) {
        retryDelaySumMs += delayMs;
        if (delayMs > retryDelayMaxMs) retryDelayMaxMs = delayMs;
      } else {
        ownershipConflicts++;
      }
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
  const [sentTotal, failedTotal, optedTotal, deliveredTotal, repliedTotal, pendingTotal, claimedTotal, cooldownTotal, duplicateTotal, quarantinedTotal] =
    await Promise.all([
      countBy('sent'),
      countBy('failed'),
      countBy('opted_out'),
      countBy('delivered'),
      countBy('replied'),
      countBy('pending'),
      countBy('claimed'),
      countBy('skipped_cooldown'),
      countBy('skipped_duplicate'),
      countBy('quarantined'),
    ]);

  const skippedTotal = cooldownTotal + duplicateTotal;
  const successfulTotal = sentTotal + deliveredTotal + repliedTotal;
  // Repair #3: quarantined rows are terminal but must NOT inflate failure_rate.
  // Include them in `attempted` so the blast can auto-complete, and exclude
  // them from both numerator and denominator of the failure calculation.
  const attempted = successfulTotal + failedTotal + skippedTotal + quarantinedTotal;
  const failureDenominator = attempted - quarantinedTotal;
  const failureRate = failureDenominator > 0 ? (failedTotal + skippedTotal) / failureDenominator : 0;
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
    newStatus = successfulTotal > 0 || attempted === 0 ? 'completed' : 'failed';
    extra = successfulTotal > 0 || attempted === 0
      ? { completed_at: new Date().toISOString() }
      : { cancel_reason: 'No text messages were sent; all recipients were blocked or failed.', cancelled_at: new Date().toISOString() };
  }

  await supabase
    .from('sms_blasts')
    .update({
      status: newStatus,
      sent_count: successfulTotal,
      failed_count: failedTotal + skippedTotal,
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

  const requeuedTotal = rateLimited; // rate-limit releases + retryable transients
  const avgRetryDelayMs = rateLimited > 0 ? Math.round(retryDelaySumMs / rateLimited) : 0;

  return {
    blast_id: blast.id,
    processor_run_id: processorRunId,
    sent, failed, opted, blockedByGuard, blockedByCooldown, blockedByDedupe,
    // Repair #2 observability
    rate_limited: rateLimited,
    rate_limit_exhausted: rateLimitExhausted,
    ownership_conflicts: ownershipConflicts,
    requeued: requeuedTotal,
    avg_retry_delay_ms: avgRetryDelayMs,
    max_retry_delay_ms: retryDelayMaxMs,
    claimed: claimed.length, totalMps, minuteCapacity, remaining,
    partial: remaining > 0,
    message: remaining > 0 ? 'Batch processed. Run processor again for remaining rendered items.' : undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const specificBlastId: string | null = body?.blast_id || null;
    const reqLimit: number | undefined = typeof body?.limit === 'number' ? body.limit : undefined;
    const reqDryRun: boolean = body?.dry_run === true;

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
        results.push(await processBlast(supabase, b, serviceKey, supabaseUrl, { limit: reqLimit, dryRun: reqDryRun }));
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
