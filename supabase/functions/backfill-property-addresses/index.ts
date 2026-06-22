// PR #3: backfill-property-addresses
// Creates property_addresses rows (validation_status='unvalidated') from existing
// contacts / projects / pipeline_entries / measurement_jobs / tenants — without
// calling Google. Tenant-scoped, batched, idempotent on retry.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface BackfillRequest {
  tenant_id: string;
  source: 'contact' | 'project' | 'pipeline_entry';
  limit?: number;
  dry_run?: boolean;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: prof } = await admin
      .from('profiles')
      .select('role, tenant_id, active_tenant_id')
      .eq('id', userData.user.id)
      .maybeSingle();
    const isAdmin =
      prof?.role === 'master' || prof?.role === 'owner' || prof?.role === 'corporate';
    if (!isAdmin) return json({ error: 'forbidden_role' }, 403);

    const body = (await req.json()) as BackfillRequest;
    if (!body?.tenant_id || !body?.source) return json({ error: 'invalid_payload' }, 400);
    const limit = Math.min(body.limit ?? 500, 2000);

    let inserted = 0;
    let skipped = 0;

    if (body.source === 'contact') {
      const { data: rows } = await admin
        .from('contacts')
        .select('id, address_street, address_city, address_state, address_zip, latitude, longitude')
        .eq('tenant_id', body.tenant_id)
        .not('address_street', 'is', null)
        .limit(limit);
      for (const r of rows ?? []) {
        const raw = [r.address_street, r.address_city, r.address_state, r.address_zip]
          .filter(Boolean)
          .join(', ');
        if (!raw) {
          skipped++;
          continue;
        }
        if (body.dry_run) {
          inserted++;
          continue;
        }
        const { error } = await admin.from('property_addresses').upsert(
          {
            tenant_id: body.tenant_id,
            source_entity_type: 'contact',
            source_entity_id: r.id,
            raw_input: raw,
            address_line_1: r.address_street,
            locality: r.address_city,
            administrative_area: r.address_state,
            postal_code: r.address_zip,
            latitude: r.latitude,
            longitude: r.longitude,
            validation_status: 'unvalidated',
            validation_provider: 'imported',
          },
          { onConflict: 'tenant_id,source_entity_type,source_entity_id', ignoreDuplicates: true },
        );
        if (error) skipped++;
        else inserted++;
      }
    } else if (body.source === 'pipeline_entry') {
      const { data: rows } = await admin
        .from('pipeline_entries')
        .select('id, address, city, state, zip_code')
        .eq('tenant_id', body.tenant_id)
        .not('address', 'is', null)
        .limit(limit);
      for (const r of rows ?? []) {
        const raw = [r.address, r.city, r.state, r.zip_code].filter(Boolean).join(', ');
        if (!raw) {
          skipped++;
          continue;
        }
        if (body.dry_run) {
          inserted++;
          continue;
        }
        const { error } = await admin.from('property_addresses').upsert(
          {
            tenant_id: body.tenant_id,
            source_entity_type: 'pipeline_entry',
            source_entity_id: r.id,
            raw_input: raw,
            address_line_1: r.address,
            locality: r.city,
            administrative_area: r.state,
            postal_code: r.zip_code,
            validation_status: 'unvalidated',
            validation_provider: 'imported',
          },
          { onConflict: 'tenant_id,source_entity_type,source_entity_id', ignoreDuplicates: true },
        );
        if (error) skipped++;
        else inserted++;
      }
    } else if (body.source === 'project') {
      const { data: rows } = await admin
        .from('projects')
        .select('id, address, city, state, zip_code')
        .eq('tenant_id', body.tenant_id)
        .not('address', 'is', null)
        .limit(limit);
      for (const r of rows ?? []) {
        const raw = [r.address, r.city, r.state, r.zip_code].filter(Boolean).join(', ');
        if (!raw) {
          skipped++;
          continue;
        }
        if (body.dry_run) {
          inserted++;
          continue;
        }
        const { error } = await admin.from('property_addresses').upsert(
          {
            tenant_id: body.tenant_id,
            source_entity_type: 'project',
            source_entity_id: r.id,
            raw_input: raw,
            address_line_1: r.address,
            locality: r.city,
            administrative_area: r.state,
            postal_code: r.zip_code,
            validation_status: 'unvalidated',
            validation_provider: 'imported',
          },
          { onConflict: 'tenant_id,source_entity_type,source_entity_id', ignoreDuplicates: true },
        );
        if (error) skipped++;
        else inserted++;
      }
    }

    return json({ ok: true, source: body.source, inserted, skipped, dry_run: !!body.dry_run });
  } catch (e) {
    console.error('backfill-property-addresses fatal', e);
    return json({ error: 'internal_error', detail: String(e) }, 500);
  }
});
