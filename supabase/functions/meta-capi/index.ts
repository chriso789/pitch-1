import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { corsHeaders, handleOptions, json, badRequest, serverError } from '../_shared/http.ts';
import { retry } from '../_shared/utils/retry.ts';

const META_API_VERSION = 'v21.0';

// SHA-256 hash helper (Meta requires lowercase hex)
async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface MetaCapiPayload {
  event_name: string;
  contact_id: string;
  tenant_id: string;
  event_time?: number;
  custom_data?: Record<string, unknown>;
  // Optional overrides when contact data isn't in DB
  email?: string;
  phone?: string;
}

Deno.serve(async (req) => {
  const optRes = handleOptions(req);
  if (optRes) return optRes;

  if (req.method !== 'POST') {
    return badRequest('Method not allowed');
  }

  try {
    const payload: MetaCapiPayload = await req.json();
    const { event_name, contact_id, tenant_id, event_time, custom_data } = payload;

    if (!event_name || !tenant_id) {
      return badRequest('event_name and tenant_id are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Get tenant's Meta CAPI config from settings
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenant_id)
      .single();

    if (tenantError || !tenant) {
      console.error('[meta-capi] Tenant not found:', tenantError);
      return badRequest('Tenant not found');
    }

    const metaConfig = (tenant.settings as Record<string, unknown>)?.meta_capi as {
      pixel_id?: string;
      access_token?: string;
      enabled?: boolean;
    } | undefined;

    if (!metaConfig?.enabled || !metaConfig?.pixel_id || !metaConfig?.access_token) {
      return json({ ok: true, skipped: true, reason: 'Meta CAPI not enabled or missing config' });
    }

    // 2. Get contact data for hashing
    let email = payload.email || '';
    let phone = payload.phone || '';

    if (contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, phone')
        .eq('id', contact_id)
        .single();

      if (contact) {
        email = email || contact.email || '';
        phone = phone || contact.phone || '';
      }
    }

    // 3. Build user_data with SHA-256 hashed PII
    const userData: Record<string, unknown> = {};

    if (email) {
      userData.em = [await sha256(email)];
    }
    if (phone) {
      // Normalize phone to digits only before hashing
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      userData.ph = [await sha256(normalizedPhone)];
    }
    if (contact_id) {
      userData.lead_id = contact_id;
    }

    // 4. Build the Meta CAPI event payload
    const eventPayload = {
      data: [
        {
          event_name,
          event_time: event_time || Math.floor(Date.now() / 1000),
          action_source: 'system_generated',
          event_id: contact_id || crypto.randomUUID(), // deduplication
          custom_data: {
            event_source: 'crm',
            lead_event_source: 'PITCH CRM',
            ...(custom_data || {}),
          },
          user_data: userData,
        },
      ],
    };

    // 5. Send to Meta Graph API with retry on 5xx
    const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${metaConfig.pixel_id}/events?access_token=${metaConfig.access_token}`;

    const metaResponse = await retry(
      async () => {
        const res = await fetch(metaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventPayload),
        });

        if (res.status >= 500) {
          throw new Error(`Meta API returned ${res.status}`);
        }
        return res;
      },
      { retries: 1, baseDelay: 1000 }
    );

    const metaResult = await metaResponse.json();

    // 6. Log result to audit_log
    await supabase.from('audit_log').insert({
      tenant_id,
      action: metaResponse.ok ? 'meta_capi_event_sent' : 'meta_capi_event_failed',
      table_name: 'meta_capi',
      record_id: contact_id || null,
      new_values: {
        event_name,
        status: metaResponse.status,
        response: metaResult,
        events_received: metaResult?.events_received,
      },
    });

    if (!metaResponse.ok) {
      console.error('[meta-capi] Meta API error:', metaResult);
      return json({ ok: false, error: metaResult }, metaResponse.status);
    }

    console.log('[meta-capi] Event sent successfully:', {
      event_name,
      contact_id,
      events_received: metaResult?.events_received,
    });

    return json({ ok: true, events_received: metaResult?.events_received });
  } catch (err) {
    console.error('[meta-capi] Error:', err);
    return serverError(err);
  }
});
