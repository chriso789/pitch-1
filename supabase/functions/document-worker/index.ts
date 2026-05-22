// document-worker — routed Edge Function. Deterministic-first document parsing.
// AI fallback (Tier 4) is intentionally DEFERRED in this slice; low-confidence
// runs return code "low_confidence" and enqueue a review item.
import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import { extractPdfText, downloadStorageObject } from "../_shared/parsers/pdf-text.ts";
import { parseEagleViewRoofReport } from "../_shared/parsers/eagleview-roof.ts";
import { parseRoofrRoofReport } from "../_shared/parsers/roofr-roof.ts";
import { classifyBlueprintPage } from "../_shared/parsers/blueprint-classifier.ts";

const app = createRouter("document-worker");

app.get("/__health", (c) => jsonOk(c, { fn: "document-worker", ok: true }));
app.use("/*", requireAuth);
app.use("/*", requireTenant);

async function loadDocText(svc: ReturnType<typeof serviceClient>, tenantId: string, document_id: string) {
  const { data: doc, error } = await svc.from("documents")
    .select("id,file_path,tenant_id,document_type").eq("id", document_id).maybeSingle();
  if (error || !doc) throw new Error("document_not_found");
  if (doc.tenant_id !== tenantId) throw new Error("cross_tenant_forbidden");
  const bytes = await downloadStorageObject(svc, "documents", doc.file_path);
  const text = await extractPdfText(bytes);
  return { doc, text };
}

async function persistRun(svc: ReturnType<typeof serviceClient>, tenantId: string, document_id: string, run: {
  parser_name: string; parser_version: string; parser_tier: string; vendor_type?: string | null;
  document_type: string; status: string; confidence_score: number; duration_ms: number;
  page_count: number; extracted_field_count: number; missing_fields: string[];
  validation_errors: unknown; error_message?: string | null; triggered_by?: string | null;
}) {
  const { data, error } = await svc.from("document_parser_runs").insert({ tenant_id: tenantId, document_id, ...run })
    .select("id").maybeSingle();
  if (error) console.error("persistRun failed", error);
  return data?.id ?? null;
}

async function upsertExtraction(svc: ReturnType<typeof serviceClient>, tenantId: string, document_id: string, payload: {
  document_type: string; vendor_type: string | null; parser_name: string; parser_version: string;
  parser_tier: string; extracted_json: unknown; field_confidences: unknown; overall_confidence: number;
  requires_review: boolean;
}) {
  const { data: existing } = await svc.from("document_extractions").select("id,current_version,approved_at")
    .eq("document_id", document_id).maybeSingle();
  if (existing?.approved_at) return { id: existing.id, skipped: true, reason: "approved_locked" };
  const row = { tenant_id: tenantId, document_id, ...payload, current_version: (existing?.current_version ?? 0) + 1 };
  const { data, error } = await svc.from("document_extractions")
    .upsert(row, { onConflict: "document_id" }).select("id").maybeSingle();
  if (error) throw new Error(`extraction_upsert_failed: ${error.message}`);
  return { id: data?.id, skipped: false };
}

async function enqueueReview(svc: ReturnType<typeof serviceClient>, tenantId: string, document_id: string, parser_run_id: string | null, reason: string, detail: string) {
  await svc.from("document_review_queue").insert({
    tenant_id: tenantId, document_id, parser_run_id, reason, reason_detail: detail, priority: 5,
  });
}

