import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const APPROVED_TEMPLATES: Array<{
  name: string; body: string; category: string; goal: string;
}> = [
  { name: 'Roof Estimate Email Capture — Direct', category: 'roof_estimate', goal: 'collect_homeowner_email_for_roof_estimate',
    body: "Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.address_street}}. What's the best email to send it to?\n\nWe can also help walk you through the My Safe Florida Home Program if the roof qualifies." },
  { name: 'Roof Estimate Email Capture — Grant Angle', category: 'roof_estimate', goal: 'collect_homeowner_email_for_roof_estimate',
    body: "Hi {{contact.first_name}}, we put together roof replacement pricing for {{contact.address_street}}. Send over the best email and we'll get it to you.\n\nThere may also be up to $10,000 available through My Safe Florida Home for qualifying roof replacements." },
  { name: 'Roof Estimate Email Capture — Soft Local', category: 'roof_estimate', goal: 'collect_homeowner_email_for_roof_estimate',
    body: "Hi {{contact.first_name}}, quick follow-up on {{contact.address_street}}. We have roof replacement numbers ready and just need the best email to send them to.\n\nWe can also help explain the My Safe Florida Home grant process." },
  { name: 'MSFH Grant — Education First', category: 'grant_followup', goal: 'msfh_grant',
    body: "Hi {{contact.first_name}}, Florida has a roof grant program called My Safe Florida Home that may help qualified homeowners with roof replacement costs.\n\nWe help homeowners understand the steps and paperwork. Want us to check {{contact.address_street}}?" },
  { name: 'MSFH Grant — Inspection Angle', category: 'grant_followup', goal: 'msfh_grant',
    body: "Hi {{contact.first_name}}, My Safe Florida Home usually starts with eligibility and inspection steps. We help homeowners figure out what applies before they waste time.\n\nWant us to review {{contact.address_street}}?" },
  { name: 'MSFH Grant — Simple Ask', category: 'grant_followup', goal: 'msfh_grant',
    body: "Hi {{contact.first_name}}, we're helping Florida homeowners understand the My Safe Florida Home roof grant process.\n\nWould you like help checking whether {{contact.address_street}} may qualify?" },
  { name: 'Storm Canvass — Neighborly', category: 'storm_followup', goal: 'storm_canvass',
    body: "Hi {{contact.first_name}}, we're checking roofs near {{contact.address_street}} after recent weather. Small roof issues can turn into leaks fast in Florida.\n\nWould you like us to take a look?" },
  { name: 'Storm Canvass — Estimate', category: 'storm_followup', goal: 'storm_canvass',
    body: "Hi {{contact.first_name}}, we're following up on {{contact.address_street}} after recent storms. We can check for missing shingles, lifted flashing, soft spots, or leak risks.\n\nWant a quick roof review?" },
  { name: 'Storm Canvass — Insurance Awareness', category: 'storm_followup', goal: 'storm_canvass',
    body: "Hi {{contact.first_name}}, if {{contact.address_street}} took wind or storm damage, it's better to document it before leaks show up.\n\nWould you like us to inspect and document the roof condition?" },
  { name: 'Dormant Lead Reactivation — Still Interested', category: 'reactivation', goal: 'dormant_reactivation',
    body: "Hi {{contact.first_name}}, we had {{contact.address_street}} in our system from a previous roofing conversation. Are you still considering repair or replacement options?" },
  { name: 'Dormant Lead Reactivation — Pricing Changed', category: 'reactivation', goal: 'dormant_reactivation',
    body: "Hi {{contact.first_name}}, following up on {{contact.address_street}}. Roofing prices, grants, and financing options may have changed since we last spoke.\n\nWant us to update the numbers?" },
  { name: 'Dormant Lead Reactivation — Soft Check-In', category: 'reactivation', goal: 'dormant_reactivation',
    body: "Hi {{contact.first_name}}, checking back in on {{contact.address_street}}. Did you ever move forward with the roof, or are you still comparing options?" },
  { name: 'General Outreach — Property Specific', category: 'general', goal: 'general_outreach',
    body: "Hi {{contact.first_name}}, this is {{company.name}} following up about {{contact.address_street}}. Would you like us to send over roof options or schedule a quick review?" },
  { name: 'General Outreach — Simple Follow-Up', category: 'general', goal: 'general_outreach',
    body: "Hi {{contact.first_name}}, just following up from {{company.name}}. Do you still need help with anything roof-related at {{contact.address_street}}?" },
  { name: 'General Outreach — Local Roofing Help', category: 'general', goal: 'general_outreach',
    body: "Hi {{contact.first_name}}, we help Florida homeowners with roof repairs, replacements, inspections, and storm documentation.\n\nWould you like help with {{contact.address_street}}?" },
];

const normalize = (s: string) =>
  String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

