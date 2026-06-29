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

    // Resolve tenant names
    const tenantIds = Array.from(
      new Set((rows ?? []).map((r) => r.tenant_id).filter(Boolean)),
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

    const enriched = (rows ?? []).map((r) => ({
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
