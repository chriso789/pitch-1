// Cron worker: every ~2 minutes, polls SRS for every order we currently
// have in `queued` status and promotes/rejects accordingly.
//
// Strategy: find tenants that have queued orders >= 90s old, then call
// srs-api-proxy{action: 'poll_queued_orders'} per tenant so we reuse the
// per-tenant OAuth token + base-URL logic that already lives there.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Tenants with at least one queued order older than 90s
  const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("srs_orders")
    .select("tenant_id")
    .eq("status", "queued")
    .lt("submitted_at", cutoff)
    .limit(500);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tenantIds = Array.from(new Set((rows || []).map((r: any) => r.tenant_id))).filter(Boolean);
  const results: any[] = [];

  for (const tenant_id of tenantIds) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/srs-api-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE}`,
          apikey: SERVICE_ROLE,
        },
        body: JSON.stringify({
          action: "poll_queued_orders",
          tenant_id,
          environment: "production",
        }),
      });
      const body = await resp.json().catch(() => ({}));
      results.push({ tenant_id, ok: resp.ok, polled_count: body?.polled_count ?? 0, body });
    } catch (e: any) {
      results.push({ tenant_id, ok: false, error: e?.message || String(e) });
    }
  }

  return new Response(
    JSON.stringify({ success: true, tenants_polled: tenantIds.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
