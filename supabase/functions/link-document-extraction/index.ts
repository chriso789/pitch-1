// Manually link an AI document extraction to a CRM record.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantAccess } from "../_shared/document-crm-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TARGET_TABLES: Record<string, string> = {
  contact: "contacts",
  lead: "contacts", // leads modeled via contacts in this codebase
  pipeline_entry: "pipeline_entries",
  job: "jobs",
};

const FK_FIELD: Record<string, string> = {
  contact: "contact_id",
  lead: "lead_id",
  pipeline_entry: "pipeline_entry_id",
  job: "job_id",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const extractionId: string = body?.extraction_id;
    const targetType: string = body?.target_type;
    const targetId: string = body?.target_id;
    if (!extractionId || !targetType || !targetId) {
      return json({ ok: false, error: "missing extraction_id / target_type / target_id" }, 400);
    }
    const table = TARGET_TABLES[targetType];
    const fk = FK_FIELD[targetType];
    if (!table || !fk) return json({ ok: false, error: "invalid target_type" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*").eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);
    const allowed = await resolveTenantAccess(admin, u.user.id, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    // Verify target tenant
    const { data: target } = await admin.from(table).select("id, tenant_id").eq("id", targetId).maybeSingle();
    if (!target) return json({ ok: false, error: "target_not_found" }, 404);
    if (target.tenant_id !== ex.tenant_id) return json({ ok: false, error: "target_tenant_mismatch" }, 403);

    const update: Record<string, unknown> = {
      [fk]: targetId,
      match_metadata: {
        ...(ex.match_metadata ?? {}),
        manual_linked: true,
        linked_by: u.user.id,
        linked_at: new Date().toISOString(),
        target_type: targetType,
        target_id: targetId,
      },
    };
    const { data: updated, error } = await admin.from("ai_document_extractions")
      .update(update).eq("id", ex.id).select("*").maybeSingle();
    if (error) throw error;

    return json({ ok: true, extraction: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[link-document-extraction]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
