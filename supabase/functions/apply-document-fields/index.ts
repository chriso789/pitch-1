// Execute approved ai_document_apply_events against CRM records.
// Re-validates tenant ownership and re-checks old values before any write.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_TABLES = new Set(["contacts", "pipeline_entries"]);

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function eq(a: any, b: any) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);
    const userId = u.user.id;

    const body = await req.json().catch(() => ({}));
    const extractionId: string = body?.extraction_id;
    const eventIds: string[] = Array.isArray(body?.apply_event_ids) ? body.apply_event_ids : [];
    const approveConflicts: boolean = !!body?.approve_conflicts;
    if (!extractionId || eventIds.length === 0) return json({ ok: false, error: "missing inputs" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("id, tenant_id").eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);

    const { data: profile } = await admin.from("profiles").select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle();
    const effective = profile?.active_tenant_id || profile?.tenant_id;
    let allowed = !!effective && effective === ex.tenant_id;
    if (!allowed) {
      const { data: isMaster } = await admin.rpc("has_role", { _user_id: userId, _role: "master" as any });
      allowed = !!isMaster;
    }
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    const { data: events } = await admin
      .from("ai_document_apply_events")
      .select("*")
      .in("id", eventIds)
      .eq("extraction_id", extractionId)
      .eq("tenant_id", ex.tenant_id);

    const results: any[] = [];
    for (const e of events ?? []) {
      const finalize = async (status: string, reason: string) => {
        await admin.from("ai_document_apply_events").update({
          apply_status: status, apply_reason: reason,
          applied_by: userId, applied_at: new Date().toISOString(),
        }).eq("id", e.id);
        results.push({ id: e.id, status, reason });
      };

      if (!ALLOWED_TABLES.has(e.target_table)) {
        await finalize("rejected", `target table ${e.target_table} not allowed for direct apply`);
        continue;
      }
      if (e.apply_status === "conflict" && !approveConflicts) {
        await finalize("skipped", "conflict not approved");
        continue;
      }
      if (e.apply_status !== "pending" && e.apply_status !== "conflict") {
        await finalize(e.apply_status, "already finalized");
        continue;
      }

      const { data: target } = await admin
        .from(e.target_table).select(`id, tenant_id, ${e.field_name}`)
        .eq("id", e.target_id).maybeSingle();
      if (!target) { await finalize("failed", "target_not_found"); continue; }
      if ((target as any).tenant_id !== ex.tenant_id) { await finalize("rejected", "tenant_mismatch"); continue; }

      const currentVal = (target as any)[e.field_name];
      if (!eq(currentVal, e.old_value)) {
        await admin.from("ai_document_apply_events").update({
          apply_status: "conflict", apply_reason: "current value changed since planning",
          old_value: currentVal,
        }).eq("id", e.id);
        results.push({ id: e.id, status: "conflict", reason: "value_changed" });
        continue;
      }

      const upd: Record<string, any> = {};
      upd[e.field_name] = e.new_value;
      const { error: ue } = await admin.from(e.target_table).update(upd).eq("id", e.target_id);
      if (ue) { await finalize("failed", ue.message); continue; }
      await finalize("applied", "ok");
    }

    const anyApplied = results.some((r) => r.status === "applied");
    if (anyApplied) {
      await admin.from("ai_document_extractions").update({
        approved_at: new Date().toISOString(),
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      }).eq("id", extractionId);
    }

    return json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[apply-document-fields]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
