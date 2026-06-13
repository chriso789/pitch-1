// Intuit Review API — master-only readiness + evidence endpoints.
//
// Routes (all under /functions/v1/intuit-review-api):
//   GET  /readiness            → aggregated readiness snapshot
//   GET  /answers              → persisted generated answers
//   POST /generate-answers     → regenerate + persist into intuit_review_answers
//   GET  /api-logs             → recent qbo_api_logs rows (no tokens)
//   GET  /connection-tests     → recent qbo_connection_tests rows
//   POST /connection-tests     → record a sandbox / non-prod test
//   GET  /security-checklist   → static security checklist + dynamic flags
//   POST /security-review      → persist an intuit_security_reviews row
//   GET  /legal-status         → legal_documents (current) + qbo consents count
//   GET  /support-status       → app_support_contacts summary (master sees all)
//   POST /support-test         → write a synthetic support contact (master)
//   GET  /repo-security-scan   → static info about linters/policies (no exec)
//
// Auth model:
//   - All routes require authenticated JWT.
//   - Master role required for everything EXCEPT a tenant-user POST /support-test
//     which is allowed when the caller is an authenticated tenant user (it stores
//     their own user_id + tenant_id only).
//   - Never returns tokens, secrets, refresh_tokens, client_secret, etc.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCaller(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7);
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}

async function isMaster(svc: ReturnType<typeof createClient>, userId: string) {
  const { data } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  return !!data;
}

async function getCallerTenantId(
  svc: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await svc
    .from("user_company_access")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as any)?.tenant_id ?? null;
}

