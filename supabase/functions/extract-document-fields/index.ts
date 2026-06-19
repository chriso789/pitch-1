// Structured field extraction for classified documents.
// Reads OCR text + classification, runs a strict-JSON extraction prompt
// for the document_class, applies validation, and writes
// extracted_fields / normalized_fields / validation_flags to
// public.ai_document_extractions. Does NOT mutate CRM records directly.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const MODEL = "google/gemini-2.5-flash";
const MODEL_VERSION = "2026-06-19";

type Cls =
  | "signed_contract" | "roofing_contract" | "supplier_invoice" | "customer_invoice"
  | "estimate" | "insurance_scope" | "permit" | "notice_to_owner" | "lien_release"
  | "w9" | "certificate_of_insurance" | "subcontractor_agreement" | "unknown";

const FIELD_SCHEMAS: Record<Exclude<Cls, "unknown">, string[]> = {
  signed_contract: ["customer_name","customer_email","customer_phone","property_address","billing_address","contract_date","signed_date","contract_amount","deposit_amount","balance_due","payment_terms","project_type","roof_system","manufacturer","material_type","color","warranty_terms","contractor_name","license_number","signatures_present","homeowner_signature_present","contractor_signature_present"],
  roofing_contract: ["customer_name","customer_email","customer_phone","property_address","billing_address","contract_date","signed_date","contract_amount","deposit_amount","balance_due","payment_terms","project_type","roof_system","manufacturer","material_type","color","warranty_terms","contractor_name","license_number","signatures_present","homeowner_signature_present","contractor_signature_present"],
  supplier_invoice: ["supplier_name","invoice_number","invoice_date","due_date","account_number","job_name","job_address","customer_name","subtotal","tax","total","balance_due","line_items"],
  customer_invoice: ["customer_name","invoice_number","invoice_date","due_date","property_address","subtotal","tax","total","balance_due","line_items"],
  estimate: ["customer_name","estimate_number","estimate_date","property_address","subtotal","tax","total","line_items","valid_until"],
  insurance_scope: ["carrier","claim_number","policy_number","insured_name","property_address","date_of_loss","estimate_total","replacement_cost_value","actual_cash_value","deductible","depreciation","trades","line_items"],
  permit: ["permit_number","jurisdiction","property_address","owner_name","contractor_name","license_number","permit_type","issued_date","expiration_date","inspection_required","status"],
  notice_to_owner: ["claimant_name","supplier_or_subcontractor_name","owner_name","property_address","contractor_name","served_date","certified_mail_tracking","amount_claimed"],
  lien_release: ["releasing_party","property_address","owner_name","contractor_name","amount_released","release_type","conditional_or_unconditional","through_date","signed_date","notarized"],
  w9: ["legal_name","business_name","federal_tax_classification","address","tin_present","requester_name"],
  certificate_of_insurance: ["insured_name","producer","carrier","policy_numbers","general_liability_limits","workers_comp_limits","auto_limits","expiration_dates","certificate_holder","additional_insured","waiver_of_subrogation"],
  subcontractor_agreement: ["subcontractor_name","contractor_name","effective_date","scope_of_work","payment_terms","insurance_requirements","indemnity_present","termination_terms","signed_by_subcontractor","signed_by_contractor"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function buildSystem(cls: Exclude<Cls, "unknown">) {
  const fields = FIELD_SCHEMAS[cls];
  return `You extract structured data from a ${cls.replaceAll("_", " ")} for a construction CRM.
Return ONLY strict JSON with EXACTLY these top-level keys: ${fields.join(", ")}.
- Use null when a field is not present. Never invent values.
- Money fields must be numbers (no currency symbols).
- Dates must be ISO YYYY-MM-DD when possible, else the raw string.
- line_items (when applicable) is an array of objects with the fields described by the document type.
- For w9, set tin_present=true if a TIN/SSN/EIN is detected, but DO NOT include the actual number.
- signatures_present / *_signature_present are booleans based on visible signature indicators.
No prose. No markdown fences. JSON only.`;
}

async function extract(cls: Exclude<Cls, "unknown">, text: string, filename: string) {
  const callOnce = async (strict: boolean) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: strict ? buildSystem(cls) + "\nReturn JSON ONLY. No prose." : buildSystem(cls) },
          { role: "user", content: `FILENAME: ${filename}\nDOCUMENT_TEXT:\n${(text ?? "").slice(0, 18000)}` },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("provider_rate_limited");
      if (res.status === 402) throw new Error("provider_credits_exhausted");
      throw new Error(`gateway_${res.status}: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(content);
  };
  try { return await callOnce(false); } catch { return await callOnce(true); }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalize(cls: Exclude<Cls, "unknown">, raw: Record<string, any>) {
  const out: Record<string, any> = { ...raw };
  for (const k of ["contract_amount","deposit_amount","balance_due","subtotal","tax","total","estimate_total","replacement_cost_value","actual_cash_value","deductible","depreciation","amount_released","amount_claimed"]) {
    if (k in out) out[k] = num(out[k]);
  }
  if (cls === "w9") {
    delete (out as any).tin;
    delete (out as any).ssn;
    delete (out as any).ein;
    out.tin_present = !!raw.tin_present;
  }
  return out;
}

function validate(cls: Exclude<Cls, "unknown">, normalized: Record<string, any>, confidence: number) {
  const flags: { code: string; severity: "warn" | "error"; message?: string }[] = [];
  const push = (code: string, severity: "warn" | "error", message?: string) => flags.push({ code, severity, message });
  if (confidence < 0.85) push("low_classification_confidence", "warn");

  if (["signed_contract","roofing_contract"].includes(cls)) {
    if (!normalized.property_address) push("missing_property_address", "warn");
    if (!normalized.customer_name) push("missing_customer_name", "warn");
    if (normalized.signatures_present === false || normalized.homeowner_signature_present === false) {
      push("missing_signature", "warn");
    }
    const total = num(normalized.contract_amount);
    const dep = num(normalized.deposit_amount);
    const bal = num(normalized.balance_due);
    if (total != null && dep != null && bal != null && Math.abs(total - (dep + bal)) > 1) {
      push("money_mismatch", "warn", "contract_amount != deposit + balance_due");
    }
  }
  if (cls === "supplier_invoice" || cls === "customer_invoice" || cls === "estimate") {
    if (!normalized.total) push("missing_total", "warn");
    const sub = num(normalized.subtotal);
    const tax = num(normalized.tax);
    const tot = num(normalized.total);
    if (sub != null && tax != null && tot != null && Math.abs(tot - (sub + tax)) > 1) {
      push("money_mismatch", "warn", "total != subtotal + tax");
    }
  }
  if (cls === "permit" && !normalized.permit_number) push("missing_permit_number", "error");
  if (cls === "certificate_of_insurance") {
    const exps: any = normalized.expiration_dates;
    const dates: string[] = Array.isArray(exps) ? exps : exps ? [String(exps)] : [];
    const now = Date.now();
    const anyExpired = dates.some((d) => { const t = Date.parse(d); return Number.isFinite(t) && t < now; });
    if (anyExpired) push("coi_expired", "error");
  }
  if (cls === "w9" && !normalized.tin_present) push("missing_tin", "warn");
  if (cls === "lien_release" && /conditional/i.test(String(normalized.conditional_or_unconditional ?? ""))) {
    push("lien_release_conditional", "warn");
  }
  return flags;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) return jsonResponse({ ok: false, error: "AI provider not configured" }, 500);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    const internalSecret = req.headers.get("x-internal-worker-secret") ?? "";
    const expectedSecret = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;

    let userId: string | null = null;
    if (!isInternal) {
      if (!jwt) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      const { data: u } = await admin.auth.getUser(jwt);
      if (!u?.user) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      userId = u.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const documentId: string | null = body?.document_id ?? null;
    const forcedClass: string | null = body?.document_class ?? null;
    const force: boolean = !!body?.force;
    if (!documentId) return jsonResponse({ ok: false, error: "missing document_id" }, 400);

    const { data: doc } = await admin
      .from("documents")
      .select("id, tenant_id, filename, ocr_status, ocr_text, pipeline_entry_id, contact_id")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return jsonResponse({ ok: false, error: "document_not_found" }, 404);

    if (!isInternal && userId) {
      const { data: profile } = await admin
        .from("profiles").select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle();
      const effective = profile?.active_tenant_id || profile?.tenant_id;
      let allowed = !!effective && effective === doc.tenant_id;
      if (!allowed) {
        const { data: isMaster } = await admin.rpc("has_role", { _user_id: userId, _role: "master" as any });
        allowed = !!isMaster;
      }
      if (!allowed) return jsonResponse({ ok: false, error: "tenant access denied" }, 403);
    }

    if (!doc.ocr_text || doc.ocr_status !== "completed") {
      return jsonResponse({ ok: false, error: "ocr_not_completed" }, 409);
    }

    const { data: existing } = await admin
      .from("ai_document_extractions")
      .select("id, document_class, confidence, extraction_status")
      .eq("document_id", documentId)
      .maybeSingle();

    // Resolve class: forced > existing > kick classifier.
    let cls = (forcedClass ?? existing?.document_class ?? "unknown") as Cls;
    let confidence = Number(existing?.confidence ?? 0);
    if (cls === "unknown" || !existing) {
      // Inline classifier call (internal)
      const r = await fetch(`${SUPABASE_URL}/functions/v1/classify-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isInternal && expectedSecret ? { "x-internal-worker-secret": expectedSecret } : { Authorization: `Bearer ${jwt}` }),
        },
        body: JSON.stringify({ document_id: documentId, force: true }),
      });
      const cj = await r.json().catch(() => ({}));
      cls = (cj?.document_class ?? "unknown") as Cls;
      confidence = Number(cj?.confidence ?? 0);
    }

    if (cls === "unknown" || !(cls in FIELD_SCHEMAS)) {
      const payload = {
        tenant_id: doc.tenant_id,
        document_id: documentId,
        document_class: "unknown",
        confidence,
        extraction_status: "needs_review",
        validation_flags: [{ code: "unknown_document_class", severity: "warn" }],
        model_name: MODEL,
        model_version: MODEL_VERSION,
      };
      if (existing) await admin.from("ai_document_extractions").update(payload).eq("id", existing.id);
      else await admin.from("ai_document_extractions").insert(payload);
      return jsonResponse({ ok: true, status: "needs_review", document_class: "unknown" });
    }

    if (existing?.extraction_status === "completed" && !force) {
      return jsonResponse({ ok: true, status: "already_extracted" });
    }

    const raw = await extract(cls as Exclude<Cls, "unknown">, doc.ocr_text, doc.filename ?? "");
    const normalized = normalize(cls as Exclude<Cls, "unknown">, raw ?? {});
    const flags = validate(cls as Exclude<Cls, "unknown">, normalized, confidence);
    const needsReview = flags.some((f) => f.severity === "error") || confidence < 0.85;

    const payload = {
      tenant_id: doc.tenant_id,
      document_id: documentId,
      pipeline_entry_id: doc.pipeline_entry_id ?? null,
      contact_id: doc.contact_id ?? null,
      document_class: cls,
      confidence,
      extracted_fields: raw ?? {},
      normalized_fields: normalized,
      validation_flags: flags,
      extraction_status: needsReview ? "needs_review" : "completed",
      model_name: MODEL,
      model_version: MODEL_VERSION,
    };

    if (existing) await admin.from("ai_document_extractions").update(payload).eq("id", existing.id);
    else await admin.from("ai_document_extractions").insert(payload);

    return jsonResponse({ ok: true, status: payload.extraction_status, document_class: cls, flags });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract-document-fields]", msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
