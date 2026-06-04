// document-worker — routed Edge Function. Deterministic-first document parsing.
// AI fallback (Tier 4) is intentionally DEFERRED in this slice; low-confidence
// runs return code "low_confidence" and enqueue a review item.
import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient, serveRouter } from "../_shared/router.ts";
import { extractPdfText, downloadStorageObject } from "../_shared/parsers/pdf-text.ts";
import { parseEagleViewRoofReport } from "../_shared/parsers/eagleview-roof.ts";
import { parseRoofrRoofReport } from "../_shared/parsers/roofr-roof.ts";
import { classifyBlueprintPage } from "../_shared/parsers/blueprint-classifier.ts";
import { parseEagleViewWallReport } from "../_shared/blueprint-importer/parsers/eagleview-wall.ts";
import {
  classifyBlueprintDocument,
  detectTradesFromRoofReport,
  detectTradesFromWallReport,
  mapRoofExtractionToMeasurements,
  mapWallExtractionToMeasurements,
  evaluateTradeAcceptance,
  deterministicSessionHash,
  REVIEW_FLAG_CODES,
  generateDraftsForAcceptedTrade,
  generateTemplateBindingOnly,
  phase4InformationalSessionFlags,
  getPhase4Template,
} from "../_shared/blueprint-importer/index.ts";


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

// ---------------------------------------------------------------------------
// Blueprint pipeline (legacy plan_documents/plan_pages tables)
// Slice 2B: deterministic only. No AI. Replaces parse-blueprint-document
// and classify-blueprint-pages.
// ---------------------------------------------------------------------------

async function loadPlanDocument(svc: ReturnType<typeof serviceClient>, tenantId: string, document_id: string) {
  const { data: doc, error } = await svc.from("plan_documents")
    .select("id,tenant_id,file_path,page_count").eq("id", document_id).maybeSingle();
  if (error || !doc) throw new Error("document_not_found");
  if (doc.tenant_id !== tenantId) throw new Error("cross_tenant_forbidden");
  return doc;
}

