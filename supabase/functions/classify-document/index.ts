// AI document classification.
// Reads documents.ocr_text + filename + document_type and classifies the
// business document into a fixed taxonomy. Writes a row in
// public.ai_document_extractions with extraction_status='classified' (or
// 'waiting_for_ocr' if OCR is not done yet).
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

const CLASSES = [
  "signed_contract",
  "roofing_contract",
  "supplier_invoice",
  "customer_invoice",
  "estimate",
  "insurance_scope",
  "permit",
  "notice_to_owner",
  "lien_release",
  "w9",
  "certificate_of_insurance",
  "subcontractor_agreement",
  "unknown",
] as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `You are a strict document classifier for a construction CRM.
Allowed classes: ${CLASSES.join(", ")}.
Be conservative. If unsure or confidence < 0.70, return "unknown".
Never guess signed_contract unless signature/date/customer/property indicators are present.
Never guess lien_release unless explicit lien waiver / release / satisfaction language is present.
Never guess w9 unless "Form W-9" or TIN/taxpayer/requester language is present.
Reply ONLY with strict JSON: {"document_class":"...","confidence":0.0-1.0,"reason":"short reason"}.`;

async function classify(text: string, filename: string, declaredType: string | null) {
  const prompt = `FILENAME: ${filename}
DECLARED_TYPE: ${declaredType ?? "none"}
DOCUMENT_TEXT (truncated):
${(text ?? "").slice(0, 12000)}`;
  const callOnce = async (strict: boolean) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: strict ? SYSTEM + "\nReturn JSON only. No prose, no fences." : SYSTEM },
          { role: "user", content: prompt },
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
  try { return await callOnce(false); }
  catch { return await callOnce(true); }
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
    const force: boolean = !!body?.force;
    if (!documentId) return jsonResponse({ ok: false, error: "missing document_id" }, 400);

    const { data: doc } = await admin
      .from("documents")
      .select("id, tenant_id, filename, document_type, ocr_status, ocr_text, pipeline_entry_id, contact_id")
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

    // Find or create extraction row.
    const { data: existing } = await admin
      .from("ai_document_extractions")
      .select("id, extraction_status, document_class")
      .eq("document_id", documentId)
      .maybeSingle();

    if (!doc.ocr_text || doc.ocr_status !== "completed") {
      const payload = {
        tenant_id: doc.tenant_id,
        document_id: documentId,
        pipeline_entry_id: doc.pipeline_entry_id ?? null,
        contact_id: doc.contact_id ?? null,
        extraction_status: "waiting_for_ocr",
        document_class: "unknown",
        validation_flags: [{ code: "ocr_not_completed", severity: "warn" }],
        model_name: MODEL,
        model_version: MODEL_VERSION,
      };
      if (existing) await admin.from("ai_document_extractions").update(payload).eq("id", existing.id);
      else await admin.from("ai_document_extractions").insert(payload);
      return jsonResponse({ ok: true, status: "waiting_for_ocr" });
    }

    if (existing && !force && existing.extraction_status !== "waiting_for_ocr") {
      return jsonResponse({ ok: true, status: "already_classified", document_class: existing.document_class });
    }

    const result = await classify(doc.ocr_text, doc.filename ?? "", doc.document_type ?? null);
    let cls = String(result?.document_class ?? "unknown");
    const conf = Math.max(0, Math.min(1, Number(result?.confidence ?? 0)));
    const reason = String(result?.reason ?? "").slice(0, 300);
    if (!CLASSES.includes(cls as any)) cls = "unknown";
    if (conf < 0.7) cls = "unknown";

    const payload = {
      tenant_id: doc.tenant_id,
      document_id: documentId,
      pipeline_entry_id: doc.pipeline_entry_id ?? null,
      contact_id: doc.contact_id ?? null,
      document_class: cls,
      confidence: conf,
      extraction_status: cls === "unknown" ? "needs_review" : "classified",
      validation_flags: cls === "unknown" ? [{ code: "low_classification_confidence", severity: "warn", reason }] : [],
      model_name: MODEL,
      model_version: MODEL_VERSION,
    };

    if (existing) await admin.from("ai_document_extractions").update(payload).eq("id", existing.id);
    else await admin.from("ai_document_extractions").insert(payload);

    return jsonResponse({
      ok: true,
      document_class: cls,
      confidence: conf,
      reason,
      extraction_ready: cls !== "unknown",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[classify-document]", msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
