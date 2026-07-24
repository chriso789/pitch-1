// initialize-project-accounting
// Server-side, idempotent creation of the immutable Project Accounting Snapshot
// for a project. Called from api-approve-job-from-lead after project creation,
// and manually from the Project Accounting Panel.
//
// Security model (matches invoice-create):
//   - Authenticates user via JWT.
//   - Resolves authoritative tenant_id from the project row (service role).
//   - Confirms the caller has real access to that tenant OR is a master with
//     an approved impersonation of it. Never trusts tenant_id from the body.
//   - All writes use the service role.
//   - Emits an audit_log row per call.
//
// Idempotency:
//   - If a `is_current` snapshot exists for the project it is returned as-is
//     (no new snapshot created). Corrections must be handled via a separate
//     supersede endpoint in a later slice.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  project_id?: string;
  // Optional: if the caller already knows the winning estimate, pass it so we
  // don't have to guess. Never used for tenant resolution.
  source_estimate_id?: string;
}

function json(status: number, body: unknown, requestId: string) {
  return new Response(JSON.stringify({ ...(body as object), requestId }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toCents(n: number | null | undefined): number {
  if (!n || Number.isNaN(Number(n))) return 0;
  return Math.round(Number(n) * 100);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, requestId);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "unauthorized" }, requestId);
  }
  const token = authHeader.slice(7);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return json(401, { ok: false, error: "invalid_token" }, requestId);
  }
  const userId = claims.claims.sub as string;

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" }, requestId);
  }
  if (!body.project_id) {
    return json(400, { ok: false, error: "project_id_required" }, requestId);
  }

  // --- Resolve authoritative tenant from the project (service role) ---
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select(
      "id, tenant_id, pipeline_entry_id, name, accounting_readiness, current_accounting_snapshot_id",
    )
    .eq("id", body.project_id)
    .maybeSingle();

  if (projErr || !project) {
    return json(404, { ok: false, error: "project_not_found" }, requestId);
  }
  const effectiveTenantId = project.tenant_id as string;

  // --- Access check: real membership OR master impersonation of this tenant ---
  const { data: access } = await admin
    .from("user_company_access")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", effectiveTenantId)
    .maybeSingle();

  let impersonated = false;
  if (!access) {
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["master", "cob"])
      .maybeSingle();
    if (!roleRow) {
      return json(403, { ok: false, error: "forbidden_tenant" }, requestId);
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || profile.active_tenant_id !== effectiveTenantId) {
      return json(403, { ok: false, error: "impersonation_context_missing" }, requestId);
    }
    impersonated = true;
  }

  // --- Idempotency: if a current snapshot exists, return it. ---
  const { data: existing } = await admin
    .from("project_accounting_snapshots")
    .select("*")
    .eq("project_id", project.id)
    .eq("is_current", true)
    .maybeSingle();

  if (existing) {
    return json(200, {
      ok: true,
      data: {
        snapshot: existing,
        created: false,
        readiness: existing.accounting_readiness,
      },
    }, requestId);
  }

  // --- Resolve winning estimate: explicit id, project link, or latest signed/accepted ---
  let estimate: Record<string, unknown> | null = null;

  if (body.source_estimate_id) {
    const { data } = await admin
      .from("enhanced_estimates")
      .select("*")
      .eq("id", body.source_estimate_id)
      .eq("tenant_id", effectiveTenantId)
      .maybeSingle();
    estimate = data ?? null;
  }

  if (!estimate) {
    const { data } = await admin
      .from("enhanced_estimates")
      .select("*")
      .eq("tenant_id", effectiveTenantId)
      .eq("project_id", project.id)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    estimate = data ?? null;
  }

  if (!estimate && project.pipeline_entry_id) {
    const { data } = await admin
      .from("enhanced_estimates")
      .select("*")
      .eq("tenant_id", effectiveTenantId)
      .eq("pipeline_entry_id", project.pipeline_entry_id)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    estimate = data ?? null;
  }

  // --- Resolve trade from pipeline entry as primary source ---
  let primaryTradeId: string | null = null;
  let primaryTradeName: string | null = null;
  let classificationSource: string = "single_scope_fallback";

  if (project.pipeline_entry_id) {
    const { data: pe } = await admin
      .from("pipeline_entries")
      .select("roof_type")
      .eq("id", project.pipeline_entry_id)
      .maybeSingle();
    if (pe?.roof_type) {
      primaryTradeId = String(pe.roof_type);
      primaryTradeName = String(pe.roof_type);
      classificationSource = "lead_selection";
    }
  }

  if (!primaryTradeId) {
    primaryTradeId = "roofing";
    primaryTradeName = "Roofing";
    classificationSource = "single_scope_fallback";
  }

  // --- Contract math (cents-native) ---
  const originalContract =
    toCents((estimate?.selling_price as number | null) ??
      (estimate?.fixed_selling_price as number | null) ??
      (estimate?.total_with_tax as number | null) ??
      (estimate?.subtotal as number | null) ??
      0);

  // Sum approved change orders / supplements for this project
  const { data: changeOrders } = await admin
    .from("change_orders")
    .select("cost_impact, status")
    .eq("tenant_id", effectiveTenantId)
    .eq("project_id", project.id);
  const approvedCoCents = (changeOrders ?? [])
    .filter((c) =>
      ["approved", "invoiced", "paid", "completed"].includes(String(c.status ?? "").toLowerCase()),
    )
    .reduce((s, c) => s + toCents(c.cost_impact as number | null), 0);

  const currentContract = originalContract + approvedCoCents;

  // Readiness: no invoice math yet — that's Slice 3+. Start at needs_mapping so
  // the UI can prompt for QBO item mapping.
  const readiness = "needs_mapping" as const;

  // --- Insert snapshot + primary scope, then flip project pointer ---
  const { data: snapshot, error: snapErr } = await admin
    .from("project_accounting_snapshots")
    .insert({
      tenant_id: effectiveTenantId,
      project_id: project.id,
      source_lead_id: project.pipeline_entry_id ?? null,
      source_estimate_id: (estimate?.id as string | null) ?? null,
      estimate_template_id: (estimate?.template_id as string | null) ?? null,
      primary_trade_id: primaryTradeId,
      primary_trade_name_snapshot: primaryTradeName,
      classification_source: classificationSource,
      original_contract_value_cents: originalContract,
      approved_change_orders_cents: approvedCoCents,
      current_contract_value_cents: currentContract,
      uninvoiced_contract_balance_cents: currentContract,
      accounting_readiness: readiness,
      created_by: userId,
    })
    .select("*")
    .single();

  if (snapErr || !snapshot) {
    return json(500, { ok: false, error: "snapshot_insert_failed", details: snapErr?.message }, requestId);
  }

  const { error: scopeErr } = await admin
    .from("project_scopes")
    .insert({
      tenant_id: effectiveTenantId,
      project_id: project.id,
      accounting_snapshot_id: snapshot.id,
      trade_id: primaryTradeId,
      trade_name_snapshot: primaryTradeName,
      is_primary: true,
      original_contract_amount_cents: originalContract,
      current_contract_amount_cents: currentContract,
      source_estimate_id: (estimate?.id as string | null) ?? null,
      classification_source: classificationSource,
      status: "active",
    });
  if (scopeErr) {
    return json(500, { ok: false, error: "scope_insert_failed", details: scopeErr.message }, requestId);
  }

  const { error: projUpdErr } = await admin
    .from("projects")
    .update({
      current_accounting_snapshot_id: snapshot.id,
      accounting_readiness: readiness,
    })
    .eq("id", project.id);
  if (projUpdErr) {
    return json(500, { ok: false, error: "project_update_failed", details: projUpdErr.message }, requestId);
  }

  // --- Audit ---
  await admin.from("audit_log").insert({
    tenant_id: effectiveTenantId,
    user_id: userId,
    action: "project_accounting_initialized",
    entity_type: "project",
    entity_id: project.id,
    metadata: {
      request_id: requestId,
      snapshot_id: snapshot.id,
      impersonated,
      classification_source: classificationSource,
      primary_trade_id: primaryTradeId,
      original_contract_value_cents: originalContract,
      current_contract_value_cents: currentContract,
      source_estimate_id: (estimate?.id as string | null) ?? null,
    },
  }).then(() => {}).catch(() => {}); // audit failure never blocks

  return json(200, {
    ok: true,
    data: { snapshot, created: true, readiness },
  }, requestId);
});
