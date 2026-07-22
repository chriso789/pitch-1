// Master-only admin view of supplier_audit_log across ALL tenants.
// The console at /admin/companies → Integrations needs to inspect the
// sandbox testing originally performed inside the O'Brien Contracting
// tenant when ABC/SRS/QXO/etc. were first wired up. RLS on
// supplier_audit_log scopes by tenant membership, so a master signed in
// to a different tenant cannot see those historical rows. This function
// verifies the caller is `master` via has_role(), then reads with the
// service role and joins the tenant name for display.
//
// Auth mode: authenticated tenant route + master role check (declared).
// Service role usage: manual supplier + (optional) tenant_id filter.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// redeploy trigger v2
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "missing_auth" }, 401);
    }

    // Resolve caller from JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) {
      return json({ ok: false, error: "invalid_token" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Master gate
    const { data: isMaster } = await admin.rpc("has_role", {
      _user_id: u.user.id,
      _role: "master",
    });
    if (!isMaster) {
      return json({ ok: false, error: "forbidden_master_only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const supplier: string | undefined = body.supplier;
    const tenantId: string | undefined = body.tenant_id;
    const actionFilter: string | undefined = body.action;
    const limit = Math.min(Number(body.limit ?? 100), 500);

    if (!supplier) {
      return json({ ok: false, error: "supplier_required" }, 400);
    }

    let q = admin
      .from("supplier_audit_log")
      .select(
        "id, created_at, supplier, action, result, tenant_id, request_id, metadata, user_id",
      )
      .eq("supplier", supplier)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (actionFilter) q = q.ilike("action", `%${actionFilter}%`);

    const { data: rows, error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);

    let merged: any[] = (rows ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      supplier: r.supplier,
      action: r.action,
      result: r.result,
      tenant_id: r.tenant_id,
      request_id: r.request_id,
      metadata: r.metadata,
      user_id: r.user_id,
      source: "supplier_audit_log",
    }));

    // For QBO, also surface webhook + reconciliation trails which live in
    // dedicated tables (qbo_webhook_events, invoice_reconciliation_events).
    if (supplier === "qbo") {
      let wq = admin
        .from("qbo_webhook_events")
        .select("id, tenant_id, realm_id, oauth_app_env, signature_valid, event_count, received_at, processed_at, error_code, error_message, dedup_key")
        .order("received_at", { ascending: false })
        .limit(limit);
      if (tenantId) wq = wq.eq("tenant_id", tenantId);
      const { data: webhookRows } = await wq;

      let rq = admin
        .from("invoice_reconciliation_events")
        .select("id, tenant_id, realm_id, event_type, authoritative_source, qbo_invoice_id, qbo_payment_id, balance_before, balance_after, total_amount, amount_applied, intuit_tid, details, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (tenantId) rq = rq.eq("tenant_id", tenantId);
      const { data: reconRows } = await rq;

      for (const w of webhookRows ?? []) {
        merged.push({
          id: w.id,
          created_at: w.received_at,
          supplier: "qbo",
          action: `webhook:${w.signature_valid ? "verified" : "rejected"}${w.processed_at ? ":processed" : ""}`,
          result: w.error_code ? "error" : (w.processed_at ? "ok" : "received"),
          tenant_id: w.tenant_id,
          request_id: w.dedup_key,
          metadata: {
            realm_id: w.realm_id,
            oauth_app_env: w.oauth_app_env,
            event_count: w.event_count,
            error_code: w.error_code,
            error_message: w.error_message,
          },
          user_id: null,
          source: "qbo_webhook_events",
        });
      }
      for (const r of reconRows ?? []) {
        merged.push({
          id: r.id,
          created_at: r.created_at,
          supplier: "qbo",
          action: `reconcile:${r.event_type}`,
          result: r.authoritative_source ?? "ok",
          tenant_id: r.tenant_id,
          request_id: r.intuit_tid,
          metadata: {
            realm_id: r.realm_id,
            qbo_invoice_id: r.qbo_invoice_id,
            qbo_payment_id: r.qbo_payment_id,
            balance_before: r.balance_before,
            balance_after: r.balance_after,
            total_amount: r.total_amount,
            amount_applied: r.amount_applied,
            details: r.details,
          },
          user_id: null,
          source: "invoice_reconciliation_events",
        });
      }

      if (actionFilter) {
        const needle = actionFilter.toLowerCase();
        merged = merged.filter((m) => (m.action ?? "").toLowerCase().includes(needle));
      }
      merged.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      merged = merged.slice(0, limit);
    }

    // Resolve tenant names
    const tenantIds = Array.from(
      new Set(merged.map((r) => r.tenant_id).filter(Boolean)),
    );
    let tenantMap: Record<string, string> = {};
    if (tenantIds.length) {
      const { data: tenants } = await admin
        .from("tenants")
        .select("id, name")
        .in("id", tenantIds);
      tenantMap = Object.fromEntries(
        (tenants ?? []).map((t: any) => [t.id, t.name]),
      );
    }

    const enriched = merged.map((r) => ({
      ...r,
      tenant_name: tenantMap[r.tenant_id] ?? null,
    }));

    return json({ ok: true, rows: enriched, count: enriched.length });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? "unknown" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