// POST /parse/roof-report
//   Accepted payloads:
//     { document_id }                          → load from documents row, persist
//     { bucket, path }                         → direct storage read, transient (no persist)
//     { storage_path: "<bucket>/<path>" }      → convenience direct form, transient
app.post("/parse/roof-report", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = await c.req.json().catch(() => ({}));
  const svc = serviceClient();
  const t0 = Date.now();

  // ---- Resolve text source ----
  let document_id: string | null = typeof body.document_id === "string" ? body.document_id : null;
  let bucket: string | null = typeof body.bucket === "string" ? body.bucket : null;
  let path: string | null = typeof body.path === "string" ? body.path : null;

  if (!document_id && !bucket && typeof body.storage_path === "string") {
    const [b, ...rest] = body.storage_path.split("/");
    bucket = b;
    path = rest.join("/");
  }

  if (!document_id && (!bucket || !path)) {
    return jsonErr(c, "bad_request", "Provide document_id OR {bucket,path} OR storage_path", 400);
  }

  // Tenant scoping for direct storage reads: enforce {tenant_id}/... convention.
  if (!document_id && path) {
    const firstSeg = path.split("/")[0];
    if (firstSeg !== tenantId) {
      return jsonErr(c, "forbidden", "storage path must start with active tenant_id", 403);
    }
  }

  try {
    let text: Awaited<ReturnType<typeof extractPdfText>>;
    if (document_id) {
      const r = await loadDocText(svc, tenantId, document_id);
      text = r.text;
    } else {
      const bytes = await downloadStorageObject(svc, bucket!, path!);
      text = await extractPdfText(bytes);
    }

    if (!text.has_selectable_text) {
      let runId: string | null = null;
      if (document_id) {
        runId = await persistRun(svc, tenantId, document_id, {
          parser_name: "roof-report-router", parser_version: "v1", parser_tier: "deterministic",
          document_type: "roof_report", status: "failed", confidence_score: 0, duration_ms: Date.now() - t0,
          page_count: text.page_count, extracted_field_count: 0, missing_fields: [],
          validation_errors: null, error_message: "no_selectable_text", triggered_by: userId,
        });
        await enqueueReview(svc, tenantId, document_id, runId, "no_text_extracted", "PDF has no selectable text; OCR tier required.");
      }
      return jsonErr(c, "no_selectable_text", "PDF appears image-based; OCR tier not enabled in this slice.", 422);
    }

    const ev = parseEagleViewRoofReport(text.full_text);
    const rf = parseRoofrRoofReport(text.full_text);
    const winner = ev.overall_confidence >= rf.overall_confidence ? ev : rf;

    let runId: string | null = null;
    let extractionId: string | null = null;
    if (document_id) {
      runId = await persistRun(svc, tenantId, document_id, {
        parser_name: winner.parser_name, parser_version: winner.parser_version, parser_tier: "deterministic",
        vendor_type: winner.vendor_type, document_type: "roof_report",
        status: winner.requires_review ? "low_confidence" : "succeeded",
        confidence_score: Number(winner.overall_confidence.toFixed(4)),
        duration_ms: Date.now() - t0, page_count: text.page_count,
        extracted_field_count: Object.keys(winner.field_confidences).length,
        missing_fields: winner.missing_fields, validation_errors: winner.validation_errors, triggered_by: userId,
      });

      const up = await upsertExtraction(svc, tenantId, document_id, {
        document_type: "roof_report", vendor_type: winner.vendor_type,
        parser_name: winner.parser_name, parser_version: winner.parser_version, parser_tier: "deterministic",
        extracted_json: winner.data, field_confidences: winner.field_confidences,
        overall_confidence: Number(winner.overall_confidence.toFixed(4)),
        requires_review: winner.requires_review,
      });
      extractionId = up.id ?? null;

      if (winner.requires_review) {
        await enqueueReview(svc, tenantId, document_id, runId, "low_confidence",
          `overall=${winner.overall_confidence.toFixed(3)} missing=[${winner.missing_fields.join(",")}]`);
      }
    }

    return jsonOk(c, {
      mode: document_id ? "persisted" : "transient",
      extraction_id: extractionId, parser_run_id: runId,
      vendor_type: winner.vendor_type, confidence_score: winner.overall_confidence,
      requires_review: winner.requires_review, missing_fields: winner.missing_fields,
      validation_errors: winner.validation_errors, extracted: winner.data,
      ai_fallback: "deferred",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "document_not_found") return jsonErr(c, "not_found", "Document not found", 404);
    if (msg === "cross_tenant_forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);
    return jsonErr(c, "parse_failed", msg, 500);
  }
});

// POST /classify  { document_id }  — blueprint page classifier, deterministic
app.post("/classify", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const { document_id } = await c.req.json().catch(() => ({}));
  if (!document_id) return jsonErr(c, "bad_request", "document_id required", 400);
  const svc = serviceClient();
  const t0 = Date.now();
  try {
    const { text } = await loadDocText(svc, tenantId, document_id);
    const classifications = text.pages.map((p, i) => classifyBlueprintPage(i + 1, p));
    const avg = classifications.reduce((a, b) => a + b.confidence, 0) / Math.max(classifications.length, 1);
    const needsReview = classifications.some((c) => c.requires_review);

    const runId = await persistRun(svc, tenantId, document_id, {
      parser_name: "blueprint-classifier", parser_version: "v1.0.0", parser_tier: "deterministic",
      vendor_type: null, document_type: "blueprint",
      status: needsReview ? "low_confidence" : "succeeded",
      confidence_score: Number(avg.toFixed(4)), duration_ms: Date.now() - t0,
      page_count: text.page_count, extracted_field_count: classifications.length,
      missing_fields: [], validation_errors: null, triggered_by: userId,
    });

    if (needsReview) await enqueueReview(svc, tenantId, document_id, runId, "low_confidence",
      `avg_page_confidence=${avg.toFixed(3)}`);

    return jsonOk(c, { classifications, avg_confidence: avg, requires_review: needsReview, ai_fallback: "deferred" });
  } catch (e) {
    return jsonErr(c, "classify_failed", e instanceof Error ? e.message : String(e), 500);
  }
});

// Generic dispatcher
app.post("/parse", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doctype = body?.document_type ?? "roof_report";
  if (doctype === "roof_report") return app.fetch(new Request("http://x/parse/roof-report", { method: "POST", headers: c.req.raw.headers, body: JSON.stringify(body) }));
  if (doctype === "blueprint") return app.fetch(new Request("http://x/classify", { method: "POST", headers: c.req.raw.headers, body: JSON.stringify(body) }));
  return jsonErr(c, "unsupported_document_type", `document_type=${doctype} not supported in this slice`, 400);
});

// Tier 4 placeholder — intentionally disabled this loop
app.post("/ai-fallback", (c) => jsonErr(c, "ai_fallback_deferred",
  "AI fallback deferred to future phase. See docs/document-agent-architecture.md.", 501));

// Other parser stubs (return not_implemented rather than scaffolding 501 noise)
for (const route of ["/parse/invoice", "/parse/supplier-quote", "/parse/permit", "/parse/scope",
  "/extract/tables", "/extract/metadata", "/validate"]) {
  app.post(route, (c) => jsonErr(c, "not_implemented", `${route} deferred to next slice`, 501));
}

Deno.serve(app.fetch);
