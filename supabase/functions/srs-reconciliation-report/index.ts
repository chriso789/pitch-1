// Daily SRS reconciliation: finds every non-terminal srs_order whose local
// status hasn't been updated in >24h, calls srs-api-proxy{get_order_status}
// to refresh, and writes a diff report into srs_reconciliation_runs.
//
// Triggered by pg_cron once a day, or on-demand from the SRS settings panel
// (action: 'run', tenant_id?: string).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TERMINAL = new Set([
  "delivered",
  "cancelled",
  "canceled",
  "rejected",
  "rejected_by_srs",
  "iu", // SRS "invoiced" — treated as terminal
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try { body = await req.json(); } catch { /* cron call has no body */ }
  const requestedTenant: string | null = body?.tenant_id || null;
  const runType: string = body?.run_type || (requestedTenant ? "manual" : "scheduled");
  // Default: orders not touched in >24h that aren't terminal yet
  const staleHours: number = Number(body?.stale_hours ?? 24);
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();

  // Find tenants with stale orders
  let tenantQuery = supabase
    .from("srs_orders")
    .select("tenant_id")
    .not("srs_order_id", "is", null)
    .lt("updated_at", cutoff);
  if (requestedTenant) tenantQuery = tenantQuery.eq("tenant_id", requestedTenant);

  const { data: tenantRows, error: tenantErr } = await tenantQuery.limit(2000);
  if (tenantErr) {
    return new Response(JSON.stringify({ error: tenantErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tenantIds = Array.from(
    new Set((tenantRows || []).map((r: any) => r.tenant_id).filter(Boolean))
  );

  const overall = {
    success: true,
    run_type: runType,
    tenants_processed: 0,
    runs: [] as any[],
  };

  for (const tenant_id of tenantIds) {
    // 1) log a running row
    const { data: runRow } = await supabase
      .from("srs_reconciliation_runs")
      .insert({
        tenant_id,
        run_type: runType,
        status: "running",
      })
      .select()
      .single();

    const runId = runRow?.id;

    // 2) pull this tenant's stale non-terminal orders
    const { data: orders } = await supabase
      .from("srs_orders")
      .select("id, order_number, srs_order_id, status, updated_at, submitted_at")
      .eq("tenant_id", tenant_id)
      .not("srs_order_id", "is", null)
      .lt("updated_at", cutoff)
      .limit(200);

    const eligible = (orders || []).filter(
      (o: any) => !TERMINAL.has(String(o.status || "").toLowerCase())
    );

    const diffs: any[] = [];
    let mismatches = 0;
    let updates = 0;
    let errors = 0;

    for (const order of eligible) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/srs-api-proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: SERVICE_ROLE,
          },
          body: JSON.stringify({
            action: "get_order_status",
            tenant_id,
            order_id: order.id,
            environment: "production",
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok || j?.error) {
          errors++;
          diffs.push({
            order_id: order.id,
            order_number: order.order_number,
            srs_order_id: order.srs_order_id,
            error: j?.error || `HTTP ${resp.status}`,
          });
          continue;
        }

        const remote = String(j?.status || j?.order?.status || "").toLowerCase();
        const local = String(order.status || "").toLowerCase();
        if (remote && remote !== local) {
          mismatches++;
          updates++; // get_order_status already writes through
          diffs.push({
            order_id: order.id,
            order_number: order.order_number,
            srs_order_id: order.srs_order_id,
            local_status: local,
            remote_status: remote,
            corrected: true,
          });
        }
      } catch (e: any) {
        errors++;
        diffs.push({
          order_id: order.id,
          error: e?.message || String(e),
        });
      }
    }

    const completed = new Date().toISOString();
    if (runId) {
      await supabase
        .from("srs_reconciliation_runs")
        .update({
          status: errors === 0 ? "completed" : (mismatches > 0 || updates > 0 ? "completed_with_errors" : "failed"),
          orders_checked: eligible.length,
          mismatches_found: mismatches,
          updates_applied: updates,
          errors_count: errors,
          results: { diffs },
          completed_at: completed,
        })
        .eq("id", runId);
    }

    overall.tenants_processed++;
    overall.runs.push({
      tenant_id,
      run_id: runId,
      orders_checked: eligible.length,
      mismatches,
      updates,
      errors,
    });
  }

  return new Response(JSON.stringify(overall), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
