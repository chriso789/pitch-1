// PR #3: validate-property-address edge function
// Calls Google Address Validation server-side, classifies the result,
// upserts the canonical property_addresses row, and writes history.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  classifyGoogleAddressValidation,
  ValidationStatus,
} from '../_shared/address-validation.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ValidateRequest {
  tenant_id: string;
  source_entity_type:
    | 'contact'
    | 'company'
    | 'pipeline_entry'
    | 'project'
    | 'order'
    | 'permit'
    | 'measurement_request';
  source_entity_id: string;
  raw_input?: string;
  address_lines?: string[];
  locality?: string;
  administrative_area?: string;
  postal_code?: string;
  country_code?: string;
  place_id?: string;
  session_token?: string;
  force_revalidate?: boolean;
}

const ENTITY_TYPES = new Set([
  'contact',
  'company',
  'pipeline_entry',
  'project',
  'order',
  'permit',
  'measurement_request',
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    if (!GOOGLE_MAPS_API_KEY) return jsonResponse({ error: 'google_key_missing' }, 500);

    // Validate caller
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = (await req.json()) as ValidateRequest;
    if (
      !body?.tenant_id ||
      !body?.source_entity_id ||
      !body?.source_entity_type ||
      !ENTITY_TYPES.has(body.source_entity_type)
    ) {
      return jsonResponse({ error: 'invalid_payload' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Tenant membership check
    const { data: prof } = await admin
      .from('profiles')
      .select('tenant_id, active_tenant_id, role')
      .eq('id', userData.user.id)
      .maybeSingle();
    const allowedTenants = new Set(
      [prof?.tenant_id, prof?.active_tenant_id].filter(Boolean) as string[],
    );
    const isMaster = prof?.role === 'master';
    if (!isMaster && !allowedTenants.has(body.tenant_id)) {
      return jsonResponse({ error: 'tenant_mismatch' }, 403);
    }

    const addressLines =
      body.address_lines && body.address_lines.length
        ? body.address_lines
        : body.raw_input
          ? [body.raw_input]
          : [];
    if (addressLines.length === 0 && !body.place_id) {
      return jsonResponse({ error: 'no_address_input' }, 400);
    }

    const rawInput =
      body.raw_input ??
      [addressLines.join(', '), body.locality, body.administrative_area, body.postal_code]
        .filter(Boolean)
        .join(', ');

    // Idempotency: skip Google call if we already have a non-stale validation
    if (!body.force_revalidate) {
      const { data: existing } = await admin
        .from('property_addresses')
        .select('*')
        .eq('tenant_id', body.tenant_id)
        .eq('source_entity_type', body.source_entity_type)
        .eq('source_entity_id', body.source_entity_id)
        .is('archived_at', null)
        .maybeSingle();
      if (
        existing &&
        existing.raw_input === rawInput &&
        existing.validation_status !== 'unvalidated' &&
        existing.validated_at
      ) {
        return jsonResponse({
          property_address_id: existing.id,
          validation_status: existing.validation_status,
          formatted_address: existing.formatted_address,
          decision_reason: 'cached',
          suggested_components: {},
          missing_component_types: existing.missing_component_types ?? [],
          unresolved_tokens: existing.unresolved_tokens ?? [],
          latitude: existing.latitude,
          longitude: existing.longitude,
          place_id: existing.place_id,
        });
      }
    }

    // Call Google Address Validation
    const reqBody: Record<string, unknown> = {
      address: {
        regionCode: body.country_code ?? 'US',
        addressLines,
        locality: body.locality ?? '',
        administrativeArea: body.administrative_area ?? '',
        postalCode: body.postal_code ?? '',
      },
      enableUspsCass: (body.country_code ?? 'US') === 'US',
    };
    if (body.session_token) reqBody.sessionToken = body.session_token;

    let classified;
    let payload: any = null;
    try {
      const r = await fetch(
        `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_MAPS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        },
      );
      if (!r.ok) throw new Error(`google_${r.status}`);
      payload = await r.json();
      classified = classifyGoogleAddressValidation(payload);
    } catch (e) {
      // Non-destructive: store/update as unvalidated, record history
      console.error('google_validation_error', e);
      const { data: row } = await admin
        .from('property_addresses')
        .upsert(
          {
            tenant_id: body.tenant_id,
            source_entity_type: body.source_entity_type,
            source_entity_id: body.source_entity_id,
            raw_input: rawInput,
            validation_status: 'unvalidated',
          },
          { onConflict: 'tenant_id,source_entity_type,source_entity_id' },
        )
        .select()
        .single();
      if (row) {
        await admin.from('property_address_validation_history').insert({
          tenant_id: body.tenant_id,
          property_address_id: row.id,
          source_entity_type: body.source_entity_type,
          source_entity_id: body.source_entity_id,
          previous_status: row.validation_status,
          next_status: 'unvalidated',
          provider: 'google_address_validation',
          raw_input: rawInput,
          decision_payload: { error: String(e) },
          actor_user_id: userData.user.id,
        });
      }
      return jsonResponse(
        { error: 'google_unavailable', property_address_id: row?.id ?? null },
        503,
      );
    }

    // Persist canonical row
    const { data: prior } = await admin
      .from('property_addresses')
      .select('id, validation_status')
      .eq('tenant_id', body.tenant_id)
      .eq('source_entity_type', body.source_entity_type)
      .eq('source_entity_id', body.source_entity_id)
      .is('archived_at', null)
      .maybeSingle();

    const upsertPayload = {
      tenant_id: body.tenant_id,
      source_entity_type: body.source_entity_type,
      source_entity_id: body.source_entity_id,
      raw_input: rawInput,
      formatted_address: classified.formatted_address,
      address_line_1: classified.address_line_1,
      address_line_2: classified.address_line_2,
      locality: classified.locality,
      administrative_area: classified.administrative_area,
      postal_code: classified.postal_code,
      country_code: classified.country_code,
      latitude: classified.latitude,
      longitude: classified.longitude,
      place_id: classified.place_id,
      validation_status: classified.status as ValidationStatus,
      validation_provider: 'google_address_validation',
      validation_granularity: classified.validation_granularity,
      geocode_granularity: classified.geocode_granularity,
      address_complete: classified.address_complete,
      has_inferred_components: classified.has_inferred_components,
      has_replaced_components: classified.has_replaced_components,
      has_spell_corrected_components: classified.has_spell_corrected_components,
      has_unconfirmed_components: classified.has_unconfirmed_components,
      missing_component_types: classified.missing_component_types,
      unresolved_tokens: classified.unresolved_tokens,
      usps_dpv_confirmation: classified.usps_dpv_confirmation,
      is_residential: classified.is_residential,
      is_po_box: classified.is_po_box,
      validation_response_id: classified.validation_response_id,
      validation_payload: payload,
      validated_at: new Date().toISOString(),
      validated_by: userData.user.id,
    };

    const { data: saved, error: saveErr } = await admin
      .from('property_addresses')
      .upsert(upsertPayload, {
        onConflict: 'tenant_id,source_entity_type,source_entity_id',
      })
      .select()
      .single();
    if (saveErr) return jsonResponse({ error: 'persist_failed', detail: saveErr.message }, 500);

    await admin.from('property_address_validation_history').insert({
      tenant_id: body.tenant_id,
      property_address_id: saved.id,
      source_entity_type: body.source_entity_type,
      source_entity_id: body.source_entity_id,
      previous_status: prior?.validation_status ?? null,
      next_status: classified.status,
      provider: 'google_address_validation',
      raw_input: rawInput,
      formatted_address: classified.formatted_address,
      validation_payload: payload,
      decision_payload: {
        reason: classified.decision_reason,
        missing_component_types: classified.missing_component_types,
        unresolved_tokens: classified.unresolved_tokens,
      },
      actor_user_id: userData.user.id,
    });

    return jsonResponse({
      property_address_id: saved.id,
      validation_status: classified.status,
      formatted_address: classified.formatted_address,
      decision_reason: classified.decision_reason,
      suggested_components: classified.suggested_components,
      missing_component_types: classified.missing_component_types,
      unresolved_tokens: classified.unresolved_tokens,
      latitude: classified.latitude,
      longitude: classified.longitude,
      place_id: classified.place_id,
    });
  } catch (e) {
    console.error('validate-property-address fatal', e);
    return jsonResponse({ error: 'internal_error', detail: String(e) }, 500);
  }
});
