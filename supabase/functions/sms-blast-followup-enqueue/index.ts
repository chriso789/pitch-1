// Enqueue the next follow-up stage for SMS blasts.
//
// For each eligible blast:
//   - Determines each contact's next stage from how many rounds already went out
//   - Renders that stage's template with smart tags resolved
//   - Inserts a fresh pending sms_blast_items row
//   - HARD-SKIPS anyone who opted out, replied, is a landline, or is already queued
//   - Flips the blast back to `sending` so the processor picks the stage up
//
// Opt-out enforcement happens here (opt_outs table + STOP-derived item states)
// AND again inside sms-blast-processor before every send.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FALLBACKS: Record<string, string> = {
  'contact.first_name': 'there',
  'contact.last_name': '',
  'contact.address1': 'your property',
  'contact.full_address': 'your property',
  'contact.city': 'your area',
  'contact.state': 'FL',
  'contact.zip': '',
  'company.name': 'our team',
  'company.phone': '',
  'assigned_user.first_name': 'a teammate',
};

const ADDRESS_TOKEN_RE = /\b(drive|street|st|ave|avenue|road|rd|blvd|boulevard|ln|lane|ct|court|way|circle|cir|pl|place|dr|pkwy|parkway|terrace|ter|trail|trl|hwy|highway|ne|nw|se|sw)\b/i;

function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

function buildFullAddress(c: any): string | null {
  if (!c) return null;
  const street = (c.address_street || '').toString().trim();
  const city = (c.address_city || '').toString().trim();
  const state = (c.address_state || '').toString().trim();
  const zip = (c.address_zip || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  return [street, cityStateZip].filter(Boolean).join(', ') || null;
}

function isJunkFirstName(contact: any): boolean {
  if (!contact) return true;
  const fn = String(contact.first_name || '').trim();
  if (!fn) return true;
  if (/^\d/.test(fn)) return true;
  const street = String(contact.address_street || '').toLowerCase();
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim().toLowerCase();
  if (street && fullName === street) return true;
  if (street && street.includes(fn.toLowerCase())) return true;
  if (ADDRESS_TOKEN_RE.test(fn)) return true;
  return false;
}

function pick(ctx: any, key: string): string | null | undefined {
  switch (key) {
    case 'contact.first_name': return isJunkFirstName(ctx.contact) ? null : ctx.contact?.first_name;
    case 'contact.last_name': return ctx.contact?.last_name;
    case 'contact.address1':
    case 'contact.address_street': return ctx.contact?.address_street;
    case 'contact.full_address': return buildFullAddress(ctx.contact);
    case 'contact.city':
    case 'contact.address_city': return ctx.contact?.address_city;
    case 'contact.state':
    case 'contact.address_state': return ctx.contact?.address_state;
    case 'contact.zip':
    case 'contact.address_zip': return ctx.contact?.address_zip;
    case 'contact.phone': return ctx.contact?.phone;
    case 'company.name': return ctx.company?.name;
    case 'company.phone': return ctx.company?.phone;
    case 'assigned_user.first_name': return ctx.assigned_user?.first_name;
    case 'assigned_user.last_name': return ctx.assigned_user?.last_name;
    default: return undefined;
  }
}

function tidyEmptyGreetings(text: string): string {
  return text
    .replace(/\b(Hi|Hello|Hey)\s+,/gi, '$1,')
    .replace(/\b(Hi|Hello|Hey)\s+there\s*,/gi, '$1,')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function resolveTags(template: string, ctx: any): string {
  if (!template) return '';
  const suppressFirstName = isJunkFirstName(ctx.contact);
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, rawKey) => {
    const key = String(rawKey).trim();
    if (key === 'contact.first_name' && suppressFirstName) return '';
    const val = pick(ctx, key);
    if (val && String(val).trim().length > 0) return String(val).trim();
    if (key in FALLBACKS) return FALLBACKS[key];
    return '';
  });
}