async function resolveCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return { error: 'missing auth', status: 401 };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return { error: 'invalid auth', status: 401 };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: profile } = await admin
    .from('profiles')
    .select('id, tenant_id, active_tenant_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();

  return {
    userId: userData.user.id,
    profileTenantId: profile?.active_tenant_id || profile?.tenant_id || null,
    role: profile?.role || null,
    admin,
  };
}

async function processTenant(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  dryRun: boolean,
) {
  const { data: rows, error } = await admin
    .from('sms_templates')
    .select('id, tenant_id, template_name, template_body, goal, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (error) throw error;

  const groups = new Map<string, any[]>();
  for (const r of rows || []) {
    const key = [
      tenantId,
      r.goal || 'general_outreach',
      normalize(r.template_name),
      normalize(r.template_body),
    ].join('|');
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }

  const duplicateIds: string[] = [];
  let duplicateGroups = 0;
  for (const arr of groups.values()) {
    if (arr.length > 1) {
      duplicateGroups++;
      arr.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
      for (let i = 1; i < arr.length; i++) duplicateIds.push(arr[i].id);
    }
  }

  let templatesUpdated = 0;
  let templatesInserted = 0;

  if (!dryRun) {
    if (duplicateIds.length) {
      const { error: updErr } = await admin
        .from('sms_templates')
        .update({ active: false, updated_at: new Date().toISOString() })
        .in('id', duplicateIds);
      if (updErr) throw updErr;
    }

    for (const tmpl of APPROVED_TEMPLATES) {
      const normName = normalize(tmpl.name);
      const { data: existing } = await admin
        .from('sms_templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('normalized_template_name', normName)
        .eq('goal', tmpl.goal)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error: e } = await admin
          .from('sms_templates')
          .update({
            template_body: tmpl.body,
            category: tmpl.category,
            goal: tmpl.goal,
            active: true,
          })
          .eq('id', existing.id);
        if (e) throw e;
        templatesUpdated++;
      } else {
        const { error: e } = await admin.from('sms_templates').insert({
          tenant_id: tenantId,
          template_name: tmpl.name,
          template_body: tmpl.body,
          category: tmpl.category,
          goal: tmpl.goal,
          active: true,
        });
        if (e) throw e;
        templatesInserted++;
      }
    }
  }

  return {
    tenant_id: tenantId,
    duplicate_groups: duplicateGroups,
    duplicates_to_inactivate: duplicateIds.length,
    templates_to_upsert: APPROVED_TEMPLATES.length,
    templates_updated: templatesUpdated,
    templates_inserted: templatesInserted,
  };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestedTenantId: string | undefined = body.tenant_id;
    const dryRun: boolean = body.dry_run !== false; // default true for safety

    // Check service role caller
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === SERVICE_ROLE;

    let admin: ReturnType<typeof createClient>;
    let scopedTenantIds: string[] = [];

    if (isServiceRole) {
      admin = createClient(SUPABASE_URL, SERVICE_ROLE);
      if (requestedTenantId) {
        scopedTenantIds = [requestedTenantId];
      } else {
        const { data: tenants, error } = await admin.from('tenants').select('id');
        if (error) throw error;
        scopedTenantIds = (tenants || []).map((t: any) => t.id);
      }
    } else {
      const caller = await resolveCaller(req);
      if ('error' in caller) {
        return new Response(JSON.stringify({ error: caller.error }), {
          status: caller.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!caller.profileTenantId) {
        return new Response(JSON.stringify({ error: 'no tenant for user' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const allowedRoles = ['admin', 'owner', 'manager', 'master', 'corporate'];
      if (!caller.role || !allowedRoles.includes(caller.role)) {
        return new Response(JSON.stringify({ error: 'insufficient role' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const target = requestedTenantId || caller.profileTenantId;
      if (target !== caller.profileTenantId) {
        return new Response(JSON.stringify({ error: 'cannot operate on other tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      admin = caller.admin;
      scopedTenantIds = [target];
    }

    const results = [];
    for (const tid of scopedTenantIds) {
      results.push(await processTenant(admin, tid, dryRun));
    }

    const agg = results.reduce(
      (acc, r) => ({
        duplicate_groups: acc.duplicate_groups + r.duplicate_groups,
        duplicates_to_inactivate: acc.duplicates_to_inactivate + r.duplicates_to_inactivate,
        templates_to_upsert: r.templates_to_upsert,
        templates_updated: acc.templates_updated + r.templates_updated,
        templates_inserted: acc.templates_inserted + r.templates_inserted,
      }),
      { duplicate_groups: 0, duplicates_to_inactivate: 0, templates_to_upsert: 15, templates_updated: 0, templates_inserted: 0 },
    );

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      tenant_id: requestedTenantId || null,
      tenants_processed: scopedTenantIds.length,
      ...agg,
      per_tenant: results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const handle = handler;
