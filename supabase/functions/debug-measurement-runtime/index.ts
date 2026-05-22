// debug-measurement-runtime
//
// Route-audit endpoint. Given a lead_id / contact_id / measurement_id /
// address, returns the canonical-route stamps and Phase 3 execution blocks
// for the most recent roof_measurements rows, so we can prove whether a
// visible row came from `start-ai-measurement` (canonical) or from a stale
// or legacy path.
//
// Master/admin only. Service-role client used internally to bypass RLS so
// the audit sees ALL rows for a given lead — including legacy/non-canonical
// rows that the UI would otherwise hide.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROUTE_AUDIT_RESPONSE_VERSION = "debug-measurement-runtime-v1";

interface AuditQuery {
  lead_id?: string | null;
  contact_id?: string | null;
  measurement_id?: string | null;
  address?: string | null;
  limit?: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireMasterOrAdmin(req: Request): Promise<{ ok: true; user_id: string } | { ok: false; res: Response }> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, res: json({ error: "auth_required" }, 401) };
  }
  const token = auth.slice(7);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user?.id) {
    return { ok: false, res: json({ error: "invalid_token" }, 401) };
  }
  const userId = u.user.id;

  // Master role check via user_roles
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roleList = (roles ?? []).map((r: any) => String(r.role).toLowerCase());
  const isAllowed = roleList.includes("master") || roleList.includes("admin") || roleList.includes("cob");
  if (!isAllowed) {
    return { ok: false, res: json({ error: "forbidden", reason: "master_or_admin_required" }, 403) };
  }
  return { ok: true, user_id: userId };
}

function pickPhaseBlock(geometry: any, key: string) {
  if (!geometry || typeof geometry !== "object") return null;
  return geometry[key] ?? null;
}

function summarizeRow(row: any) {
  const g = (row?.geometry_report_json ?? null) as Record<string, any> | null;
  return {
    id: row.id,
    created_at: row.created_at,
    lead_id: row.lead_id ?? null,
    contact_id: row.contact_id ?? null,
    tenant_id: row.tenant_id ?? null,
    created_by_function: row.created_by_function ?? null,
    created_by_component: row.created_by_component ?? null,
    solver_entrypoint: row.solver_entrypoint ?? null,
    canonical_measurement_route: row.canonical_measurement_route ?? null,
    route_audit_version: row.route_audit_version ?? null,
    report_renderer_version: row.report_renderer_version ?? null,
    result_state: row.result_state ?? null,
    hard_fail_reason: row.hard_fail_reason ?? null,
    block_customer_report_reason: row.block_customer_report_reason ?? null,
    customer_report_ready: row.customer_report_ready ?? null,
    needs_review: row.needs_review ?? null,
    report_blocked: row.report_blocked ?? null,
    route_warning: g?.route_warning ?? null,
    route_provenance: pickPhaseBlock(g, "route_provenance"),
    phase3_5: pickPhaseBlock(g, "phase3_5") ?? pickPhaseBlock(g, "phase3A_5"),
    phase3A: pickPhaseBlock(g, "phase3A"),
    phase3B: pickPhaseBlock(g, "phase3B"),
    phase3C: pickPhaseBlock(g, "phase3C"),
    phase3D: pickPhaseBlock(g, "phase3D"),
    phase3E: pickPhaseBlock(g, "phase3E"),
    phase3_versions: g?.phase3 ?? null,
    geometry_source: row.geometry_source ?? null,
    validation_status: row.validation_status ?? null,
  };
}

async function lookupRows(q: AuditQuery): Promise<any[]> {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 50);
  let query = admin
    .from("roof_measurements")
    .select(
      [
        "id",
        "created_at",
        "lead_id",
        "contact_id",
        "tenant_id",
        "created_by_function",
        "created_by_component",
        "solver_entrypoint",
        "canonical_measurement_route",
        "route_audit_version",
        "report_renderer_version",
        "result_state",
        "hard_fail_reason",
        "block_customer_report_reason",
        "customer_report_ready",
        "needs_review",
        "report_blocked",
        "geometry_source",
        "validation_status",
        "address",
        "geometry_report_json",
      ].join(","),
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (q.measurement_id) query = query.eq("id", q.measurement_id);
  else if (q.lead_id) query = query.eq("lead_id", q.lead_id);
  else if (q.contact_id) query = query.eq("contact_id", q.contact_id);
  else if (q.address) query = query.ilike("address", `%${q.address}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function lookupJobs(q: AuditQuery): Promise<any[]> {
  if (!q.lead_id && !q.contact_id) return [];
  let query = admin
    .from("ai_measurement_jobs")
    .select(
      "id, created_at, status, lead_id, contact_id, tenant_id, hard_fail_reason, needs_review, report_blocked, source_context, result_state, user_confirmed_roof_target, roof_target_admin_override",
    )
    .order("created_at", { ascending: false })
    .limit(10);
  if (q.lead_id) query = query.eq("lead_id", q.lead_id);
  else if (q.contact_id) query = query.eq("contact_id", q.contact_id);
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "POST or GET required" }, 405);
  }

  const guard = await requireMasterOrAdmin(req);
  if (!guard.ok) return guard.res;

  let q: AuditQuery = {};
  try {
    if (req.method === "POST") {
      q = (await req.json()) as AuditQuery;
    } else {
      const url = new URL(req.url);
      q = {
        lead_id: url.searchParams.get("lead_id"),
        contact_id: url.searchParams.get("contact_id"),
        measurement_id: url.searchParams.get("measurement_id"),
        address: url.searchParams.get("address"),
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      };
    }
  } catch (_e) {
    return json({ error: "invalid_body" }, 400);
  }

  if (!q.lead_id && !q.contact_id && !q.measurement_id && !q.address) {
    return json(
      { error: "missing_query", required_one_of: ["lead_id", "contact_id", "measurement_id", "address"] },
      400,
    );
  }

  try {
    const [rows, jobs] = await Promise.all([lookupRows(q), lookupJobs(q)]);
    const summarized = rows.map(summarizeRow);
    const canonicalCount = summarized.filter((r) => r.canonical_measurement_route === true).length;
    const legacyCount = summarized.filter((r) => r.canonical_measurement_route === false).length;
    const unstampedCount = summarized.filter((r) => r.canonical_measurement_route == null).length;

    return json({
      audit_response_version: ROUTE_AUDIT_RESPONSE_VERSION,
      query: q,
      counts: {
        total: summarized.length,
        canonical: canonicalCount,
        legacy: legacyCount,
        unstamped: unstampedCount,
      },
      rows: summarized,
      ai_measurement_jobs: jobs,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[debug-measurement-runtime] error", msg);
    return json({ error: "lookup_failed", detail: msg }, 500);
  }
});
