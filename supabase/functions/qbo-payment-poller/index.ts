// Auto-trigger: poll QuickBooks for new/changed Payments and pull them (plus their
// attachments) into Pitch. Runs on a pg_cron schedule as a safety net for missed
// or delayed QBO webhooks. Also invocable manually from the QuickBooks settings UI.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../_shared/qbo-host.ts";
import { getValidAccessToken } from "../_shared/qbo-auth.ts";
import { qboFetch } from "../_shared/qbo/retry.ts";
import { reconcilePaymentFromQbo, type QboConnectionCtx } from "../_shared/qbo/reconciler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LOOKBACK_HOURS = 48;

function qboTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "-00:00");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: { tenant_id?: string; lookback_hours?: number } = {};
  try {
    body = await req.json();
  } catch {
    // cron posts a minimal body; ignore
  }

  const lookbackHours = Number(body.lookback_hours) > 0
    ? Math.min(Number(body.lookback_hours), 24 * 30)
    : DEFAULT_LOOKBACK_HOURS;
  const since = qboTimestamp(new Date(Date.now() - lookbackHours * 3600_000));

  try {
    let connQuery = service
      .from("qbo_connections")
      .select("id, tenant_id, realm_id, is_sandbox, oauth_app_env")
      .eq("is_active", true);
    if (body.tenant_id) connQuery = connQuery.eq("tenant_id", body.tenant_id);

    const { data: connections, error: connErr } = await connQuery;
    if (connErr) throw new Error(connErr.message);

    const results: Array<Record<string, unknown>> = [];

    for (const c of connections ?? []) {
      const connection: QboConnectionCtx = {
        id: c.id,
        tenant_id: c.tenant_id,
        realm_id: c.realm_id,
        is_sandbox: c.is_sandbox ?? null,
        oauth_app_env: c.oauth_app_env ?? null,
      };

      let scanned = 0;
      let reconciled = 0;
      let failed = 0;

      try {
        const query =
          `select * from Payment where MetaData.LastUpdatedTime > '${since}' maxresults 200`;
        const listed = await qboFetch({
          method: "GET",
          url: `${qboHost(connection)}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}&minorversion=75`,
          getAccessToken: async () =>
            (await getValidAccessToken(service, connection.tenant_id)).access_token,
        });

        if (!listed.ok) {
          results.push({
            tenant_id: connection.tenant_id,
            realm_id: connection.realm_id,
            error: "query_failed",
            status: listed.status,
          });
          continue;
        }

        const payments = (listed.json as any)?.QueryResponse?.Payment ?? [];
        scanned = payments.length;

        for (const p of payments) {
          const paymentId = String(p?.Id ?? "");
          if (!paymentId) continue;
          try {
            const r = await reconcilePaymentFromQbo({
              service,
              tenantId: connection.tenant_id,
              connection,
              qboPaymentId: paymentId,
              operation: "Update",
            });
            if (r.ok) reconciled += 1;
            else failed += 1;
          } catch (e) {
            failed += 1;
            console.error("qbo_poll_payment_failed", paymentId, e instanceof Error ? e.message : String(e));
          }
        }
      } catch (e) {
        results.push({
          tenant_id: connection.tenant_id,
          realm_id: connection.realm_id,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      results.push({
        tenant_id: connection.tenant_id,
        realm_id: connection.realm_id,
        scanned,
        reconciled,
        failed,
      });
    }

    console.log("qbo_payment_poll_complete", { since, connections: results.length });

    return new Response(JSON.stringify({ success: true, since, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("qbo-payment-poller failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
