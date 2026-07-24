// resolve-project-accounting
// Server-side resolver + readiness transition for a project's accounting snapshot.
// Wraps the SECURITY DEFINER function public.resolve_project_accounting(project_id)
// with the same tenant / master-impersonation access model as
// initialize-project-accounting.
//
// - Never trusts tenant_id from the body.
// - Requires authenticated JWT; resolves tenant from the project row.
// - Master users may resolve only if their profile.active_tenant_id matches
//   the project's tenant (impersonation gate).
// - Always writes an audit_log entry.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  project_id?: string;
}

function json(status: number, body: unknown, requestId: string) {
  return new Response(JSON.stringify({ ...(body as object), requestId }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, requestId);
  }

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

  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, tenant_id")
    .eq("id", body.project_id)
    .maybeSingle();
  if (projErr || !project) {
    return json(404, { ok: false, error: "project_not_found" }, requestId);
  }
  const effectiveTenantId = project.tenant_id as string;

  // Access check: real membership OR master impersonation of this tenant
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

  // Call the SECURITY DEFINER resolver
  const { data: result, error: rpcErr } = await admin.rpc("resolve_project_accounting", {
    p_project_id: project.id,
  });
  if (rpcErr) {
    return json(500, { ok: false, error: "resolver_failed", detail: rpcErr.message }, requestId);
  }

  // Audit
  await admin.from("audit_log").insert({
    tenant_id: effectiveTenantId,
    actor_user_id: userId,
    action: "project_accounting_resolved",
    entity_type: "project",
    entity_id: project.id,
    metadata: {
      request_id: requestId,
      impersonated,
      result,
    },
  });

  return json(200, { ok: true, data: result }, requestId);
});
