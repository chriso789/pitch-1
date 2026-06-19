// Plan a signed-contract workflow from an AI document extraction.
// Read-only: produces suggested actions, does not execute anything.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantAccess } from "../_shared/document-crm-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED = new Set(["signed_contract", "roofing_contract"]);

interface Action {
  key: string;
  title: string;
  target_table: string | null;
  target_id: string | null;
  current_value: unknown;
  suggested_value: unknown;
  risk: "low" | "medium" | "high";
  default_selected: boolean;
  reason: string;
}

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
    if (!extractionId) return json({ ok: false, error: "missing extraction_id" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*").eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);
    const allowed = await resolveTenantAccess(admin, u.user.id, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    const blocking_reasons: string[] = [];
    if (!ALLOWED.has(String(ex.document_class))) blocking_reasons.push("document_class_not_contract");
    if (Number(ex.confidence ?? 0) < 0.80) blocking_reasons.push("confidence_below_threshold");
    if ((ex.validation_flags ?? []).some((f: any) => ["blocking", "error"].includes(f.severity))) {
      blocking_reasons.push("blocking_validation_flag");
    }
    if (!ex.contact_id && !ex.pipeline_entry_id) blocking_reasons.push("not_linked_to_contact_or_pipeline");

    const n = ex.normalized_fields ?? {};
    const checklist = {
      customer_linked: !!ex.contact_id,
      property_linked: !!ex.pipeline_entry_id || !!ex.job_id,
      contract_signed: !!(n.signatures_present || n.signed_date),
      contract_amount_extracted: n.contract_amount != null,
      project_type_extracted: !!(n.project_type || n.roof_system),
    };

    const actions: Action[] = [];
    let contact: any = null;
    if (ex.contact_id) {
      const { data } = await admin.from("contacts")
        .select("id,email,phone,address_street").eq("id", ex.contact_id).maybeSingle();
      contact = data;
    }

    // Low-risk contact gap fills
    if (contact && !contact.email && n.customer_email) {
      actions.push({ key: "fill_contact_email", title: "Fill contact email",
        target_table: "contacts", target_id: contact.id,
        current_value: null, suggested_value: n.customer_email,
        risk: "low", default_selected: true, reason: "contact email empty" });
    }
    if (contact && !contact.phone && n.customer_phone) {
      actions.push({ key: "fill_contact_phone", title: "Fill contact phone",
        target_table: "contacts", target_id: contact.id,
        current_value: null, suggested_value: n.customer_phone,
        risk: "low", default_selected: true, reason: "contact phone empty" });
    }

    // Attach document to pipeline/job (always low-risk + audit-only)
    actions.push({ key: "attach_document", title: "Mark document as signed contract & attach",
      target_table: "documents", target_id: ex.document_id,
      current_value: null, suggested_value: { kind: "signed_contract" },
      risk: "low", default_selected: true, reason: "audit linkage" });

    // Pipeline updates
    if (ex.pipeline_entry_id && n.project_type) {
      const { data: pe } = await admin.from("pipeline_entries")
        .select("id,roof_type").eq("id", ex.pipeline_entry_id).maybeSingle();
      if (pe && !pe.roof_type) {
        actions.push({ key: "set_pipeline_project_type", title: "Set pipeline project type",
          target_table: "pipeline_entries", target_id: pe.id,
          current_value: null, suggested_value: n.project_type,
          risk: "low", default_selected: true, reason: "pipeline project type empty" });
      }
    }

    // Medium/high-risk — never preselected
    if (n.contract_amount != null) {
      actions.push({ key: "record_contract_amount", title: "Record contract amount",
        target_table: ex.pipeline_entry_id ? "pipeline_entries" : "documents",
        target_id: ex.pipeline_entry_id ?? ex.document_id,
        current_value: null, suggested_value: n.contract_amount,
        risk: "high", default_selected: false, reason: "financial — manual approval required" });
    }
    if (n.deposit_amount != null) {
      actions.push({ key: "record_deposit_amount", title: "Record deposit",
        target_table: "documents", target_id: ex.document_id,
        current_value: null, suggested_value: n.deposit_amount,
        risk: "high", default_selected: false, reason: "financial — manual approval required" });
    }
    if (n.warranty_terms) {
      actions.push({ key: "record_warranty_terms", title: "Record warranty terms",
        target_table: "documents", target_id: ex.document_id,
        current_value: null, suggested_value: n.warranty_terms,
        risk: "medium", default_selected: false, reason: "legal — manual approval required" });
    }

    // Job creation
    let jobBlocked = false;
    let jobBlockReason: string | null = null;
    if (ex.contact_id) {
      const { data: existingJobs } = await admin.from("jobs").select("id,name,job_number")
        .eq("tenant_id", ex.tenant_id).eq("contact_id", ex.contact_id).limit(5);
      if (existingJobs && existingJobs.length) {
        jobBlocked = true;
        jobBlockReason = `Existing job(s): ${existingJobs.map((j: any) => j.name || j.job_number).join(", ")}`;
      }
    }
    actions.push({ key: "create_job", title: jobBlocked ? "Create job (BLOCKED — duplicate)" : "Create job from contract",
      target_table: "jobs", target_id: null,
      current_value: null, suggested_value: { contact_id: ex.contact_id, pipeline_entry_id: ex.pipeline_entry_id },
      risk: "high", default_selected: false,
      reason: jobBlocked ? jobBlockReason! : "creates a new job record — review carefully" });

    // Production checklist placeholders (audit-only writes to workflow_events)
    const placeholders = [
      "noc_needed", "permit_application_needed", "material_order_needed",
      "color_confirmation_needed", "financing_confirmation_needed",
    ];
    for (const k of placeholders) {
      actions.push({ key: `checklist_${k}`, title: `Production checklist: ${k.replace(/_/g, " ")}`,
        target_table: null, target_id: null,
        current_value: null, suggested_value: { placeholder: true },
        risk: "low", default_selected: true, reason: "production setup placeholder" });
    }

    const readiness: "ready" | "needs_review" | "blocked" =
      blocking_reasons.length ? "blocked"
      : (Object.values(checklist).every(Boolean) ? "ready" : "needs_review");

    return json({
      ok: true,
      extraction_id: ex.id,
      workflow_type: "signed_contract_to_job",
      readiness,
      blocking_reasons,
      checklist,
      duplicate_job_block: jobBlocked,
      duplicate_job_reason: jobBlockReason,
      suggested_actions: actions,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[plan-signed-contract-workflow]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
