// Generate personalized messages for an SMS blast.
// - Pulls all sms_blast_items for a blast
// - Loads contact + tenant company + assigned user
// - Rotates across blast.template_pool_ids (or falls back to blast.script)
// - Resolves smart tags ({{contact.first_name}}, {{contact.address1}}, etc.)
// - Detects prior SMS interaction and prepends a consultative prefix
// - Writes sms_blast_items.personalized_message and sms_blast_items.template_id
//
// Invoked by the UI before kicking off a blast, or re-run to refresh personalization.
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

function buildFullAddress(c: any): string | null {
  if (!c) return null;
  const street = (c.address_street || '').toString().trim();
  const city = (c.address_city || '').toString().trim();
  const state = (c.address_state || '').toString().trim();
  const zip = (c.address_zip || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  const full = [street, cityStateZip].filter(Boolean).join(', ');
  return full || null;
}

function pick(ctx: any, key: string): string | null | undefined {
  switch (key) {
    case 'contact.first_name': return ctx.contact?.first_name;
    case 'contact.last_name': return ctx.contact?.last_name;
    // Accept both the friendly alias ({{contact.address1}}) and the DB-style
    // tag ({{contact.address_street}}) that the template editor surfaces.
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

function resolveTags(template: string, ctx: any): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, rawKey) => {
    const key = String(rawKey).trim();
    const val = pick(ctx, key);
    if (val && String(val).trim().length > 0) return String(val).trim();
    if (key in FALLBACKS) return FALLBACKS[key];
    return '';
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { blast_id } = await req.json();
    if (!blast_id) {
      return new Response(JSON.stringify({ error: 'blast_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load blast
    const { data: blast, error: blastErr } = await supabase
      .from('sms_blasts').select('*').eq('id', blast_id).single();
    if (blastErr || !blast) throw new Error(blastErr?.message || 'blast not found');

    // Load templates from pool (if any)
    const poolIds: string[] = Array.isArray((blast as any).template_pool_ids)
      ? (blast as any).template_pool_ids : [];
    let templates: any[] = [];
    if (poolIds.length > 0) {
      const { data: t } = await supabase
        .from('sms_templates').select('id, template_body')
        .in('id', poolIds).eq('active', true);
      templates = t || [];
    }
    if (templates.length === 0) {
      templates = [{ id: null, template_body: blast.script || '' }];
    }

    // Load tenant company info (best-effort)
    const { data: tenantRow } = await supabase
      .from('tenants').select('name, phone').eq('id', blast.tenant_id).maybeSingle();
    const company = tenantRow || { name: null, phone: null };

    // Load assigned user (the rep who created the blast)
    let assigned_user: any = null;
    if (blast.created_by) {
      const { data: prof } = await supabase
        .from('profiles').select('first_name, last_name')
        .eq('id', blast.created_by).maybeSingle();
      assigned_user = prof;
    }

    // Load items needing personalization (process all if force=true)
    const { data: items, error: itemsErr } = await supabase
      .from('sms_blast_items')
      .select('id, contact_id, contact_name, phone, personalized_message, address_street_snapshot')
      .eq('blast_id', blast_id)
      .in('status', ['pending', 'claimed']);
    if (itemsErr) throw itemsErr;

    const contactIds = (items || []).map((i: any) => i.contact_id).filter(Boolean);
    let contactsMap = new Map<string, any>();
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, address_street, address_city, address_state, address_zip')
        .in('id', contactIds);
      (contacts || []).forEach((c: any) => contactsMap.set(c.id, c));
    }

    // Prior interaction lookup — check sms_messages for any previous outbound to this contact
    const priorSet = new Set<string>();
    if (contactIds.length > 0) {
      const { data: prior } = await supabase
        .from('sms_messages')
        .select('contact_id')
        .in('contact_id', contactIds)
        .eq('tenant_id', blast.tenant_id)
        .limit(1000);
      (prior || []).forEach((p: any) => p.contact_id && priorSet.add(p.contact_id));
    }

    const requireAddress = (blast as any).goal === 'collect_homeowner_email_for_roof_estimate';
    let updated = 0;
    let skippedMissingAddress = 0;
    for (let i = 0; i < (items || []).length; i++) {
      const item = items![i];
      const contact = item.contact_id ? contactsMap.get(item.contact_id) : null;

      // Skip if already personalized AND snapshot already captured (idempotent re-runs).
      // If snapshot is missing on a previously-rendered row, fall through to backfill it.
      if (item.personalized_message && item.personalized_message.length > 0 && (item as any).address_street_snapshot) continue;

      // Address-required gate for email-capture campaigns: NEVER send a homeowner
      // an SMS that asks about "your property" with no real street address attached.
      if (requireAddress && !contact?.address_street) {
        await supabase.from('sms_blast_items').update({
          status: 'failed',
          last_error: 'skipped_missing_address',
          error_message: 'skipped_missing_address',
        }).eq('id', item.id);
        skippedMissingAddress++;
        continue;
      }

      // Rotate template across the pool
      const tpl = templates[i % templates.length];
      const ctx = { contact, company, assigned_user };
      let body = resolveTags(tpl.template_body || '', ctx);

      // Conditional: prior interaction prefix
      if (item.contact_id && priorSet.has(item.contact_id)) {
        body = `We had spoken briefly in the past regarding your property — ${body}`;
      }

      // Conditional: if no address, strip the "around {{contact.address1}}" sentence remnant
      if (!contact?.address_street) {
        body = body.replace(/(?:around|near|at) your property[^.?!]*[.?!]\s*/gi, '');
      }

      await supabase.from('sms_blast_items').update({
        personalized_message: body,
        template_id: tpl.id,
        address_street_snapshot: contact?.address_street || null,
        address_city_snapshot: contact?.address_city || null,
        address_state_snapshot: contact?.address_state || null,
        address_zip_snapshot: contact?.address_zip || null,
      }).eq('id', item.id);
      updated++;
    }

    return new Response(JSON.stringify({
      success: true,
      updated,
      skipped_missing_address: skippedMissingAddress,
      total: items?.length || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[generate-campaign-messages] error', e);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
