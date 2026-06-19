// Execute selected signed-contract workflow actions.
// Hard rules:
//   - No financial fields auto-write (high-risk actions must be approved via separate apply flow)
//   - Block duplicate job creation
//   - Every action is audited to ai_document_workflow_events
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantAccess } from "../_shared/document-crm-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const HIGH_RISK_DENY = new Set([
  "record_contract_amount", "record_deposit_amount",
]);

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function audit(admin: any, row: Record<string, unknown>) {
  await admin.from("ai_document_workflow_events").insert(row);
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
    const selected: string[] = Array.isArray(body?.selected_actions) ? body.selected_actions : [];
    if (!extractionId || !selected.length) return json({ ok: false, error: "missing extraction_id or selected_actions" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*").eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);
    const allowed = await resolveTenantAccess(admin, userId, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    const tenantId = ex.tenant_id;
    const n = ex.normalized_fields ?? {};
    const results: Array<{ action: string; status: string; reason?: string; target_id?: string }> = [];

    const auditBase = {
      tenant_id: tenantId, extraction_id: ex.id, document_id: ex.document_id,
      workflow_type: "signed_contract_to_job", executed_by: userId, executed_at: new Date().toISOString(),
    };

    for (const action of selected) {
      try {
        if (HIGH_RISK_DENY.has(action)) {
          await audit(admin, { ...auditBase, action_key: action, status: "blocked",
            reason: "high-risk financial — must use Apply flow with explicit approval" });
          results.push({ action, status: "blocked", reason: "financial — use Apply flow" });
          continue;
        }

        if (action === "fill_contact_email" && ex.contact_id && n.customer_email) {
          const { data: c } = await admin.from("contacts").select("id,tenant_id,email").eq("id", ex.contact_id).maybeSingle();
          if (!c || c.tenant_id !== tenantId) throw new Error("contact_tenant_mismatch");
          if (c.email) { results.push({ action, status: "skipped", reason: "not empty" });
            await audit(admin, { ...auditBase, action_key: action, target_table: "contacts", target_id: c.id, status: "skipped", reason: "not empty" });
            continue; }
          await admin.from("contacts").update({ email: n.customer_email }).eq("id", c.id);
          await audit(admin, { ...auditBase, action_key: action, target_table: "contacts", target_id: c.id,
            status: "applied", old_value: null, new_value: { email: n.customer_email } });
          results.push({ action, status: "applied", target_id: c.id });
          continue;
        }

        if (action === "fill_contact_phone" && ex.contact_id && n.customer_phone) {
          const { data: c } = await admin.from("contacts").select("id,tenant_id,phone").eq("id", ex.contact_id).maybeSingle();
          if (!c || c.tenant_id !== tenantId) throw new Error("contact_tenant_mismatch");
          if (c.phone) { results.push({ action, status: "skipped", reason: "not empty" });
            await audit(admin, { ...auditBase, action_key: action, target_table: "contacts", target_id: c.id, status: "skipped", reason: "not empty" });
            continue; }
          await admin.from("contacts").update({ phone: n.customer_phone }).eq("id", c.id);
          await audit(admin, { ...auditBase, action_key: action, target_table: "contacts", target_id: c.id,
            status: "applied", old_value: null, new_value: { phone: n.customer_phone } });
          results.push({ action, status: "applied", target_id: c.id });
          continue;
        }

        if (action === "set_pipeline_project_type" && ex.pipeline_entry_id && n.project_type) {
          const { data: pe } = await admin.from("pipeline_entries").select("id,tenant_id,roof_type").eq("id", ex.pipeline_entry_id).maybeSingle();
          if (!pe || pe.tenant_id !== tenantId) throw new Error("pipeline_tenant_mismatch");
          if (pe.roof_type) { results.push({ action, status: "skipped", reason: "not empty" });
            await audit(admin, { ...auditBase, action_key: action, target_table: "pipeline_entries", target_id: pe.id, status: "skipped", reason: "not empty" });
            continue; }
          await admin.from("pipeline_entries").update({ roof_type: n.project_type }).eq("id", pe.id);
          await audit(admin, { ...auditBase, action_key: action, target_table: "pipeline_entries", target_id: pe.id,
            status: "applied", old_value: null, new_value: { roof_type: n.project_type } });
          results.push({ action, status: "applied", target_id: pe.id });
          continue;
        }

        if (action === "attach_document") {
          await audit(admin, { ...auditBase, action_key: action, target_table: "documents", target_id: ex.document_id,
            status: "applied", new_value: { kind: "signed_contract" }, reason: "audit-only attach" });
          results.push({ action, status: "applied", target_id: ex.document_id });
          continue;
        }

        if (action === "create_job") {
          // Duplicate prevention
          if (ex.contact_id) {
            const { data: dup } = await admin.from("jobs").select("id")
              .eq("tenant_id", tenantId).eq("contact_id", ex.contact_id).limit(1);
            if (dup && dup.length) {
              await audit(admin, { ...auditBase, action_key: action, target_table: "jobs",
                status: "blocked", reason: "duplicate_job_for_contact", new_value: { existing_job_id: dup[0].id } });
              results.push({ action, status: "blocked", reason: "duplicate job for contact" });
              continue;
            }
          }
          const insertRow: Record<string, unknown> = {
            tenant_id: tenantId,
            contact_id: ex.contact_id ?? null,
            pipeline_entry_id: ex.pipeline_entry_id ?? null,
            name: n.project_type ? `${n.project_type} — signed contract` : "Signed contract",
          };
          const { data: created, error: jobErr } = await admin.from("jobs").insert(insertRow).select("id").maybeSingle();
          if (jobErr) throw jobErr;
          await audit(admin, { ...auditBase, action_key: action, target_table: "jobs", target_id: created?.id,
            status: "applied", new_value: insertRow });
          results.push({ action, status: "applied", target_id: created?.id });
          continue;
        }

        if (action.startsWith("checklist_")) {
          await audit(admin, { ...auditBase, action_key: action, target_table: null,
            status: "applied", new_value: { placeholder: true } });
          results.push({ action, status: "applied" });
          continue;
        }

        // Unknown action
        await audit(admin, { ...auditBase, action_key: action, status: "skipped", reason: "unknown_action" });
        results.push({ action, status: "skipped", reason: "unknown_action" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit(admin, { ...auditBase, action_key: action, status: "failed", reason: msg });
        results.push({ action, status: "failed", reason: msg });
      }
    }

    await admin.from("ai_document_extractions").update({
      workflow_metadata: {
        ...(ex.workflow_metadata ?? {}),
        last_run: { workflow_type: "signed_contract_to_job", at: new Date().toISOString(), by: userId, results },
      },
    }).eq("id", ex.id);

    return json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[execute-signed-contract-workflow]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