// Item states that permanently disqualify a contact from further stages.
const BLOCKING_STATES = new Set([
  'replied',
  'opted_out',
  'skipped_landline',
  'quarantined',
  'cancelled',
]);
const IN_FLIGHT_STATES = new Set(['pending', 'rendered', 'claimed']);
const DELIVERED_STATES = new Set(['sent', 'delivered']);

async function enqueueBlast(supabase: any, blast: any, dryRun: boolean) {
  const pool: string[] = Array.isArray(blast.template_pool_ids) ? blast.template_pool_ids : [];
  if (pool.length < 2) {
    return { blast_id: blast.id, name: blast.name, skipped: 'no_followup_stages' };
  }

  const { data: items } = await supabase
    .from('sms_blast_items')
    .select('id, contact_id, contact_name, phone, status, sent_at, created_at')
    .eq('blast_id', blast.id);

  const rows = (items || []) as any[];
  if (rows.length === 0) return { blast_id: blast.id, name: blast.name, skipped: 'no_items' };

  // Group by contact (fall back to phone for contact-less rows)
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = r.contact_id || `phone:${normalizePhone(r.phone) || r.phone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // Bulk opt-out lookup
  const phones = Array.from(
    new Set(rows.map((r) => normalizePhone(r.phone)).filter(Boolean) as string[]),
  );
  const optedOut = new Set<string>();
  for (let i = 0; i < phones.length; i += 500) {
    const { data } = await supabase
      .from('opt_outs')
      .select('phone')
      .eq('tenant_id', blast.tenant_id)
      .eq('channel', 'sms')
      .in('phone', phones.slice(i, i + 500));
    (data || []).forEach((o: any) => optedOut.add(o.phone));
  }

  // Personalization context
  const { data: tenantRow } = await supabase
    .from('tenants').select('name, phone').eq('id', blast.tenant_id).maybeSingle();
  const company = tenantRow || { name: null, phone: null };
  let assigned_user: any = null;
  if (blast.created_by) {
    const { data: prof } = await supabase
      .from('profiles').select('first_name, last_name').eq('id', blast.created_by).maybeSingle();
    assigned_user = prof;
  }

  const { data: tpls } = await supabase
    .from('sms_templates').select('id, template_body, active, followup_delay_days').in('id', pool);
  const tplMap = new Map<string, any>((tpls || []).map((t: any) => [t.id, t]));

  const contactIds = Array.from(groups.keys()).filter((k) => !k.startsWith('phone:'));
  const contactsMap = new Map<string, any>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const { data: cs } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, phone, address_street, address_city, address_state, address_zip, is_deleted')
      .in('id', contactIds.slice(i, i + 500));
    (cs || []).forEach((c: any) => contactsMap.set(c.id, c));
  }

  const maxStages = Math.min(pool.length, Math.max(1, Number(blast.max_attempts_per_contact || pool.length)));
  const inserts: any[] = [];
  const skipped = { opted_out: 0, replied_or_blocked: 0, in_flight: 0, stages_exhausted: 0, no_contact: 0, no_phone: 0, missing_address: 0, not_due: 0 };
  const nextDue: string[] = [];

  for (const [key, group] of groups) {
    if (group.some((g) => BLOCKING_STATES.has(g.status))) {
      if (group.some((g) => g.status === 'opted_out')) skipped.opted_out++;
      else skipped.replied_or_blocked++;
      continue;
    }
    if (group.some((g) => IN_FLIGHT_STATES.has(g.status))) { skipped.in_flight++; continue; }

    const delivered = group.filter((g) => DELIVERED_STATES.has(g.status));
    if (delivered.length === 0) { skipped.replied_or_blocked++; continue; }

    const last = delivered[delivered.length - 1];
    const contact = key.startsWith('phone:') ? null : contactsMap.get(key);
    if (contact?.is_deleted) { skipped.no_contact++; continue; }

    const toE164 = normalizePhone(contact?.phone || last.phone);
    if (!toE164) { skipped.no_phone++; continue; }
    if (optedOut.has(toE164)) { skipped.opted_out++; continue; }

    const stage = delivered.length; // 0 = opener already sent → next is index 1
    if (stage >= maxStages) { skipped.stages_exhausted++; continue; }

    const tpl = tplMap.get(pool[stage]);
    if (!tpl || tpl.active === false) { skipped.stages_exhausted++; continue; }

    // Respect the stage's configured wait. The previous stage's send time is the anchor,
    // so a "Sends 2 days later" stage cannot go out until 2 days after the last delivery.
    const delayDays = Number.isFinite(Number(tpl.followup_delay_days))
      ? Math.max(0, Number(tpl.followup_delay_days))
      : 2;
    const anchor = last.sent_at || last.created_at;
    if (anchor && delayDays > 0) {
      const dueAt = new Date(new Date(anchor).getTime() + delayDays * 86400000);
      if (dueAt.getTime() > Date.now()) {
        skipped.not_due++;
        nextDue.push(dueAt.toISOString());
        continue;
      }
    }

    const body = tidyEmptyGreetings(resolveTags(tpl.template_body || '', { contact, company, assigned_user }));
    if (!body) { skipped.stages_exhausted++; continue; }

    const referencesAddress = /\{\{\s*contact\.(address1|address_street|full_address|city|address_city|state|address_state|zip|address_zip)\s*\}\}/i
      .test(tpl.template_body || '');
    if (referencesAddress && !contact?.address_street) { skipped.missing_address++; continue; }

    inserts.push({
      blast_id: blast.id,
      tenant_id: blast.tenant_id,
      contact_id: contact?.id || last.contact_id || null,
      contact_name: last.contact_name || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null,
      phone: toE164,
      status: 'pending',
      personalized_message: body,
      template_id: tpl.id,
      address_street_snapshot: contact?.address_street || null,
      address_city_snapshot: contact?.address_city || null,
      address_state_snapshot: contact?.address_state || null,
      address_zip_snapshot: contact?.address_zip || null,
    });
  }

  if (!dryRun && inserts.length > 0) {
    for (let i = 0; i < inserts.length; i += 200) {
      const { error } = await supabase.from('sms_blast_items').insert(inserts.slice(i, i + 200));
      if (error) throw new Error(`insert failed: ${error.message}`);
    }
    await supabase.from('sms_blasts').update({
      status: 'sending',
      ai_followup_enabled: true,
    }).eq('id', blast.id);
  }

  const nextDueAt = nextDue.length ? nextDue.sort()[0] : null;
  return { blast_id: blast.id, name: blast.name, queued: inserts.length, skipped, next_due_at: nextDueAt, dry_run: dryRun };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { tenant_id, blast_id, blast_ids, dry_run, all } = body || {};
    const dryRun = dry_run === true;

    let query = supabase
      .from('sms_blasts')
      .select('id, name, tenant_id, status, script, created_by, template_pool_ids, max_attempts_per_contact, total_recipients');

    if (blast_id) query = query.eq('id', blast_id);
    else if (Array.isArray(blast_ids) && blast_ids.length) query = query.in('id', blast_ids);
    else if (tenant_id) query = query.eq('tenant_id', tenant_id).in('status', ['completed', 'sending', 'paused']);
    else if (all === true) {
      // Scheduled sweep across every tenant. Delay gating inside enqueueBlast keeps stages
      // on their configured cadence, so running this hourly is safe.
      query = query
        .in('status', ['completed', 'sending', 'paused'])
        .eq('is_test_mode', false)
        .gt('sent_count', 0)
        .order('created_at', { ascending: false })
        .limit(200);
    } else {
      return new Response(JSON.stringify({ error: 'tenant_id, blast_id, blast_ids or all required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: blasts, error } = await query;
    if (error) throw error;

    const results = [];
    for (const b of blasts || []) {
      try {
        results.push(await enqueueBlast(supabase, b, dryRun));
      } catch (e: any) {
        results.push({ blast_id: b.id, name: b.name, error: String(e?.message || e) });
      }
    }

    const totalQueued = results.reduce((s: number, r: any) => s + (r.queued || 0), 0);
    return new Response(JSON.stringify({ success: true, dry_run: dryRun, total_queued: totalQueued, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[sms-blast-followup-enqueue] error', e);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