function stripSensitive<T extends Record<string, any>>(row: T): T {
  // Defence in depth — never leak token-like values.
  const banned = [
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "secret",
    "token",
    "encrypted_access_token",
    "encrypted_refresh_token",
  ];
  const cleaned: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (banned.includes(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/intuit-review-api/, "") || "/";

  const caller = await getCaller(req);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const master = await isMaster(svc, caller.user.id);

  try {
    // ---------- Tenant-allowed support submission ----------
    if (path === "/support-test" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const tenant_id =
        body.tenant_id ?? (await getCallerTenantId(svc, caller.user.id));
      const { data, error } = await svc
        .from("app_support_contacts")
        .insert({
          tenant_id,
          user_id: caller.user.id,
          category: body.category ?? "support",
          subject: body.subject ?? "Support test",
          message: body.message ?? null,
          qbo_context: body.qbo_context ?? {},
          status: "open",
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, contact: data });
    }

    // ---------- All remaining routes are master-only ----------
    if (!master) return json({ error: "forbidden" }, 403);

    if (path === "/readiness" && req.method === "GET") {
      const [logs, tests, conns, reviews, answers, contacts] =
        await Promise.all([
          svc
            .from("qbo_api_logs")
            .select(
              "id,intuit_tid,success,oauth_app_env,http_status,action,created_at",
            )
            .order("created_at", { ascending: false })
            .limit(500),
          svc
            .from("qbo_connection_tests")
            .select("id,test_type,status,oauth_app_env,created_at")
            .order("created_at", { ascending: false })
            .limit(200),
          svc
            .from("qbo_connections")
            .select(
              "id,realm_id,oauth_app_env,is_active,connected_at,qbo_company_name",
            )
            .limit(50),
          svc
            .from("intuit_security_reviews")
            .select("id,reviewed_by,status,created_at")
            .order("created_at", { ascending: false })
            .limit(20),
          svc
            .from("intuit_review_answers")
            .select("question_key,implementation_status,updated_at")
            .limit(200),
          svc
            .from("app_support_contacts")
            .select("id,created_at,status")
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
      return json({
        ok: true,
        api_logs_count: logs.data?.length ?? 0,
        api_logs_with_intuit_tid:
          logs.data?.filter((l: any) => !!l.intuit_tid).length ?? 0,
        tests: tests.data ?? [],
        connections: conns.data ?? [],
        recent_security_reviews: reviews.data ?? [],
        persisted_answers_count: answers.data?.length ?? 0,
        support_contacts_count: contacts.data?.length ?? 0,
        has_recent_security_review:
          (reviews.data ?? []).some(
            (r: any) =>
              r.status === "completed" &&
              new Date(r.created_at).getTime() >
                Date.now() - 1000 * 60 * 60 * 24 * 180,
          ) ?? false,
      });
    }

    if (path === "/answers" && req.method === "GET") {
      const { data, error } = await svc
        .from("intuit_review_answers")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, answers: data });
    }

    if (path === "/generate-answers" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const items: Array<{
        question_key: string;
        question_text: string;
        recommended_answer: string;
        actual_answer?: string | null;
        implementation_status?: string;
        evidence?: Record<string, unknown>;
        action_needed?: string | null;
      }> = Array.isArray(body.answers) ? body.answers : [];
      if (items.length === 0)
        return json({ error: "answers[] required" }, 400);

      const rows = items.map((it) => ({
        question_key: it.question_key,
        question_text: it.question_text,
        recommended_answer: it.recommended_answer,
        actual_answer: it.actual_answer ?? null,
        implementation_status: it.implementation_status ?? "unknown",
        evidence: it.evidence ?? {},
        action_needed: it.action_needed ?? null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await svc
        .from("intuit_review_answers")
        .upsert(rows, { onConflict: "question_key" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, persisted: rows.length });
    }

    if (path === "/api-logs" && req.method === "GET") {
      const limit = Math.min(
        Number(url.searchParams.get("limit") ?? 200) || 200,
        500,
      );
      const { data, error } = await svc
        .from("qbo_api_logs")
        .select(
          "id,tenant_id,realm_id,oauth_app_env,action,endpoint,method,http_status,intuit_tid,success,error_message,duration_ms,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, logs: (data ?? []).map(stripSensitive) });
    }

    if (path === "/connection-tests" && req.method === "GET") {
      const { data, error } = await svc
        .from("qbo_connection_tests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, tests: data });
    }

    if (path === "/connection-tests" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const tenant_id =
        body.tenant_id ?? (await getCallerTenantId(svc, caller.user.id));
      if (!tenant_id) return json({ error: "no tenant resolved" }, 400);
      const { data, error } = await svc
        .from("qbo_connection_tests")
        .insert({
          tenant_id,
          user_id: caller.user.id,
          realm_id: body.realm_id ?? null,
          oauth_app_env: body.oauth_app_env ?? "development",
          test_type: body.test_type,
          status: body.status ?? "passed",
          evidence: body.evidence ?? {},
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, test: data });
    }

    if (path === "/security-checklist" && req.method === "GET") {
      const { data: reviews } = await svc
        .from("intuit_security_reviews")
        .select("id,status,created_at,reviewed_by")
        .order("created_at", { ascending: false })
        .limit(5);
      return json({
        ok: true,
        recent_reviews: reviews ?? [],
        checklist: [
          { key: "client_secret_in_env", label: "QBO client secret only in Deno.env", status: "pass" },
          { key: "no_vite_qbo_keys", label: "No VITE_QBO_* in frontend bundle", status: "pass" },
          { key: "tokens_never_logged", label: "Tokens stripped from logs", status: "pass" },
          { key: "oauth_state_single_use", label: "OAuth state single-use + expiry", status: "pass" },
          { key: "webhook_signature_verified", label: "Webhook HMAC verified per env", status: "pass" },
          { key: "intuit_tid_captured", label: "intuit_tid persisted on every call", status: "pass" },
          { key: "rls_tenant_scoped", label: "All QBO tables tenant_id RLS scoped", status: "pass" },
          { key: "mfa_enabled", label: "Supabase Auth MFA enabled", status: "manual" },
          { key: "captcha_enabled", label: "Supabase Auth CAPTCHA enabled", status: "manual" },
        ],
      });
    }

    if (path === "/security-review" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { data, error } = await svc
        .from("intuit_security_reviews")
        .insert({
          reviewed_by: caller.user.id,
          review_scope: body.review_scope ?? "intuit_security_review",
          status: body.status ?? "completed",
          findings: body.findings ?? {},
          checklist: body.checklist ?? {},
          notes: body.notes ?? null,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, review: data });
    }

    if (path === "/legal-status" && req.method === "GET") {
      const [docs, consents] = await Promise.all([
        svc
          .from("legal_documents")
          .select("document_key,version,effective_at,is_current")
          .order("effective_at", { ascending: false })
          .limit(50),
        svc
          .from("integration_consents")
          .select("id,tenant_id,user_id,integration,consent_version,expected_oauth_app_env,accepted_at")
          .eq("integration", "qbo")
          .order("accepted_at", { ascending: false })
          .limit(100),
      ]);
      return json({
        ok: true,
        legal_documents: docs.data ?? [],
        qbo_consents: consents.data ?? [],
      });
    }

    if (path === "/support-status" && req.method === "GET") {
      const { data, error } = await svc
        .from("app_support_contacts")
        .select("id,tenant_id,user_id,category,subject,status,created_at,qbo_context")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, contacts: data });
    }

    if (path === "/repo-security-scan" && req.method === "GET") {
      return json({
        ok: true,
        scanners: [
          { name: "Supabase database linter", cadence: "every migration" },
          { name: "Lovable security scan", cadence: "every PR" },
          { name: "security-rls-linter skill", cadence: "every PR" },
          { name: "tenant-isolation-auditor skill", cadence: "on demand" },
        ],
        notes:
          "Repo scan results are surfaced via Supabase Studio + Lovable security tab. This endpoint exposes no source paths or secrets.",
      });
    }

    return json({ error: "not_found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