function chainGeometry(document_id: string) {
  // Fire-and-forget chain to the existing geometry extractor. Preserves prior
  // legacy behavior; geometry consolidation belongs to a later slice.
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  fetch(`${baseUrl}/functions/v1/extract-roof-plan-geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ document_id }),
  }).catch((e) => console.error("[document-worker] geometry chain failed", e));
}

// POST /parse/blueprint { document_id }
// Full deterministic pipeline: download → per-page text → classify each →
// upsert plan_pages → update plan_documents → chain to geometry extractor.
app.post("/parse/blueprint", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const { document_id } = await c.req.json().catch(() => ({}));
  if (!document_id || typeof document_id !== "string") {
    return jsonErr(c, "bad_request", "document_id required", 400);
  }
  const svc = serviceClient();
  const t0 = Date.now();
  try {
    const doc = await loadPlanDocument(svc, tenantId, document_id);

    await svc.from("plan_documents")
      .update({ status: "classifying", status_message: "extracting page text" })
      .eq("id", document_id).eq("tenant_id", tenantId);

    const bytes = await downloadStorageObject(svc, "blueprints", doc.file_path);
    const text = await extractPdfText(bytes);

    const classifications = text.pages.map((p, i) => classifyBlueprintPage(i + 1, p));
    const avg = classifications.reduce((a, b) => a + b.confidence, 0) / Math.max(classifications.length, 1);
    const needsReview = classifications.some((c) => c.requires_review);

    const rows = classifications.map((cls, i) => ({
      tenant_id: tenantId,
      document_id,
      page_number: cls.page_number,
      raw_text: (text.pages[i] || "").slice(0, 8000),
      page_type: cls.page_type,
      page_type_confidence: cls.confidence,
      sheet_name: cls.sheet_name,
      sheet_number: cls.sheet_number,
      scale_text: cls.scale_text,
    }));
    const { error: upErr } = await svc.from("plan_pages")
      .upsert(rows, { onConflict: "document_id,page_number" });
    if (upErr) throw new Error(`plan_pages_upsert_failed: ${upErr.message}`);

    await svc.from("plan_documents").update({
      page_count: text.page_count,
      status: needsReview ? "ready_for_review" : "extracting_geometry",
      status_message: `classified ${classifications.length} pages (deterministic, avg=${avg.toFixed(2)})`,
    }).eq("id", document_id).eq("tenant_id", tenantId);

    const runId = await persistRun(svc, tenantId, document_id, {
      parser_name: "blueprint-classifier", parser_version: "v1.0.0", parser_tier: "deterministic",
      vendor_type: null, document_type: "blueprint",
      status: needsReview ? "low_confidence" : "succeeded",
      confidence_score: Number(avg.toFixed(4)), duration_ms: Date.now() - t0,
      page_count: text.page_count, extracted_field_count: classifications.length,
      missing_fields: [], validation_errors: null, triggered_by: userId,
    }).catch(() => null);

    if (needsReview && runId) {
      await enqueueReview(svc, tenantId, document_id, runId, "low_confidence",
        `blueprint avg_page_confidence=${avg.toFixed(3)}`).catch(() => {});
    }

    if (!needsReview) chainGeometry(document_id);

    return jsonOk(c, {
      document_id,
      page_count: text.page_count,
      classified_pages: classifications.map((c) => ({
        page_number: c.page_number,
        page_type: c.page_type,
        confidence: c.confidence,
        sheet_number: c.sheet_number,
        sheet_name: c.sheet_name,
        scale_text: c.scale_text,
        requires_review: c.requires_review,
      })),
      confidence_score: avg,
      requires_review: needsReview,
      ai_fallback: "deferred",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "document_not_found") return jsonErr(c, "not_found", "Document not found", 404);
    if (msg === "cross_tenant_forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);
    await svc.from("plan_documents").update({
      status: "failed", status_message: `parse failed: ${msg}`.slice(0, 240),
    }).eq("id", document_id).eq("tenant_id", tenantId).catch(() => {});
    return jsonErr(c, "parse_failed", msg, 500);
  }
});

// POST /classify-pages { document_id }
// Re-classify existing plan_pages rows deterministically (no re-extract).
app.post("/classify-pages", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const { document_id } = await c.req.json().catch(() => ({}));
  if (!document_id || typeof document_id !== "string") {
    return jsonErr(c, "bad_request", "document_id required", 400);
  }
  const svc = serviceClient();
  const t0 = Date.now();
  try {
    await loadPlanDocument(svc, tenantId, document_id);

    const { data: pages, error } = await svc.from("plan_pages")
      .select("id,raw_text,page_number")
      .eq("document_id", document_id).eq("tenant_id", tenantId)
      .order("page_number");
    if (error) throw new Error(error.message);

    const results: Array<{ page_number: number; page_type: string; confidence: number; requires_review: boolean }> = [];
    let needsReview = false;
    let sum = 0;
    for (const p of pages || []) {
      const cls = classifyBlueprintPage(p.page_number, p.raw_text || "");
      await svc.from("plan_pages").update({
        page_type: cls.page_type,
        page_type_confidence: cls.confidence,
        sheet_name: cls.sheet_name,
        sheet_number: cls.sheet_number,
        scale_text: cls.scale_text,
      }).eq("id", p.id).eq("tenant_id", tenantId);
      results.push({ page_number: cls.page_number, page_type: cls.page_type, confidence: cls.confidence, requires_review: cls.requires_review });
      sum += cls.confidence;
      if (cls.requires_review) needsReview = true;
    }
    const avg = results.length ? sum / results.length : 0;

    await svc.from("plan_documents").update({
      status: needsReview ? "ready_for_review" : "extracting_geometry",
      status_message: `re-classified ${results.length} pages (deterministic)`,
    }).eq("id", document_id).eq("tenant_id", tenantId);

    await persistRun(svc, tenantId, document_id, {
      parser_name: "blueprint-classifier", parser_version: "v1.0.0", parser_tier: "deterministic",
      vendor_type: null, document_type: "blueprint",
      status: needsReview ? "low_confidence" : "succeeded",
      confidence_score: Number(avg.toFixed(4)), duration_ms: Date.now() - t0,
      page_count: results.length, extracted_field_count: results.length,
      missing_fields: [], validation_errors: null, triggered_by: userId,
    }).catch(() => null);

    if (!needsReview) chainGeometry(document_id);

    return jsonOk(c, { document_id, results, confidence_score: avg, requires_review: needsReview, ai_fallback: "deferred" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "document_not_found") return jsonErr(c, "not_found", "Document not found", 404);
    if (msg === "cross_tenant_forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);
    return jsonErr(c, "classify_pages_failed", msg, 500);
  }
});

// Generic dispatcher
app.post("/parse", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doctype = body?.document_type ?? "roof_report";
  const headers = c.req.raw.headers;
  if (doctype === "roof_report") return app.fetch(new Request("http://x/parse/roof-report", { method: "POST", headers, body: JSON.stringify(body) }));
  if (doctype === "blueprint") return app.fetch(new Request("http://x/parse/blueprint", { method: "POST", headers, body: JSON.stringify(body) }));
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

// =============================================================================
// Blueprint Importer v2 — Phase 3 runtime routes
// Deterministic ingest + acceptance only. No materials, no labor, no estimate
// handoff. Writes only to Phase 1/2 blueprint_* tables (excluding material/labor
// draft tables). See docs/blueprint-importer-phase-3-runtime-detection.md.
// =============================================================================

interface IngestBody {
  bucket?: string;
  path?: string;
  storage_path?: string;
  document_id?: string;
  source_context_type?: string;
  source_context_id?: string | null;
  original_filename?: string | null;
}

app.post("/blueprint-importer/v2/ingest", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = (await c.req.json().catch(() => ({}))) as IngestBody;
  const svc = serviceClient();

  // ---- Resolve source bytes (mirrors /parse/roof-report) ----
  let bucket: string | null = body.bucket ?? null;
  let path: string | null = body.path ?? null;
  let docId: string | null = body.document_id ?? null;
  if (!bucket && !docId && typeof body.storage_path === "string") {
    const [b, ...rest] = body.storage_path.split("/");
    bucket = b; path = rest.join("/");
  }
  if (!docId && (!bucket || !path)) {
    return jsonErr(c, "bad_request", "Provide document_id OR bucket+path OR storage_path", 400);
  }
  if (!docId && path) {
    const first = path.split("/")[0];
    if (first !== tenantId) return jsonErr(c, "forbidden", "storage path must start with active tenant_id", 403);
  }

  let bytes: Uint8Array;
  let filename: string | null = body.original_filename ?? null;
  try {
    if (docId) {
      const { data: doc } = await svc.from("documents")
        .select("id,tenant_id,file_path,filename")
        .eq("id", docId).maybeSingle();
      if (!doc || doc.tenant_id !== tenantId) return jsonErr(c, "not_found", "document not found in tenant", 404);
      bytes = await downloadStorageObject(svc, "documents", doc.file_path);
      filename = filename ?? doc.filename ?? doc.file_path.split("/").pop() ?? null;
    } else {
      bytes = await downloadStorageObject(svc, bucket!, path!);
      filename = filename ?? path!.split("/").pop() ?? null;
    }
  } catch (e) {
    return jsonErr(c, "fetch_failed", e instanceof Error ? e.message : String(e), 500);
  }

  const pdfText = await extractPdfText(bytes);
  if (!pdfText.has_selectable_text) {
    return jsonErr(c, "no_selectable_text", "PDF has no selectable text; OCR tier not enabled.", 422);
  }

  // ---- Classify ----
  const cls = classifyBlueprintDocument(pdfText.full_text);

  // Run all candidate parsers and pick the strongest signal that matches the classifier.
  type ParserOutcome = {
    parser: "eagleview_roof" | "roofr_roof" | "eagleview_wall" | "none";
    data: Record<string, unknown> | null;
    confidence: number;
    requires_review: boolean;
    missing_fields: string[];
    field_confidences: Record<string, number>;
  };
  const candidates: ParserOutcome[] = [];
  if (cls.document_type === "eagleview_roof_report" || cls.db_document_type === "roof_report") {
    const ev = parseEagleViewRoofReport(pdfText.full_text);
    candidates.push({ parser: "eagleview_roof", data: ev.data as unknown as Record<string, unknown>, confidence: ev.overall_confidence, requires_review: ev.requires_review, missing_fields: ev.missing_fields, field_confidences: ev.field_confidences });
  }
  if (cls.document_type === "roofr_roof_report" || cls.db_document_type === "roof_report") {
    const rf = parseRoofrRoofReport(pdfText.full_text);
    candidates.push({ parser: "roofr_roof", data: rf.data as unknown as Record<string, unknown>, confidence: rf.overall_confidence, requires_review: rf.requires_review, missing_fields: rf.missing_fields, field_confidences: rf.field_confidences });
  }
  if (cls.document_type === "eagleview_wall_report" || cls.db_document_type === "wall_report") {
    const wl = parseEagleViewWallReport(pdfText.full_text);
    candidates.push({ parser: "eagleview_wall", data: wl.data as unknown as Record<string, unknown>, confidence: wl.overall_confidence, requires_review: wl.requires_review, missing_fields: wl.missing_fields, field_confidences: wl.field_confidences });
  }
  const winner = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!winner || winner.parser === "none" || !winner.data) {
    return jsonErr(c, "unsupported_document", `classifier=${cls.document_type}; no MVP parser produced output`, 422);
  }

  // ---- Deterministic dedup hash → supersede prior session for same source ----
  const dHash = await deterministicSessionHash({
    tenant_id: tenantId,
    document_type: cls.db_document_type,
    provider: cls.db_provider,
    normalized_extraction: winner.data,
  });
  const { data: prior } = await svc.from("blueprint_import_sessions")
    .select("id").eq("tenant_id", tenantId).eq("deterministic_hash", dHash)
    .neq("status", "superseded").maybeSingle();
  if (prior?.id) {
    await svc.from("blueprint_import_sessions").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("id", prior.id).eq("tenant_id", tenantId);
  }

  // ---- Create session ----
  const { data: session, error: sErr } = await svc.from("blueprint_import_sessions").insert({
    tenant_id: tenantId,
    source_context_type: body.source_context_type ?? "standalone",
    source_context_id: body.source_context_id ?? null,
    status: "parsed",
    contract_version: "blueprint-importer-v2",
    deterministic_hash: dHash,
    metadata: { classifier: cls, parser: winner.parser, supersedes: prior?.id ?? null },
    created_by: userId,
  }).select("id").single();
  if (sErr || !session) return jsonErr(c, "session_insert_failed", sErr?.message ?? "unknown", 500);
  const sessionId = session.id as string;

  // ---- Persist source document ----
  const { data: srcDoc, error: dErr } = await svc.from("blueprint_source_documents").insert({
    import_session_id: sessionId,
    tenant_id: tenantId,
    storage_path: path ?? null,
    document_reference: docId,
    document_type: cls.db_document_type,
    provider: cls.db_provider,
    original_filename: filename,
    page_count: pdfText.page_count,
    extraction_status: winner.requires_review ? "succeeded" : "succeeded",
    metadata: {
      missing_fields: winner.missing_fields,
      field_confidences: winner.field_confidences,
      overall_confidence: winner.confidence,
    },
  }).select("id").single();
  if (dErr || !srcDoc) return jsonErr(c, "source_doc_insert_failed", dErr?.message ?? "unknown", 500);
  const srcDocId = srcDoc.id as string;

  // ---- Map measurements + insert PlanPaths first, then measurements with FK ----
  const mapCtx = { document_type: cls.db_document_type as "roof_report" | "wall_report", provider: cls.db_provider, file_name: filename };
  const mapped =
    cls.db_document_type === "roof_report"
      ? mapRoofExtractionToMeasurements(winner.data as never, mapCtx)
      : cls.db_document_type === "wall_report"
        ? mapWallExtractionToMeasurements(winner.data as never, mapCtx)
        : [];

  const planPathRows = mapped.map((m) => ({
    import_session_id: sessionId,
    tenant_id: tenantId,
    source_document_id: srcDocId,
    path_type: m.plan_path.path_type,
    file_name: m.plan_path.file_name,
    document_type: m.plan_path.document_type,
    provider: m.plan_path.provider,
    page_number: m.plan_path.page_number ?? null,
    section_label: m.plan_path.section_label ?? null,
    table_label: m.plan_path.table_label ?? null,
    diagram_label: m.plan_path.diagram_label ?? null,
    source_text_excerpt: m.plan_path.source_text_excerpt ?? null,
    confidence: m.plan_path.confidence,
    // include the plan_path_key in source_text_excerpt fallback when nothing else
  }));
  let insertedPlanPaths: { id: string }[] = [];
  if (planPathRows.length) {
    const { data, error } = await svc.from("blueprint_plan_paths").insert(planPathRows).select("id");
    if (error) return jsonErr(c, "plan_path_insert_failed", error.message, 500);
    insertedPlanPaths = data ?? [];
  }

  const moRows = mapped.map((m, idx) => ({
    import_session_id: sessionId,
    tenant_id: tenantId,
    source_document_id: srcDocId,
    trade_id: m.measurement.trade_id,
    measurement_key: m.measurement.measurement_key,
    measurement_group: m.measurement.measurement_group,
    quantity: m.measurement.quantity,
    unit: m.measurement.unit,
    confidence: m.measurement.confidence,
    source_value_raw: m.measurement.source_value_raw ?? null,
    normalized_value: m.measurement.normalized_value ?? null,
    plan_path_id: insertedPlanPaths[idx]?.id ?? null,
    page_number: m.measurement.page_number ?? null,
    metadata: m.measurement.metadata ?? {},
  }));
  if (moRows.length) {
    const { error } = await svc.from("blueprint_measurement_objects").insert(moRows);
    if (error) return jsonErr(c, "measurement_insert_failed", error.message, 500);
  }

  // ---- Detect trades ----
  const detected =
    cls.db_document_type === "roof_report"
      ? detectTradesFromRoofReport(winner.data as never, cls.db_provider)
      : cls.db_document_type === "wall_report"
        ? detectTradesFromWallReport(winner.data as never, cls.db_provider)
        : [];
  if (detected.length) {
    const { error } = await svc.from("blueprint_detected_trades").insert(detected.map((d) => ({
      import_session_id: sessionId,
      tenant_id: tenantId,
      trade_id: d.trade_id,
      support_status: d.support_status,
      confidence: d.confidence,
      detection_signals: d.detection_signals,
      source_document_ids: [srcDocId],
      status: "detected",
    })));
    if (error) return jsonErr(c, "detected_trade_insert_failed", error.message, 500);
  }

  // ---- Review flags from report warnings + Phase 3 disabled-feature notices ----
  const flagRows: Array<Record<string, unknown>> = [];
  const w = winner.data as Record<string, unknown>;
  if (cls.db_document_type === "wall_report") {
    if (w.has_image_obstruction_warning) {
      flagRows.push(flag(sessionId, tenantId, srcDocId, "source_document", "warning", REVIEW_FLAG_CODES.WALL_IMAGE_OBSTRUCTION_WARNING, "Report indicates image obstruction; wall measurements may be incomplete.", false));
    }
    if (w.has_field_verification_warning) {
      flagRows.push(flag(sessionId, tenantId, srcDocId, "source_document", "warning", REVIEW_FLAG_CODES.REPORT_FIELD_VERIFICATION_REQUIRED, "Report flags fields that require field verification (e.g. yellow-shaded values).", false));
    }
    if (w.has_soffit_assumption_warning) {
      flagRows.push(flag(sessionId, tenantId, srcDocId, "source_document", "warning", REVIEW_FLAG_CODES.WALL_SOFFIT_ASSUMPTION_WARNING, "Wall report includes a soffit assumption; verify before pricing.", false));
    }
  }
  if (cls.db_document_type === "roof_report" && (w.penetrations_count ?? 0) === 0) {
    // Penetrations not enumerated → field verification suggested.
    flagRows.push(flag(sessionId, tenantId, srcDocId, "source_document", "info", REVIEW_FLAG_CODES.ROOF_PENETRATION_FIELD_VERIFICATION_REQUIRED, "Roof penetrations were not enumerated; verify in field before finalizing scope.", false));
  }
  // Phase 4 disabled notice — informational only.
  flagRows.push(flag(sessionId, tenantId, null, "import_session", "info", REVIEW_FLAG_CODES.MATERIAL_POPULATION_NOT_ENABLED_PHASE_3, "Material draft generation is not enabled until Phase 4.", false));
  flagRows.push(flag(sessionId, tenantId, null, "import_session", "info", REVIEW_FLAG_CODES.LABOR_PRICING_NOT_ENABLED_PHASE_3, "Labor pricing is not enabled until Phase 4.", false));

  if (flagRows.length) {
    await svc.from("blueprint_review_flags").insert(flagRows);
  }

  // ---- Promote session to trades_detected ----
  await svc.from("blueprint_import_sessions").update({
    status: "trades_detected",
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).eq("tenant_id", tenantId);

  return jsonOk(c, {
    session_id: sessionId,
    source_document_id: srcDocId,
    classifier: cls,
    parser: winner.parser,
    overall_confidence: winner.confidence,
    measurement_count: moRows.length,
    detected_trade_count: detected.length,
    plan_path_count: insertedPlanPaths.length,
    deterministic_hash: dHash,
    supersedes_session_id: prior?.id ?? null,
  });
});

function flag(
  sessionId: string,
  tenantId: string,
  relatedId: string | null,
  relatedType: string,
  severity: "info" | "warning" | "error" | "blocker",
  flag_code: string,
  message: string,
  blocking: boolean,
) {
  return {
    import_session_id: sessionId,
    tenant_id: tenantId,
    related_entity_type: relatedType,
    related_entity_id: relatedId,
    severity,
    flag_code,
    message,
    blocking,
  };
}

// ---------------------------------------------------------------------------
// GET session summary — for the review UI.
// ---------------------------------------------------------------------------
app.post("/blueprint-importer/v2/session", async (c) => {
  const tenantId = c.get("tenantId")!;
  const { session_id } = await c.req.json().catch(() => ({}));
  if (!session_id) return jsonErr(c, "bad_request", "session_id required", 400);
  const svc = serviceClient();

  const [{ data: session }, { data: sourceDocs }, { data: detected }, { data: accepted }, { data: measurements }, { data: planPaths }, { data: flags }] = await Promise.all([
    svc.from("blueprint_import_sessions").select("*").eq("id", session_id).eq("tenant_id", tenantId).maybeSingle(),
    svc.from("blueprint_source_documents").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_detected_trades").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_accepted_trades").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_measurement_objects").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_plan_paths").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_review_flags").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
  ]);

  if (!session) return jsonErr(c, "not_found", "session not found", 404);
  return jsonOk(c, { session, source_documents: sourceDocs ?? [], detected_trades: detected ?? [], accepted_trades: accepted ?? [], measurements: measurements ?? [], plan_paths: planPaths ?? [], review_flags: flags ?? [] });
});

// ---------------------------------------------------------------------------
// Accept a detected trade. Enforces Phase 3 acceptance gates at runtime.
// ---------------------------------------------------------------------------
interface AcceptBody {
  session_id: string;
  trade_id: string;
  detected_trade_id?: string | null;
  requested_review_state?: "pending_review" | "manual_only";
  user_assumptions?: Record<string, unknown>;
}

app.post("/blueprint-importer/v2/accept-trade", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = (await c.req.json().catch(() => ({}))) as AcceptBody;
  if (!body?.session_id || !body?.trade_id) return jsonErr(c, "bad_request", "session_id + trade_id required", 400);

  const svc = serviceClient();
  // Load session context.
  const [{ data: session }, { data: detected }, { data: accepted }, { data: sourceDocs }, { data: measurements }] = await Promise.all([
    svc.from("blueprint_import_sessions").select("id,tenant_id").eq("id", body.session_id).eq("tenant_id", tenantId).maybeSingle(),
    svc.from("blueprint_detected_trades").select("*").eq("import_session_id", body.session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_accepted_trades").select("trade_id").eq("import_session_id", body.session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_source_documents").select("document_type").eq("import_session_id", body.session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_measurement_objects").select("trade_id,plan_path_id").eq("import_session_id", body.session_id).eq("tenant_id", tenantId),
  ]);
  if (!session) return jsonErr(c, "not_found", "session not found", 404);

  const detectedRow = (detected ?? []).find((d) => d.trade_id === body.trade_id) ?? null;
  const acceptedIds = (accepted ?? []).map((a) => a.trade_id);
  const hasWallSource = (sourceDocs ?? []).some((s) => s.document_type === "wall_report");
  const hasPlanPathsForTrade = (measurements ?? []).some((m) => m.trade_id === body.trade_id && !!m.plan_path_id);

  const verdict = evaluateTradeAcceptance({
    trade_id: body.trade_id,
    already_accepted_trade_ids: acceptedIds,
    detected_support_status: detectedRow?.support_status ?? null,
    has_exterior_walls_siding_source: hasWallSource,
    has_plan_paths_for_trade: hasPlanPathsForTrade,
    requested_review_state: body.requested_review_state,
  });

  if (!verdict.ok) {
    // Persist a blocking review flag so the failure is visible in the UI.
    await svc.from("blueprint_review_flags").insert({
      import_session_id: body.session_id,
      tenant_id: tenantId,
      related_entity_type: "detected_trade",
      related_entity_id: detectedRow?.id ?? null,
      severity: "blocker",
      flag_code: verdict.flag_code,
      message: verdict.reason,
      blocking: true,
    });
    return jsonErr(c, verdict.flag_code, verdict.reason, verdict.http_status);
  }

  const { data: acceptedRow, error } = await svc.from("blueprint_accepted_trades").insert({
    import_session_id: body.session_id,
    tenant_id: tenantId,
    detected_trade_id: detectedRow?.id ?? null,
    trade_id: body.trade_id,
    accepted_by: userId,
    status: "accepted",
    review_state: verdict.review_state,
    user_assumptions: body.user_assumptions ?? {},
  }).select("*").single();
  if (error) return jsonErr(c, "accept_insert_failed", error.message, 500);

  return jsonOk(c, { accepted_trade: acceptedRow });
});

// =============================================================================
// Blueprint Importer v2 — Phase 4 draft generation routes
// Template binding + deterministic material/labor draft generation.
// Writes only to: blueprint_template_bindings, blueprint_material_draft_lines,
//                 blueprint_labor_draft_lines, blueprint_review_flags.
// Does NOT write to estimates, proposals, work orders, or any CRM table.
// See docs/blueprint-importer-phase-4-draft-generation.md.
// =============================================================================

async function loadPhase4Context(
  svc: ReturnType<typeof serviceClient>,
  tenantId: string,
  sessionId: string,
  acceptedTradeId: string,
) {
  const [{ data: session }, { data: accepted }, { data: measurements }, { data: sourceDocs }, { data: allAccepted }] = await Promise.all([
    svc.from("blueprint_import_sessions").select("id,tenant_id,status").eq("id", sessionId).eq("tenant_id", tenantId).maybeSingle(),
    svc.from("blueprint_accepted_trades").select("*").eq("id", acceptedTradeId).eq("tenant_id", tenantId).maybeSingle(),
    svc.from("blueprint_measurement_objects").select("id,trade_id,measurement_key,quantity,unit,plan_path_id,normalized_value").eq("import_session_id", sessionId).eq("tenant_id", tenantId),
    svc.from("blueprint_source_documents").select("document_type").eq("import_session_id", sessionId).eq("tenant_id", tenantId),
    svc.from("blueprint_accepted_trades").select("trade_id").eq("import_session_id", sessionId).eq("tenant_id", tenantId),
  ]);
  return { session, accepted, measurements: measurements ?? [], sourceDocs: sourceDocs ?? [], allAccepted: allAccepted ?? [] };
}

// ---- POST /blueprint-importer/v2/bind-template ----
app.post("/blueprint-importer/v2/bind-template", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const { session_id, accepted_trade_id, user_assumptions } = body as {
    session_id?: string; accepted_trade_id?: string; user_assumptions?: Record<string, unknown>;
  };
  if (!session_id || !accepted_trade_id) return jsonErr(c, "bad_request", "session_id + accepted_trade_id required", 400);
  const svc = serviceClient();
  const ctx = await loadPhase4Context(svc, tenantId, session_id, accepted_trade_id);
  if (!ctx.session || !ctx.accepted) return jsonErr(c, "not_found", "session or accepted_trade not found", 404);

  const paintSource = ctx.sourceDocs.some((s) => s.document_type === "wall_report")
    || ctx.allAccepted.some((a) => a.trade_id === "exterior_walls_siding");
  const merged = { ...(ctx.accepted.user_assumptions ?? {}), ...(user_assumptions ?? {}) };
  const tradeId = ctx.accepted.trade_id as string;
  const tradeMeasurements = ctx.measurements.filter((m) => m.trade_id === tradeId);

  const { binding, flags } = generateTemplateBindingOnly({
    trade_id: tradeId as never,
    accepted_trade_id,
    measurements: tradeMeasurements as never,
    user_assumptions: merged,
    paint_source_present: paintSource,
  });

  // Supersede prior bindings for this accepted_trade.
  await svc.from("blueprint_template_bindings").update({ binding_status: "superseded", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("accepted_trade_id", accepted_trade_id).neq("binding_status", "superseded");

  let bindingRow: { id: string } | null = null;
  if (binding) {
    const { data, error } = await svc.from("blueprint_template_bindings").insert({
      import_session_id: session_id,
      tenant_id: tenantId,
      accepted_trade_id,
      trade_id: tradeId,
      template_id: null,
      template_version: binding.internal_template_key ?? null,
      binding_status: binding.binding_status === "ready" ? "ready" : "blocked",
      required_inputs: binding.required_inputs,
      optional_inputs: binding.optional_inputs,
      missing_inputs: binding.missing_inputs,
      user_assumptions: merged,
    }).select("id").single();
    if (error) return jsonErr(c, "binding_insert_failed", error.message, 500);
    bindingRow = data;
  }
  // Persist flags.
  if (flags.length) {
    await svc.from("blueprint_review_flags").insert(flags.map((f) => ({
      import_session_id: session_id,
      tenant_id: tenantId,
      related_entity_type: f.related_entity_type,
      related_entity_id: f.related_entity_type === "template_binding" ? bindingRow?.id ?? null
        : f.related_entity_type === "accepted_trade" ? accepted_trade_id : null,
      severity: f.severity,
      flag_code: f.flag_code,
      message: f.message,
      blocking: f.blocking,
    })));
  }
  // Persist merged user_assumptions on the accepted_trade.
  await svc.from("blueprint_accepted_trades").update({ user_assumptions: merged, updated_at: new Date().toISOString() })
    .eq("id", accepted_trade_id).eq("tenant_id", tenantId);

  return jsonOk(c, { template_binding: binding, binding_id: bindingRow?.id ?? null, review_flags: flags });
});

async function runDraftGeneration(
  c: any,
  mode: "materials" | "labor",
) {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const { session_id, accepted_trade_id, user_assumptions } = body as {
    session_id?: string; accepted_trade_id?: string; user_assumptions?: Record<string, unknown>;
  };
  if (!session_id || !accepted_trade_id) return jsonErr(c, "bad_request", "session_id + accepted_trade_id required", 400);
  const svc = serviceClient();
  const ctx = await loadPhase4Context(svc, tenantId, session_id, accepted_trade_id);
  if (!ctx.session || !ctx.accepted) return jsonErr(c, "not_found", "session or accepted_trade not found", 404);

  const paintSource = ctx.sourceDocs.some((s) => s.document_type === "wall_report")
    || ctx.allAccepted.some((a) => a.trade_id === "exterior_walls_siding");
  const merged = { ...(ctx.accepted.user_assumptions ?? {}), ...(user_assumptions ?? {}) };
  const tradeId = ctx.accepted.trade_id as string;
  const tradeMeasurements = ctx.measurements.filter((m) => m.trade_id === tradeId);

  const out = generateDraftsForAcceptedTrade({
    trade_id: tradeId as never,
    accepted_trade_id,
    measurements: tradeMeasurements as never,
    user_assumptions: merged,
    paint_source_present: paintSource,
  });

  // Find / create / supersede binding so draft rows can FK to it.
  let bindingId: string | null = null;
  {
    const { data: existing } = await svc.from("blueprint_template_bindings")
      .select("id,binding_status")
      .eq("tenant_id", tenantId).eq("accepted_trade_id", accepted_trade_id)
      .neq("binding_status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.id && out.template_binding.internal_template_key) {
      // Update existing binding with refreshed state.
      await svc.from("blueprint_template_bindings").update({
        binding_status: out.template_binding.binding_status === "ready" ? "ready" : "blocked",
        required_inputs: out.template_binding.required_inputs,
        optional_inputs: out.template_binding.optional_inputs,
        missing_inputs: out.template_binding.missing_inputs,
        user_assumptions: merged,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).eq("tenant_id", tenantId);
      bindingId = existing.id;
    } else if (out.template_binding.internal_template_key) {
      const { data: created, error: cErr } = await svc.from("blueprint_template_bindings").insert({
        import_session_id: session_id,
        tenant_id: tenantId,
        accepted_trade_id,
        trade_id: tradeId,
        template_id: null,
        template_version: out.template_binding.internal_template_key,
        binding_status: out.template_binding.binding_status === "ready" ? "ready" : "blocked",
        required_inputs: out.template_binding.required_inputs,
        optional_inputs: out.template_binding.optional_inputs,
        missing_inputs: out.template_binding.missing_inputs,
        user_assumptions: merged,
      }).select("id").single();
      if (cErr) return jsonErr(c, "binding_insert_failed", cErr.message, 500);
      bindingId = created!.id;
    }
  }

  // Idempotency: supersede prior non-superseded draft rows of the same mode for this accepted_trade.
  const draftTable = mode === "materials" ? "blueprint_material_draft_lines" : "blueprint_labor_draft_lines";
  await svc.from(draftTable).update({ status: "superseded" })
    .eq("tenant_id", tenantId).eq("accepted_trade_id", accepted_trade_id).neq("status", "superseded");

  let insertedRows: Array<{ id: string; rule_id?: string | null; material_rule_id?: string | null; labor_rule_id?: string | null }> = [];
  if (mode === "materials") {
    const rows = out.material_drafts.map((d) => ({
      import_session_id: session_id,
      tenant_id: tenantId,
      accepted_trade_id,
      template_binding_id: bindingId,
      material_rule_id: d.rule_id,
      item_key: d.item_key,
      item_name: d.item_name,
      quantity: d.quantity,
      unit: d.unit,
      rounding_rule: d.rounding_rule,
      waste_percent: d.waste_percent,
      source_measurement_ids: d.source_measurement_ids,
      plan_path_ids: d.plan_path_ids,
      formula_key: d.formula_key,
      formula_inputs: d.formula_inputs,
      catalog_resolution_status: d.catalog_resolution_status,
      catalog_item_id: d.catalog_item_id,
      status: d.status,
    }));
    if (rows.length) {
      const { data, error } = await svc.from("blueprint_material_draft_lines").insert(rows).select("id,material_rule_id");
      if (error) return jsonErr(c, "material_insert_failed", error.message, 500);
      insertedRows = data ?? [];
    }
  } else {
    const rows = out.labor_drafts.map((d) => ({
      import_session_id: session_id,
      tenant_id: tenantId,
      accepted_trade_id,
      template_binding_id: bindingId,
      labor_rule_id: d.rule_id,
      labor_key: d.labor_key,
      labor_name: d.labor_name,
      quantity: d.quantity,
      unit: d.unit,
      base_rate: null,
      complexity_multiplier: null,
      source_measurement_ids: d.source_measurement_ids,
      plan_path_ids: d.plan_path_ids,
      formula_key: d.formula_key,
      formula_inputs: { ...d.formula_inputs, complexity_flags: d.complexity_flags },
      status: d.status,
    }));
    if (rows.length) {
      const { data, error } = await svc.from("blueprint_labor_draft_lines").insert(rows).select("id,labor_rule_id");
      if (error) return jsonErr(c, "labor_insert_failed", error.message, 500);
      insertedRows = data ?? [];
    }
  }

  // Persist flags. Resolve material_draft_line / labor_draft_line ids from inserted rows by rule_id.
  const flagSet = mode === "materials"
    ? out.review_flags.filter((f) => f.related_entity_type !== "labor_draft_line")
    : out.review_flags.filter((f) => f.related_entity_type !== "material_draft_line");

  const flagRows = flagSet.map((f) => {
    let related_entity_id: string | null = null;
    if (f.related_entity_type === "template_binding") related_entity_id = bindingId;
    else if (f.related_entity_type === "accepted_trade") related_entity_id = accepted_trade_id;
    else if (f.related_entity_type === "material_draft_line") {
      // related_entity_local_key === `material:<accepted_trade_id>:<rule_id>`
      const ruleId = f.related_entity_local_key.split(":").slice(2).join(":");
      related_entity_id = insertedRows.find((r) => (r as any).material_rule_id === ruleId)?.id ?? null;
    } else if (f.related_entity_type === "labor_draft_line") {
      const ruleId = f.related_entity_local_key.split(":").slice(2).join(":");
      related_entity_id = insertedRows.find((r) => (r as any).labor_rule_id === ruleId)?.id ?? null;
    }
    return {
      import_session_id: session_id,
      tenant_id: tenantId,
      related_entity_type: f.related_entity_type,
      related_entity_id,
      severity: f.severity,
      flag_code: f.flag_code,
      message: f.message,
      blocking: f.blocking,
    };
  });
  if (flagRows.length) {
    await svc.from("blueprint_review_flags").insert(flagRows);
  }

  // Add Phase 4 informational session flags (only once per session_id).
  const { data: existingInfo } = await svc.from("blueprint_review_flags")
    .select("id,flag_code")
    .eq("tenant_id", tenantId).eq("import_session_id", session_id)
    .in("flag_code", [REVIEW_FLAG_CODES.FINAL_PRICING_NOT_ENABLED_PHASE_4, REVIEW_FLAG_CODES.CRM_HANDOFF_NOT_ENABLED_PHASE_4]);
  const existingCodes = new Set((existingInfo ?? []).map((r) => r.flag_code));
  const newInfo = phase4InformationalSessionFlags(session_id).filter((f) => !existingCodes.has(f.flag_code));
  if (newInfo.length) {
    await svc.from("blueprint_review_flags").insert(newInfo.map((f) => ({
      import_session_id: session_id,
      tenant_id: tenantId,
      related_entity_type: f.related_entity_type,
      related_entity_id: null,
      severity: f.severity,
      flag_code: f.flag_code,
      message: f.message,
      blocking: f.blocking,
    })));
  }

  return jsonOk(c, {
    mode,
    template_binding_id: bindingId,
    template_binding: out.template_binding,
    material_drafts: mode === "materials" ? out.material_drafts : [],
    labor_drafts: mode === "labor" ? out.labor_drafts : [],
    review_flags: flagSet,
    blocked_summary: out.blocked_summary,
    inserted_count: insertedRows.length,
  });
}

app.post("/blueprint-importer/v2/generate-material-drafts", (c) => runDraftGeneration(c, "materials"));
app.post("/blueprint-importer/v2/generate-labor-drafts", (c) => runDraftGeneration(c, "labor"));

// ---- POST /blueprint-importer/v2/draft-lines ----
// Read-only summary of Phase 4 outputs for a session.
app.post("/blueprint-importer/v2/draft-lines", async (c) => {
  const tenantId = c.get("tenantId")!;
  const { session_id } = await c.req.json().catch(() => ({}));
  if (!session_id) return jsonErr(c, "bad_request", "session_id required", 400);
  const svc = serviceClient();
  const [{ data: bindings }, { data: materials }, { data: labor }, { data: templatesMeta }] = await Promise.all([
    svc.from("blueprint_template_bindings").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_material_draft_lines").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_labor_draft_lines").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_accepted_trades").select("id,trade_id").eq("import_session_id", session_id).eq("tenant_id", tenantId),
  ]);
  const trade_templates = (templatesMeta ?? []).map((t) => ({
    accepted_trade_id: t.id,
    trade_id: t.trade_id,
    template: getPhase4Template(t.trade_id as never),
  }));
  return jsonOk(c, {
    bindings: bindings ?? [],
    material_draft_lines: materials ?? [],
    labor_draft_lines: labor ?? [],
    trade_templates,
  });
});

serveRouter(app);


