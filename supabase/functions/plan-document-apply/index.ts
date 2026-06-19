// Plan how an AI document extraction should write into CRM records.
// Generates suggested writes and persists them as PENDING ai_document_apply_events.
// Performs NO writes to CRM tables.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SENSITIVE_FIELDS = new Set([
  "contract_amount","deposit_amount","balance_due","total","subtotal",
  "estimate_total","replacement_cost_value","actual_cash_value","deductible",
  "depreciation","amount_released","amount_claimed",
  "tax_classification","policy_limits","expiration_date","expiration_dates",
  "legal_name","license_number","tin","ssn","ein",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;

interface Suggestion {
  target_table: string;
  target_id: string | null;
  field_name: string;
  old_value: any;
  new_value: any;
  confidence: number;
  action: "apply" | "skip" | "review";
  reason: string;
  apply_status: "pending" | "skipped" | "conflict";
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function isEmpty(v: any) { return v == null || v === "" || (typeof v === "string" && !v.trim()); }
function isSensitive(field: string) { return SENSITIVE_FIELDS.has(field); }

async function buildContactSuggestions(admin: any, contactId: string, ex: any, confidence: number): Promise<Suggestion[]> {
  const { data: contact } = await admin.from("contacts").select("id, name, first_name, last_name, email, phone, address").eq("id", contactId).maybeSingle();
  if (!contact) return [];
  const n = ex.normalized_fields ?? {};
  const out: Suggestion[] = [];

  const push = (field: string, oldVal: any, newVal: any, mappedField: string) => {
    if (isEmpty(newVal)) return;
    const action: Suggestion["action"] =
      isEmpty(oldVal) && confidence >= 0.9 && !isSensitive(mappedField) ? "apply" :
      !isEmpty(oldVal) && String(oldVal).trim() !== String(newVal).trim() ? "review" : "skip";
    const apply_status = action === "review" ? "conflict" : action === "skip" ? "skipped" : "pending";
    out.push({
      target_table: "contacts", target_id: contact.id, field_name: mappedField,
      old_value: oldVal ?? null, new_value: newVal, confidence,
      action, apply_status,
      reason:
        action === "apply" ? "field empty, high confidence, non-sensitive" :
        action === "review" ? "existing value differs — manual review required" :
        "no change or already populated",
    });
  };

  if (n.customer_name) push("customer_name", contact.name, n.customer_name, "name");
  if (n.customer_email && EMAIL_RE.test(String(n.customer_email))) push("customer_email", contact.email, n.customer_email, "email");
  if (n.customer_phone && PHONE_RE.test(String(n.customer_phone))) push("customer_phone", contact.phone, n.customer_phone, "phone");
  return out;
}

async function buildPipelineSuggestions(admin: any, pipelineId: string, ex: any, confidence: number): Promise<Suggestion[]> {
  const { data: pe } = await admin.from("pipeline_entries").select("id, property_address, permit_number, jurisdiction").eq("id", pipelineId).maybeSingle();
  if (!pe) return [];
  const n = ex.normalized_fields ?? {};
  const out: Suggestion[] = [];
  const cls = ex.document_class as string;

  const pushPe = (field: string, newVal: any, opts?: { sensitive?: boolean }) => {
    if (isEmpty(newVal)) return;
    const oldVal = (pe as any)[field];
    const sensitive = !!opts?.sensitive || isSensitive(field);
    const action: Suggestion["action"] =
      isEmpty(oldVal) && confidence >= 0.9 && !sensitive ? "apply" :
      !isEmpty(oldVal) && String(oldVal).trim() !== String(newVal).trim() ? "review" : "skip";
    const apply_status = action === "review" ? "conflict" : action === "skip" ? "skipped" : "pending";
    out.push({
      target_table: "pipeline_entries", target_id: pe.id, field_name: field,
      old_value: oldVal ?? null, new_value: newVal, confidence,
      action, apply_status,
      reason: sensitive ? "sensitive field — manual review required" :
              action === "apply" ? "field empty, high confidence" :
              action === "review" ? "existing value differs" : "no change",
    });
  };

  if (["signed_contract","roofing_contract"].includes(cls)) {
    pushPe("property_address", n.property_address);
  }
  if (cls === "permit") {
    pushPe("permit_number", n.permit_number);
    pushPe("jurisdiction", n.jurisdiction);
    if (n.expiration_date) out.push({
      target_table: "pipeline_entries", target_id: pe.id, field_name: "permit_expiration_date",
      old_value: null, new_value: n.expiration_date, confidence,
      action: "review", apply_status: "conflict",
      reason: "sensitive date — manual review required",
    });
  }
  return out;
}

function nonApplicableSuggestions(ex: any, confidence: number): Suggestion[] {
  const cls = ex.document_class as string;
  const out: Suggestion[] = [];
  const add = (field: string, reason: string) => out.push({
    target_table: "documents", target_id: ex.document_id, field_name: field,
    old_value: null, new_value: ex.normalized_fields?.[field] ?? null, confidence,
    action: "review", apply_status: "conflict", reason,
  });

  if (cls === "supplier_invoice") add("total", "invoice module not wired — review only");
  if (cls === "certificate_of_insurance") add("policy_limits", "COI auto-apply forbidden — review only");
  if (cls === "w9") add("legal_name", "W-9 auto-apply forbidden — review only");
  if (cls === "lien_release") add("amount_released", "lien release auto-apply forbidden — review only");
  if (cls === "notice_to_owner") add("amount_claimed", "notice to owner auto-apply forbidden — review only");
  return out;
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
    const extractionId: string | null = body?.extraction_id ?? null;
    if (!extractionId) return json({ ok: false, error: "missing extraction_id" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*").eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);

    const { data: profile } = await admin.from("profiles").select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle();
    const effective = profile?.active_tenant_id || profile?.tenant_id;
    let allowed = !!effective && effective === ex.tenant_id;
    if (!allowed) {
      const { data: isMaster } = await admin.rpc("has_role", { _user_id: userId, _role: "master" as any });
      allowed = !!isMaster;
    }
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    if (!["completed","needs_review","approved"].includes(String(ex.extraction_status))) {
      return json({ ok: false, error: "extraction not ready", status: ex.extraction_status }, 409);
    }

    const blocking = (ex.validation_flags ?? []).some((f: any) => f.severity === "blocking" || f.severity === "error");
    const confidence = Number(ex.confidence ?? 0);

    const suggestions: Suggestion[] = [];
    if (ex.contact_id) suggestions.push(...await buildContactSuggestions(admin, ex.contact_id, ex, confidence));
    if (ex.pipeline_entry_id) suggestions.push(...await buildPipelineSuggestions(admin, ex.pipeline_entry_id, ex, confidence));
    suggestions.push(...nonApplicableSuggestions(ex, confidence));

    // If blocking flags exist, downgrade all 'apply' to 'review'
    if (blocking) {
      for (const s of suggestions) {
        if (s.action === "apply") {
          s.action = "review";
          s.apply_status = "conflict";
          s.reason = "blocking validation flag present";
        }
      }
    }

    // Clear prior pending events for this extraction to keep plan idempotent.
    await admin.from("ai_document_apply_events")
      .delete()
      .eq("extraction_id", extractionId)
      .eq("apply_status", "pending");

    let inserted: any[] = [];
    if (suggestions.length) {
      const rows = suggestions.map((s) => ({
        tenant_id: ex.tenant_id,
        extraction_id: ex.id,
        document_id: ex.document_id,
        target_table: s.target_table,
        target_id: s.target_id,
        field_name: s.field_name,
        old_value: s.old_value,
        new_value: s.new_value,
        confidence: s.confidence,
        action: s.action,
        apply_status: s.apply_status,
        apply_reason: s.reason,
      }));
      const { data } = await admin.from("ai_document_apply_events").insert(rows).select("*");
      inserted = data ?? [];
    }

    return json({ ok: true, extraction_id: extractionId, suggestions: inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[plan-document-apply]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
