// Phase 2 Slice B — invoice-portal-revoke
// Revokes all active portal tokens for an invoice in the caller's tenant.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AUTHORIZED_ROLES = new Set([
  "master", "owner", "corporate", "office_admin",
]);

const BodySchema = z.object({ invoice_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: userRes } = await supabase.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ ok: false, error: "invalid_request" }, 400);

  const { data: tenantIdRow } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
  const tenantId = (tenantIdRow as string | null) ?? null;
  if (!tenantId) return json({ ok: false, error: "no_tenant" }, 403);

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows as { role: string }[] | null) ?? []).map((r) => r.role));
  if (![...roles].some((r) => AUTHORIZED_ROLES.has(r))) {
    return json({ ok: false, error: "forbidden_role" }, 403);
  }

  const { data: inv } = await supabase
    .from("invoice_ar_mirror")
    .select("id, tenant_id, project_id")
    .eq("id", parsed.data.invoice_id)
    .maybeSingle();
  if (!inv || inv.tenant_id !== tenantId) {
    return json({ ok: false, error: "invoice_not_found" }, 404);
  }

  const { data: revoked, error: revErr } = await supabase
    .from("invoice_portal_tokens")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("tenant_id", tenantId)
    .eq("pitch_invoice_id", inv.id)
    .is("revoked_at", null)
    .select("id");
  if (revErr) return json({ ok: false, error: "revoke_failed" }, 500);

  for (const t of (revoked ?? [])) {
    await supabase.from("customer_invoice_events").insert({
      tenant_id: tenantId,
      project_id: inv.project_id,
      pitch_invoice_id: inv.id,
      portal_token_id: t.id,
      event_type: "invoice_portal_link_revoked",
      actor_type: "staff",
      actor_user_id: user.id,
      metadata: { source: "invoice-portal-revoke" },
    });
  }
  return json({ ok: true, revoked_count: (revoked ?? []).length }, 200);
});
