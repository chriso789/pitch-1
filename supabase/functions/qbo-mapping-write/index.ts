// qbo-mapping-write
// Slice 2b — mapping CRUD + server-side validation + auto re-resolve.
// Actions: create, update, disable, enable, validate, validate_all
// Auth model: JWT required, tenant resolved server-side, master users
// must have active_tenant_id set to the mapping's tenant.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient } from "../_shared/qbo-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown, requestId: string) {
  return new Response(JSON.stringify({ ...(body as object), requestId }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface MappingWriteInput {
  qbo_connection_id: string;
  trade_id: string;
  project_type_id: string;
  job_type_id?: string | null;
  qbo_item_id: string;
  qbo_class_id?: string | null;
  qbo_department_id?: string | null;
  qbo_tax_code_id?: string | null;
  qbo_terms_id?: string | null;
  default_allow_credit_card?: boolean;
  default_allow_ach?: boolean;
  invoice_template_key?: string | null;
  customer_memo_template?: string | null;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, requestId);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "unauthorized" }, requestId);
  const token = authHeader.slice(7);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const admin = createServiceClient();

  const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json(401, { ok: false, error: "invalid_token" }, requestId);
  const userId = claims.claims.sub as string;

  let payload: any;
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: "invalid_json" }, requestId); }
  const action = String(payload?.action ?? "");

  // Resolve tenant server-side
  const { data: profile } = await admin.from("profiles").select("active_tenant_id, tenant_id").eq("id", userId).maybeSingle();
  const effectiveTenantId = (profile?.active_tenant_id || profile?.tenant_id) as string | null;
  if (!effectiveTenantId) return json(403, { ok: false, error: "no_tenant" }, requestId);

  const { data: access } = await admin.from("user_company_access")
    .select("id").eq("user_id", userId).eq("tenant_id", effectiveTenantId).maybeSingle();
  let impersonated = false;
  if (!access) {
    const { data: roleRow } = await admin.from("user_roles").select("role")
      .eq("user_id", userId).in("role", ["master", "cob"]).maybeSingle();
    if (!roleRow || profile?.active_tenant_id !== effectiveTenantId) {
      return json(403, { ok: false, error: "forbidden_tenant" }, requestId);
    }
    impersonated = true;
  }

  const audit = async (event: string, mapping_id: string | null, extras: Record<string, unknown> = {}) => {
    await admin.from("accounting_audit_events").insert({
      tenant_id: effectiveTenantId, event_type: event, actor_user_id: userId,
      effective_tenant_id: effectiveTenantId, impersonation: impersonated,
      mapping_id, correlation_id: requestId, new_value: extras,
    });
  };

  const validateAndReresolve = async (mappingId: string) => {
    const { data: vres } = await admin.rpc("validate_scope_mapping", { p_mapping_id: mappingId });
    const { data: rc } = await admin.rpc("reresolve_projects_for_mapping", { p_mapping_id: mappingId });
    return { validation: vres?.[0] ?? null, projects_reresolved: Number(rc ?? 0) };
  };

  // Ensure a supplied qbo_connection_id belongs to the effective tenant
  const verifyConn = async (connId: string): Promise<boolean> => {
    const { data } = await admin.from("qbo_connections").select("id").eq("id", connId).eq("tenant_id", effectiveTenantId).maybeSingle();
    return !!data;
  };

  try {
    if (action === "create" || action === "update") {
      const inp = payload?.mapping as MappingWriteInput;
      if (!inp?.qbo_connection_id || !inp?.trade_id || !inp?.project_type_id || !inp?.qbo_item_id) {
        return json(400, { ok: false, error: "missing_required_fields" }, requestId);
      }
      if (!(await verifyConn(inp.qbo_connection_id))) {
        return json(403, { ok: false, error: "connection_not_owned" }, requestId);
      }
      // Verify the item belongs to that connection cache
      const { data: itemRow } = await admin.from("qbo_item_cache")
        .select("qbo_id").eq("qbo_connection_id", inp.qbo_connection_id).eq("qbo_id", inp.qbo_item_id).maybeSingle();
      if (!itemRow) return json(400, { ok: false, error: "item_not_in_catalog" }, requestId);

      const base = {
        tenant_id: effectiveTenantId,
        qbo_connection_id: inp.qbo_connection_id,
        trade_id: inp.trade_id,
        project_type_id: inp.project_type_id,
        job_type_id: inp.job_type_id ?? null,
        job_type_key: inp.job_type_id ?? "__null__",
        qbo_item_id: inp.qbo_item_id,
        qbo_class_id: inp.qbo_class_id ?? null,
        qbo_department_id: inp.qbo_department_id ?? null,
        qbo_tax_code_id: inp.qbo_tax_code_id ?? null,
        qbo_terms_id: inp.qbo_terms_id ?? null,
        default_allow_credit_card: inp.default_allow_credit_card ?? true,
        default_allow_ach: inp.default_allow_ach ?? true,
        invoice_template_key: inp.invoice_template_key ?? null,
        customer_memo_template: inp.customer_memo_template ?? null,
        active: true,
        validation_status: "unvalidated",
        validation_error: null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      };

      let mappingId: string;
      if (action === "create") {
        // Partial unique index doesn't support ON CONFLICT — check-then-insert.
        const { data: existing } = await admin
          .from("project_scope_accounting_mappings")
          .select("id")
          .eq("tenant_id", effectiveTenantId)
          .eq("qbo_connection_id", inp.qbo_connection_id)
          .eq("trade_id", inp.trade_id)
          .eq("project_type_id", inp.project_type_id)
          .eq("job_type_key", inp.job_type_id ?? "__null__")
          .eq("active", true)
          .is("archived_at", null)
          .maybeSingle();
        if (existing) return json(409, { ok: false, error: "duplicate_mapping", mapping_id: existing.id }, requestId);
        const { data, error } = await admin
          .from("project_scope_accounting_mappings")
          .insert({ ...base, created_by: userId })
          .select("id")
          .single();
        if (error) return json(400, { ok: false, error: "create_failed", detail: error.message }, requestId);
        mappingId = data.id;
        await audit("accounting_mapping_created", mappingId, { input: inp });
      } else {
        const id = payload?.mapping_id;
        if (!id) return json(400, { ok: false, error: "mapping_id_required" }, requestId);
        const { data: existing } = await admin.from("project_scope_accounting_mappings")
          .select("tenant_id").eq("id", id).maybeSingle();
        if (!existing || existing.tenant_id !== effectiveTenantId) {
          return json(403, { ok: false, error: "mapping_not_owned" }, requestId);
        }
        const { error } = await admin.from("project_scope_accounting_mappings").update(base).eq("id", id);
        if (error) return json(400, { ok: false, error: "update_failed", detail: error.message }, requestId);
        mappingId = id;
        await audit("accounting_mapping_updated", mappingId, { input: inp });
      }

      const vr = await validateAndReresolve(mappingId);
      await audit("accounting_mapping_validated", mappingId, vr);
      return json(200, { ok: true, data: { mapping_id: mappingId, ...vr } }, requestId);
    }

    if (action === "validate") {
      const id = payload?.mapping_id;
      if (!id) return json(400, { ok: false, error: "mapping_id_required" }, requestId);
      const { data: m } = await admin.from("project_scope_accounting_mappings")
        .select("tenant_id").eq("id", id).maybeSingle();
      if (!m || m.tenant_id !== effectiveTenantId) return json(403, { ok: false, error: "mapping_not_owned" }, requestId);
      const vr = await validateAndReresolve(id);
      await audit("accounting_mapping_validated", id, vr);
      return json(200, { ok: true, data: { mapping_id: id, ...vr } }, requestId);
    }

    if (action === "validate_all") {
      const connId = payload?.qbo_connection_id;
      if (!connId || !(await verifyConn(connId))) {
        return json(403, { ok: false, error: "connection_not_owned" }, requestId);
      }
      const { data: rows } = await admin.from("project_scope_accounting_mappings")
        .select("id").eq("qbo_connection_id", connId).eq("active", true);
      const summary: Record<string, number> = { valid: 0, invalid: 0, unvalidated: 0, stale: 0 };
      let totalReresolved = 0;
      for (const r of rows ?? []) {
        const vr = await validateAndReresolve(r.id);
        totalReresolved += vr.projects_reresolved;
        const s = vr.validation?.validation_status ?? "unvalidated";
        summary[s.startsWith("invalid") || s === "inactive_item" ? "invalid" : (s in summary ? s : "invalid")]++;
      }
      await audit("accounting_mapping_validated", null, { validate_all: true, summary, projects_reresolved: totalReresolved, connection_id: connId });
      return json(200, { ok: true, data: { summary, projects_reresolved: totalReresolved } }, requestId);
    }

    if (action === "disable" || action === "enable") {
      const id = payload?.mapping_id;
      if (!id) return json(400, { ok: false, error: "mapping_id_required" }, requestId);
      const { data: m } = await admin.from("project_scope_accounting_mappings")
        .select("tenant_id").eq("id", id).maybeSingle();
      if (!m || m.tenant_id !== effectiveTenantId) return json(403, { ok: false, error: "mapping_not_owned" }, requestId);
      const active = action === "enable";
      await admin.from("project_scope_accounting_mappings")
        .update({ active, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id);
      const { data: rc } = await admin.rpc("reresolve_projects_for_mapping", { p_mapping_id: id });
      await audit(action === "enable" ? "accounting_mapping_reenabled" : "accounting_mapping_disabled", id, { projects_reresolved: rc });
      return json(200, { ok: true, data: { mapping_id: id, active, projects_reresolved: rc } }, requestId);
    }

    return json(400, { ok: false, error: "unknown_action" }, requestId);
  } catch (e) {
    return json(500, { ok: false, error: "server_error", detail: (e as Error).message }, requestId);
  }
});
