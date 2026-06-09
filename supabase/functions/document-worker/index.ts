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
  buildHandoffPreview,
  buildHandoffBatchKey,
  PHASE_6_DISABLED_MESSAGES,
  type Phase6DraftModeFilter,
} from "../_shared/blueprint-importer/index.ts";
import {
  resolveCandidateAgainstBindings,
  buildCandidateUpdate,
  buildReviewFlagSpecs,
  summarizeResolverResults,
  PHASE_7_6B_RESOLVER_VERSION,
  type ResolverCandidate,
  type ResolverV2RuntimeResult,
} from "../_shared/blueprint-importer/phase7_6b-resolver.ts";
import type { BlueprintCatalogBinding } from "../_shared/blueprint-importer/catalog-bindings.ts";
import {
  evaluatePricingPreflight,
  buildPreflightCandidateUpdate,
  buildPreflightReviewFlagSpecs,
  summarizePreflightResults,
  PHASE_7_6C_PREFLIGHT_VERSION,
  type PreflightCandidateInput,
  type PreflightCandidateResult,
  type TargetRowSnapshot,
} from "../_shared/blueprint-importer/phase7_6c-preflight.ts";



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

    let bytes: Uint8Array;
    try {
      bytes = await downloadStorageObject(svc, "blueprints", doc.file_path);
    } catch (primaryError) {
      try {
        bytes = await downloadStorageObject(svc, "blueprint-documents", doc.file_path);
      } catch {
        throw primaryError;
      }
    }
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

// =============================================================================
// Blueprint Importer v2 — Phase 6 handoff PREVIEW routes
// Preview-only. NEVER writes to enhanced_estimates / estimate_line_items /
// proposal_tier_items. NEVER writes blueprint_estimate_line_provenance.
// Push to Estimate is intentionally not exposed.
// See docs/blueprint-importer-phase-6-handoff-preview.md.
// =============================================================================

interface HandoffPreviewBody {
  import_session_id?: string;
  target_context_type?: string;
  target_context_id?: string | null;
  canonical_estimate_target_id?: string | null;
  accepted_trade_ids?: string[] | null;
  draft_mode?: Phase6DraftModeFilter;
  pricing_mode?: "quantity_only" | "ready_for_pricing_review";
  catalog_mode?: "catalog_resolved_only" | "user_approved_custom_lines" | "preview_only";
  custom_line_mode?: "disabled" | "enabled";
}

app.post("/blueprint-importer/v2/handoff-preview", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = (await c.req.json().catch(() => ({}))) as HandoffPreviewBody;
  const session_id = body.import_session_id;
  if (!session_id) return jsonErr(c, "bad_request", "import_session_id required", 400);

  const target_context_type = body.target_context_type ?? "standalone";
  const draft_mode: Phase6DraftModeFilter = (body.draft_mode ?? "both") as Phase6DraftModeFilter;
  const pricing_mode = body.pricing_mode ?? "quantity_only";
  // Phase 6 default: preview_only — live handoff intentionally blocked.
  const catalog_mode = body.catalog_mode ?? "preview_only";
  if (catalog_mode === "user_approved_custom_lines") {
    return jsonErr(c, "phase_6_custom_line_disabled", PHASE_6_DISABLED_MESSAGES.custom_line, 400);
  }
  const custom_line_mode = "disabled" as const;

  const svc = serviceClient();

  // Validate session.
  const { data: session } = await svc.from("blueprint_import_sessions")
    .select("id,tenant_id,status").eq("id", session_id).eq("tenant_id", tenantId).maybeSingle();
  if (!session) return jsonErr(c, "not_found", "session not found", 404);
  if (session.status === "superseded" || session.status === "cancelled") {
    return jsonErr(c, "stale_import_session", `session is ${session.status}`, 409);
  }

  // Validate target enhanced_estimates if supplied (read-only).
  if (body.canonical_estimate_target_id) {
    const { data: targetEst } = await svc.from("enhanced_estimates")
      .select("id,tenant_id,status").eq("id", body.canonical_estimate_target_id).maybeSingle();
    if (!targetEst) return jsonErr(c, "target_estimate_missing", "enhanced_estimates target not found", 404);
    if (targetEst.tenant_id !== tenantId) return jsonErr(c, "target_estimate_tenant_mismatch", "cross-tenant target", 403);
  }

  // Load context.
  const [{ data: accepted }, { data: bindings }, { data: materials }, { data: labor }, { data: planPaths }, { data: flags }, { data: sourceDocs }] = await Promise.all([
    svc.from("blueprint_accepted_trades").select("id,trade_id,user_assumptions").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_template_bindings").select("id,accepted_trade_id,template_version,binding_status,user_assumptions").eq("import_session_id", session_id).eq("tenant_id", tenantId).neq("binding_status", "superseded"),
    svc.from("blueprint_material_draft_lines").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId).neq("status", "superseded"),
    svc.from("blueprint_labor_draft_lines").select("*").eq("import_session_id", session_id).eq("tenant_id", tenantId).neq("status", "superseded"),
    svc.from("blueprint_plan_paths").select("id,source_document_id").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_review_flags").select("id,flag_code,severity,blocking,resolved,related_entity_type,related_entity_id").eq("import_session_id", session_id).eq("tenant_id", tenantId),
    svc.from("blueprint_source_documents").select("id,document_type").eq("import_session_id", session_id).eq("tenant_id", tenantId),
  ]);

  const paintSourcePresent = (sourceDocs ?? []).some((d: any) => d.document_type === "wall_report")
    || (accepted ?? []).some((a: any) => a.trade_id === "exterior_walls_siding");

  // Deterministic batch key (idempotency).
  const deterministic_batch_key = await buildHandoffBatchKey({
    tenant_id: tenantId,
    import_session_id: session_id,
    target_context_type,
    target_context_id: body.target_context_id ?? null,
    canonical_estimate_target_id: body.canonical_estimate_target_id ?? null,
    pricing_mode,
    catalog_mode,
    custom_line_mode,
  });

  // Upsert batch (supersede prior preview batches with a different key for same session).
  const { data: existingBatch } = await svc.from("blueprint_estimate_handoff_batches")
    .select("id,status").eq("tenant_id", tenantId).eq("deterministic_batch_key", deterministic_batch_key).maybeSingle();

  let batchId: string;
  if (existingBatch) {
    batchId = existingBatch.id;
  } else {
    // Mark prior non-terminal preview batches as superseded for the same session.
    await svc.from("blueprint_estimate_handoff_batches")
      .update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("import_session_id", session_id)
      .in("status", ["draft", "preview_requested", "preview_created", "user_review_required"]);
    const { data: created, error: cErr } = await svc.from("blueprint_estimate_handoff_batches").insert({
      tenant_id: tenantId,
      import_session_id: session_id,
      target_context_type,
      target_context_id: body.target_context_id ?? null,
      canonical_estimate_target_table: "enhanced_estimates",
      canonical_estimate_target_id: body.canonical_estimate_target_id ?? null,
      status: "preview_requested",
      pricing_mode,
      catalog_mode,
      custom_line_mode,
      created_by: userId,
      deterministic_batch_key,
      metadata: { ui_origin: "blueprint_importer_v2", phase: 6 },
    }).select("id").single();
    if (cErr) return jsonErr(c, "batch_insert_failed", cErr.message, 500);
    batchId = created!.id;
  }

  // Build candidates.
  const preview = await buildHandoffPreview({
    tenant_id: tenantId,
    import_session_id: session_id,
    handoff_batch_id: batchId,
    accepted_trades: (accepted ?? []) as any,
    template_bindings: (bindings ?? []) as any,
    material_drafts: (materials ?? []) as any,
    labor_drafts: (labor ?? []) as any,
    plan_paths: (planPaths ?? []) as any,
    review_flags: (flags ?? []) as any,
    allowed_accepted_trade_ids: body.accepted_trade_ids ?? null,
    draft_mode,
    catalog_mode,
    custom_line_mode,
    pricing_mode,
    paint_source_present: paintSourcePresent,
  });

  // Upsert candidates by deterministic_handoff_key.
  if (preview.candidates.length > 0) {
    const { error: upErr } = await svc.from("blueprint_estimate_line_candidates")
      .upsert(preview.candidates as any, { onConflict: "tenant_id,deterministic_handoff_key" });
    if (upErr) return jsonErr(c, "candidate_upsert_failed", upErr.message, 500);
  }

  // Update batch status verdict.
  await svc.from("blueprint_estimate_handoff_batches")
    .update({ status: preview.batch_status, updated_at: new Date().toISOString() })
    .eq("id", batchId).eq("tenant_id", tenantId);

  return jsonOk(c, {
    handoff_batch_id: batchId,
    deterministic_batch_key,
    batch_status: preview.batch_status,
    total_candidates: preview.total_candidates,
    candidates_handoff_allowed: preview.candidates_handoff_allowed,
    skipped: preview.skipped,
    blocker_summary: preview.blocker_summary,
    warning_summary: preview.warning_summary,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_6_DISABLED_MESSAGES.push_to_estimate,
  });
});

// ---- POST /blueprint-importer/v2/handoff-preview/get ----
app.post("/blueprint-importer/v2/handoff-preview/get", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({})) as { handoff_batch_id?: string; import_session_id?: string };
  if (!body.handoff_batch_id && !body.import_session_id) {
    return jsonErr(c, "bad_request", "handoff_batch_id or import_session_id required", 400);
  }
  const svc = serviceClient();

  let batchQuery = svc.from("blueprint_estimate_handoff_batches")
    .select("*").eq("tenant_id", tenantId);
  if (body.handoff_batch_id) batchQuery = batchQuery.eq("id", body.handoff_batch_id);
  else batchQuery = batchQuery.eq("import_session_id", body.import_session_id!).neq("status", "superseded").order("created_at", { ascending: false }).limit(1);
  const { data: batch } = await batchQuery.maybeSingle();
  if (!batch) {
    return jsonOk(c, {
      batch: null,
      candidates: [],
      target_estimate: null,
      push_to_estimate_enabled: false,
      push_to_estimate_disabled_reason: PHASE_6_DISABLED_MESSAGES.push_to_estimate,
    });
  }

  const { data: candidates } = await svc.from("blueprint_estimate_line_candidates")
    .select("*").eq("tenant_id", tenantId).eq("handoff_batch_id", batch.id).order("created_at", { ascending: true });

  let targetEstimate: { id: string; status: string | null; estimate_number: string | null; display_name: string | null } | null = null;
  if (batch.canonical_estimate_target_id) {
    const { data: t } = await svc.from("enhanced_estimates")
      .select("id,status,estimate_number,display_name")
      .eq("id", batch.canonical_estimate_target_id).eq("tenant_id", tenantId).maybeSingle();
    targetEstimate = t ?? null;
  }

  return jsonOk(c, {
    batch,
    candidates: candidates ?? [],
    target_estimate: targetEstimate,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_6_DISABLED_MESSAGES.push_to_estimate,
    disabled_actions: PHASE_6_DISABLED_MESSAGES,
  });
});

// ---- POST /blueprint-importer/v2/handoff-preview/review ----
// Preview-only candidate review changes. Does NOT enable live handoff.
app.post("/blueprint-importer/v2/handoff-preview/review", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({})) as {
    handoff_batch_id?: string;
    candidate_id?: string;
    user_review_status?: "pending" | "reviewed" | "excluded";
  };
  if (!body.handoff_batch_id || !body.candidate_id || !body.user_review_status) {
    return jsonErr(c, "bad_request", "handoff_batch_id, candidate_id, user_review_status required", 400);
  }
  // Phase 6 forbids 'approved' here — that belongs to Phase 7.
  if ((body.user_review_status as string) === "approved") {
    return jsonErr(c, "phase_6_user_approval_disabled",
      "Per-line user approval is not enabled in Phase 6 — Phase 7 owns the live-handoff approval gate.", 400);
  }
  const svc = serviceClient();
  const { data: cand } = await svc.from("blueprint_estimate_line_candidates")
    .select("id,tenant_id,handoff_batch_id").eq("id", body.candidate_id).eq("tenant_id", tenantId).maybeSingle();
  if (!cand) return jsonErr(c, "not_found", "candidate not found", 404);
  if (cand.handoff_batch_id !== body.handoff_batch_id) {
    return jsonErr(c, "candidate_batch_mismatch", "candidate does not belong to batch", 400);
  }
  const { error } = await svc.from("blueprint_estimate_line_candidates")
    .update({ user_review_status: body.user_review_status, updated_at: new Date().toISOString() })
    .eq("id", body.candidate_id).eq("tenant_id", tenantId);
  if (error) return jsonErr(c, "candidate_update_failed", error.message, 500);
  return jsonOk(c, { ok: true, candidate_id: body.candidate_id, user_review_status: body.user_review_status });
});

// =============================================================================
// Blueprint Importer v2 — Phase 7.6b deterministic resolver runtime routes.
// Reads blueprint_estimate_line_candidates + blueprint_catalog_bindings.
// Writes blueprint_estimate_line_candidates + blueprint_review_flags ONLY.
// Does NOT write: estimate_line_items, enhanced_estimates, proposal_tier_items,
// proposal/work order/purchase order/production/invoice tables,
// product_catalog, labor_rates, supplier_catalog_items, abc_catalog_items,
// material_item_match_rules. Push to Estimate remains disabled.
// See docs/blueprint-importer-phase-7-6b-binding-resolver-runtime.md.
// =============================================================================

const PHASE_7_6B_PUSH_DISABLED_REASON =
  "Push to Estimate remains disabled. Phase 7.6b only resolves preview candidates to approved blueprint catalog bindings; pricing preflight and live handoff are not enabled.";

interface ResolveBindingsBody {
  handoff_batch_id?: string;
  candidate_ids?: string[] | null;
  resolver_mode?: "blueprint_catalog_bindings_only";
  dry_run?: boolean;
  contract_version?: string;
}

app.post("/blueprint-importer/v2/resolve-bindings", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = (await c.req.json().catch(() => ({}))) as ResolveBindingsBody;
  if (!body.handoff_batch_id) {
    return jsonErr(c, "bad_request", "handoff_batch_id required", 400);
  }
  const resolverMode = body.resolver_mode ?? "blueprint_catalog_bindings_only";
  if (resolverMode !== "blueprint_catalog_bindings_only") {
    return jsonErr(c, "resolver_mode_unsupported",
      "Only blueprint_catalog_bindings_only is supported in Phase 7.6b", 400);
  }
  const dryRun = body.dry_run === true;
  const svc = serviceClient();

  // Validate batch belongs to tenant.
  const { data: batch, error: batchErr } = await svc
    .from("blueprint_estimate_handoff_batches")
    .select("id,tenant_id,import_session_id,status,catalog_mode,custom_line_mode,pricing_mode,deterministic_batch_key,source_draft_hash,metadata")
    .eq("id", body.handoff_batch_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (batchErr) return jsonErr(c, "batch_lookup_failed", batchErr.message, 500);
  if (!batch) return jsonErr(c, "batch_not_found", "handoff batch not found", 404);
  if (batch.status === "live_written" || batch.status === "superseded" || batch.status === "cancelled") {
    return jsonErr(c, "batch_terminal", `batch is ${batch.status}`, 409);
  }

  // Load candidates (tenant + batch scoped).
  let candidatesQuery = svc.from("blueprint_estimate_line_candidates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("handoff_batch_id", batch.id);
  if (body.candidate_ids && body.candidate_ids.length > 0) {
    candidatesQuery = candidatesQuery.in("id", body.candidate_ids);
  }
  const { data: candRows, error: candErr } = await candidatesQuery;
  if (candErr) return jsonErr(c, "candidate_lookup_failed", candErr.message, 500);
  const candidates = (candRows ?? []) as unknown as ResolverCandidate[];

  // Load tenant-scoped active+inactive bindings — pass to pure matcher.
  const { data: bindingRows, error: bindErr } = await svc
    .from("blueprint_catalog_bindings")
    .select("*")
    .eq("tenant_id", tenantId);
  if (bindErr) return jsonErr(c, "binding_lookup_failed", bindErr.message, 500);
  const bindings = (bindingRows ?? []) as unknown as BlueprintCatalogBinding[];

  const now = new Date().toISOString();
  const results: ResolverV2RuntimeResult[] = [];
  const updates: Array<{ id: string; payload: ReturnType<typeof buildCandidateUpdate> }> = [];
  const allFlagSpecs: Array<{ candidate_id: string; specs: ReturnType<typeof buildReviewFlagSpecs> }> = [];

  for (const cand of candidates) {
    const result = resolveCandidateAgainstBindings(cand, bindings, { now: () => now });
    results.push(result);
    updates.push({ id: cand.id, payload: buildCandidateUpdate(cand, result, now) });
    allFlagSpecs.push({ candidate_id: cand.id, specs: buildReviewFlagSpecs(cand, result) });
  }

  if (!dryRun) {
    // Replace resolver-owned flags per candidate (idempotent: delete-then-insert
    // scoped by metadata.source = 'resolver_v2' AND metadata.line_candidate_id).
    for (const { candidate_id, specs } of allFlagSpecs) {
      // Delete prior resolver-owned flags for this candidate.
      await svc.from("blueprint_review_flags")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("import_session_id", batch.import_session_id)
        .filter("metadata->>source", "eq", "resolver_v2")
        .filter("metadata->>line_candidate_id", "eq", candidate_id);
      if (specs.length === 0) continue;
      const { error: insErr } = await svc.from("blueprint_review_flags")
        .insert(specs);
      if (insErr) return jsonErr(c, "review_flag_insert_failed", insErr.message, 500);
    }

    // Refresh blocking/warning flag id arrays per candidate (resolver-owned only,
    // unioned with prior phase 6 flag ids that remain).
    for (const upd of updates) {
      const cand = candidates.find((c) => c.id === upd.id)!;
      const { data: ownedFlags } = await svc.from("blueprint_review_flags")
        .select("id,blocking")
        .eq("tenant_id", tenantId)
        .eq("import_session_id", batch.import_session_id)
        .filter("metadata->>source", "eq", "resolver_v2")
        .filter("metadata->>line_candidate_id", "eq", cand.id);
      const ownedBlocking = (ownedFlags ?? []).filter((f: any) => f.blocking).map((f: any) => f.id as string);
      const ownedWarning = (ownedFlags ?? []).filter((f: any) => !f.blocking).map((f: any) => f.id as string);

      const priorBlocking = Array.isArray(cand.blocking_review_flag_ids)
        ? (cand.blocking_review_flag_ids as string[]) : [];
      const priorWarning = Array.isArray(cand.warning_review_flag_ids)
        ? (cand.warning_review_flag_ids as string[]) : [];

      // Drop any stale resolver_v2 flag ids that no longer exist from prior arrays
      // by keeping only ids that match either (a) the new owned sets, or (b) IDs
      // not owned by resolver_v2 (kept verbatim). We don't have a 1:1 map of all
      // existing prior IDs to source, so we keep prior ids that aren't superseded
      // by name collision; the array is informational and bounded by candidate.
      const blockingMerged = Array.from(new Set([
        ...priorBlocking.filter((id) => !ownedBlocking.includes(id)),
        ...ownedBlocking,
      ]));
      const warningMerged = Array.from(new Set([
        ...priorWarning.filter((id) => !ownedWarning.includes(id)),
        ...ownedWarning,
      ]));

      const updatePayload = {
        ...upd.payload,
        blocking_review_flag_ids: blockingMerged,
        warning_review_flag_ids: warningMerged,
      };
      const { error: updErr } = await svc.from("blueprint_estimate_line_candidates")
        .update(updatePayload as any)
        .eq("id", upd.id)
        .eq("tenant_id", tenantId)
        .eq("handoff_batch_id", batch.id);
      if (updErr) return jsonErr(c, "candidate_update_failed", updErr.message, 500);
    }

    // Update batch status verdict (preview lifecycle, never live).
    const anyBlocked = results.some((r) => r.blockers.length > 0);
    const nextStatus = anyBlocked ? "user_review_required" : "preview_created";
    await svc.from("blueprint_estimate_handoff_batches")
      .update({
        status: nextStatus,
        updated_at: now,
        metadata: {
          ...(batch.metadata ?? {}),
          phase_7_6b_resolver_run_at: now,
          phase_7_6b_resolver_version: PHASE_7_6B_RESOLVER_VERSION,
        },
      })
      .eq("id", batch.id)
      .eq("tenant_id", tenantId);
  }

  const summary = summarizeResolverResults(results);

  return jsonOk(c, {
    handoff_batch_id: batch.id,
    resolver_mode: resolverMode,
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    contract_version: body.contract_version ?? "blueprint-importer-v2",
    dry_run: dryRun,
    total_candidates: candidates.length,
    summary,
    results,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_7_6B_PUSH_DISABLED_REASON,
    pricing_preflight_enabled: false,
    pricing_preflight_disabled_reason:
      "Pricing preflight is not enabled in Phase 7.6b. Resolver only verifies catalog binding existence/validity.",
  });
});

// ---- POST /blueprint-importer/v2/resolve-bindings/get ----
// (POST keeps parity with other v2 reads; Hono param routes are intentionally
// avoided to mirror existing handoff-preview/get style.)
app.post("/blueprint-importer/v2/resolve-bindings/get", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = (await c.req.json().catch(() => ({}))) as { handoff_batch_id?: string; candidate_ids?: string[] };
  if (!body.handoff_batch_id) return jsonErr(c, "bad_request", "handoff_batch_id required", 400);
  const svc = serviceClient();
  const { data: batch } = await svc.from("blueprint_estimate_handoff_batches")
    .select("id,tenant_id,import_session_id,status,catalog_mode,pricing_mode,custom_line_mode,metadata,updated_at")
    .eq("id", body.handoff_batch_id).eq("tenant_id", tenantId).maybeSingle();
  if (!batch) return jsonErr(c, "batch_not_found", "handoff batch not found", 404);

  let q = svc.from("blueprint_estimate_line_candidates")
    .select("id,source_draft_line_id,source_draft_line_type,trade_id,item_key,item_name,quantity,unit,catalog_resolution_status,catalog_item_id,pricing_status,cost_status,handoff_allowed,handoff_blockers,status,metadata,blocking_review_flag_ids,warning_review_flag_ids,deterministic_handoff_key,updated_at")
    .eq("tenant_id", tenantId).eq("handoff_batch_id", batch.id);
  if (body.candidate_ids && body.candidate_ids.length > 0) q = q.in("id", body.candidate_ids);
  const { data: cands } = await q;

  const candidates = (cands ?? []) as any[];
  const resolverResults = candidates
    .map((c) => (c.metadata?.resolver_v2_result as ResolverV2RuntimeResult | undefined))
    .filter((r): r is ResolverV2RuntimeResult => !!r);
  const summary = resolverResults.length > 0 ? summarizeResolverResults(resolverResults) : null;

  return jsonOk(c, {
    handoff_batch_id: batch.id,
    batch,
    resolver_version: PHASE_7_6B_RESOLVER_VERSION,
    candidates,
    summary,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_7_6B_PUSH_DISABLED_REASON,
  });
});

// ===========================================================================
// Phase 7.6c — Pricing preflight (preview-only).
// NO live writes. NO catalog/labor mutation. NO Push to Estimate.
// ===========================================================================

const PHASE_7_6C_PUSH_DISABLED_REASON =
  "Push to Estimate remains disabled. Phase 7.6c only validates pricing readiness for preview candidates; live handoff and final customer pricing are not enabled.";

interface PricingPreflightBody {
  handoff_batch_id?: string;
  candidate_ids?: string[] | null;
  pricing_mode?: "quantity_only" | "ready_for_pricing_review";
  catalog_mode?: string;
  contract_version?: string;
  dry_run?: boolean;
}

async function loadTargetForBinding(
  svc: ReturnType<typeof serviceClient>,
  tenantId: string,
  binding: BlueprintCatalogBinding,
): Promise<TargetRowSnapshot | null> {
  switch (binding.target_kind) {
    case "product_catalog": {
      if (!binding.target_item_id) return null;
      const { data } = await svc.from("product_catalog")
        .select("id,tenant_id,is_active,price_per_square")
        .eq("id", binding.target_item_id).maybeSingle();
      if (!data) {
        return { table: "product_catalog", id: null, tenant_id: null, tenant_scoped: true, is_active: null, active_status_verifiable: true, base_unit_cost: null, target_unit: "square", base_rate_per_hour: null };
      }
      return {
        table: "product_catalog",
        id: (data as any).id,
        tenant_id: (data as any).tenant_id,
        tenant_scoped: true,
        is_active: (data as any).is_active,
        active_status_verifiable: true,
        base_unit_cost: typeof (data as any).price_per_square === "number" ? (data as any).price_per_square : null,
        target_unit: "square",
        base_rate_per_hour: null,
      };
    }
    case "supplier_catalog_item": {
      if (!binding.target_item_id) return null;
      const { data } = await svc.from("supplier_catalog_items")
        .select("id,catalog_id,active,base_price,uom")
        .eq("id", binding.target_item_id).maybeSingle();
      if (!data) {
        return { table: "supplier_catalog_items", id: null, tenant_id: null, tenant_scoped: false, is_active: null, active_status_verifiable: true, base_unit_cost: null, target_unit: null, base_rate_per_hour: null };
      }
      return {
        table: "supplier_catalog_items",
        id: (data as any).id,
        tenant_id: null, // tenant-scoping is via supplier_catalogs join (not enforced here — out of scope)
        tenant_scoped: false,
        is_active: (data as any).active,
        active_status_verifiable: true,
        base_unit_cost: typeof (data as any).base_price === "number" ? (data as any).base_price : null,
        target_unit: (data as any).uom ?? null,
        base_rate_per_hour: null,
      };
    }
    case "abc_catalog_item": {
      if (!binding.target_abc_item_number) return null;
      const { data } = await svc.from("abc_catalog_items")
        .select("item_number,is_active,costing_uom")
        .eq("item_number", binding.target_abc_item_number).maybeSingle();
      if (!data) {
        return { table: "abc_catalog_items", id: null, abc_item_number: null, tenant_id: null, tenant_scoped: false, is_active: null, active_status_verifiable: true, base_unit_cost: null, target_unit: null, base_rate_per_hour: null };
      }
      return {
        table: "abc_catalog_items",
        id: null,
        abc_item_number: (data as any).item_number,
        tenant_id: null,
        tenant_scoped: false,
        is_active: (data as any).is_active,
        active_status_verifiable: true,
        // ABC pricing lives in webhook-fetched price rows, NOT directly on abc_catalog_items.
        // Phase 7.6c treats ABC base cost as unverified — relies on binding.unit_cost.
        base_unit_cost: null,
        target_unit: (data as any).costing_uom ?? null,
        base_rate_per_hour: null,
      };
    }
    case "labor_rate": {
      if (!binding.labor_rate_id) return null;
      const { data } = await svc.from("labor_rates")
        .select("id,tenant_id,is_active,base_rate_per_hour")
        .eq("id", binding.labor_rate_id).maybeSingle();
      if (!data) {
        return { table: "labor_rates", id: null, tenant_id: null, tenant_scoped: true, is_active: null, active_status_verifiable: true, base_unit_cost: null, target_unit: "hr", base_rate_per_hour: null };
      }
      return {
        table: "labor_rates",
        id: (data as any).id,
        tenant_id: (data as any).tenant_id,
        tenant_scoped: true,
        is_active: (data as any).is_active,
        active_status_verifiable: true,
        base_unit_cost: null,
        target_unit: "hr",
        base_rate_per_hour: typeof (data as any).base_rate_per_hour === "number" ? (data as any).base_rate_per_hour : null,
      };
    }
    default:
      return null;
  }
}

app.post("/blueprint-importer/v2/pricing-preflight", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = (await c.req.json().catch(() => ({}))) as PricingPreflightBody;
  if (!body.handoff_batch_id) return jsonErr(c, "bad_request", "handoff_batch_id required", 400);
  const dryRun = body.dry_run === true;
  const svc = serviceClient();

  const { data: batch, error: batchErr } = await svc.from("blueprint_estimate_handoff_batches")
    .select("id,tenant_id,import_session_id,status,catalog_mode,pricing_mode,custom_line_mode,metadata,source_draft_hash")
    .eq("id", body.handoff_batch_id).eq("tenant_id", tenantId).maybeSingle();
  if (batchErr) return jsonErr(c, "batch_lookup_failed", batchErr.message, 500);
  if (!batch) return jsonErr(c, "batch_not_found", "handoff batch not found", 404);
  if (["live_written", "superseded", "cancelled"].includes(batch.status)) {
    return jsonErr(c, "batch_terminal", `batch is ${batch.status}`, 409);
  }

  const pricingMode = body.pricing_mode ?? (batch.pricing_mode as string) ?? "quantity_only";
  const contractVersion = body.contract_version ?? "blueprint-importer-v2";

  let candQ = svc.from("blueprint_estimate_line_candidates")
    .select("*")
    .eq("tenant_id", tenantId).eq("handoff_batch_id", batch.id);
  if (body.candidate_ids && body.candidate_ids.length > 0) candQ = candQ.in("id", body.candidate_ids);
  const { data: candRows, error: candErr } = await candQ;
  if (candErr) return jsonErr(c, "candidate_lookup_failed", candErr.message, 500);
  const candidates = (candRows ?? []) as any[];

  // Cache bindings by id (resolver_v2_result already references binding ids).
  const bindingIds = Array.from(new Set(candidates
    .map((c) => (c.metadata?.resolver_v2_result?.matched_binding_id as string | null))
    .filter((x): x is string => !!x)));
  const bindingMap = new Map<string, BlueprintCatalogBinding>();
  if (bindingIds.length > 0) {
    const { data: bRows, error: bErr } = await svc.from("blueprint_catalog_bindings")
      .select("*").eq("tenant_id", tenantId).in("id", bindingIds);
    if (bErr) return jsonErr(c, "binding_lookup_failed", bErr.message, 500);
    for (const b of (bRows ?? []) as unknown as BlueprintCatalogBinding[]) bindingMap.set(b.id, b);
  }

  const now = new Date().toISOString();
  const results: PreflightCandidateResult[] = [];
  const updates: Array<{ id: string; payload: ReturnType<typeof buildPreflightCandidateUpdate> }> = [];
  const flagSpecs: Array<{ candidate_id: string; specs: ReturnType<typeof buildPreflightReviewFlagSpecs> }> = [];

  for (const cand of candidates) {
    const resolver = (cand.metadata?.resolver_v2_result as PreflightCandidateInput["resolver_result"]) ?? null;
    const binding = resolver?.matched_binding_id ? bindingMap.get(resolver.matched_binding_id) ?? null : null;
    const target = binding ? await loadTargetForBinding(svc, tenantId, binding) : null;
    const input: PreflightCandidateInput = {
      id: cand.id,
      tenant_id: cand.tenant_id,
      handoff_batch_id: cand.handoff_batch_id,
      import_session_id: cand.import_session_id,
      source_draft_line_id: cand.source_draft_line_id,
      source_draft_line_type: cand.source_draft_line_type,
      trade_id: cand.trade_id,
      item_key: cand.item_key,
      quantity: cand.quantity,
      unit: cand.unit,
      deterministic_handoff_key: cand.deterministic_handoff_key,
      resolver_result: resolver,
      metadata: cand.metadata,
    };
    const result = evaluatePricingPreflight(input, binding, target, {
      pricing_mode: pricingMode, pricing_contract_version: contractVersion, now: () => now,
    });
    results.push(result);
    updates.push({ id: cand.id, payload: buildPreflightCandidateUpdate(input, result, cand.status) });
    flagSpecs.push({ candidate_id: cand.id, specs: buildPreflightReviewFlagSpecs(input, result) });
  }

  if (!dryRun) {
    for (const { candidate_id, specs } of flagSpecs) {
      await svc.from("blueprint_review_flags")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("import_session_id", batch.import_session_id)
        .filter("metadata->>source", "eq", "pricing_preflight_v2")
        .filter("metadata->>line_candidate_id", "eq", candidate_id);
      if (specs.length === 0) continue;
      const { error: insErr } = await svc.from("blueprint_review_flags").insert(specs);
      if (insErr) return jsonErr(c, "review_flag_insert_failed", insErr.message, 500);
    }
    for (const upd of updates) {
      // Force handoff_allowed=false; preserve resolver/source/quantity by ONLY
      // updating the allowed columns (metadata merge is handled in payload).
      const { error: updErr } = await svc.from("blueprint_estimate_line_candidates")
        .update(upd.payload as any)
        .eq("id", upd.id).eq("tenant_id", tenantId).eq("handoff_batch_id", batch.id);
      if (updErr) return jsonErr(c, "candidate_update_failed", updErr.message, 500);
    }
    await svc.from("blueprint_estimate_handoff_batches")
      .update({
        updated_at: now,
        metadata: {
          ...(batch.metadata ?? {}),
          phase_7_6c_preflight_run_at: now,
          phase_7_6c_preflight_version: PHASE_7_6C_PREFLIGHT_VERSION,
          phase_7_6c_pricing_mode: pricingMode,
        },
      }).eq("id", batch.id).eq("tenant_id", tenantId);
  }

  const summary = summarizePreflightResults(results);
  return jsonOk(c, {
    handoff_batch_id: batch.id,
    preflight_version: PHASE_7_6C_PREFLIGHT_VERSION,
    contract_version: contractVersion,
    pricing_mode: pricingMode,
    dry_run: dryRun,
    total_candidates: candidates.length,
    summary,
    results,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_7_6C_PUSH_DISABLED_REASON,
    final_pricing_enabled: false,
    final_pricing_disabled_reason: "Final customer-facing pricing is intentionally disabled in Phase 7.6c.",
  });
});

app.post("/blueprint-importer/v2/pricing-preflight/get", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = (await c.req.json().catch(() => ({}))) as { handoff_batch_id?: string; candidate_ids?: string[] };
  if (!body.handoff_batch_id) return jsonErr(c, "bad_request", "handoff_batch_id required", 400);
  const svc = serviceClient();
  const { data: batch } = await svc.from("blueprint_estimate_handoff_batches")
    .select("id,tenant_id,import_session_id,status,pricing_mode,metadata,updated_at")
    .eq("id", body.handoff_batch_id).eq("tenant_id", tenantId).maybeSingle();
  if (!batch) return jsonErr(c, "batch_not_found", "handoff batch not found", 404);
  let q = svc.from("blueprint_estimate_line_candidates")
    .select("id,source_draft_line_id,source_draft_line_type,trade_id,item_key,quantity,unit,catalog_resolution_status,pricing_status,cost_status,handoff_allowed,handoff_blockers,status,metadata,deterministic_handoff_key,updated_at")
    .eq("tenant_id", tenantId).eq("handoff_batch_id", batch.id);
  if (body.candidate_ids && body.candidate_ids.length > 0) q = q.in("id", body.candidate_ids);
  const { data: cands } = await q;
  const candidates = (cands ?? []) as any[];
  const preflightResults = candidates
    .map((c) => (c.metadata?.pricing_preflight as PreflightCandidateResult | undefined))
    .filter((r): r is PreflightCandidateResult => !!r);
  const summary = preflightResults.length > 0 ? summarizePreflightResults(preflightResults) : null;
  return jsonOk(c, {
    handoff_batch_id: batch.id,
    batch,
    preflight_version: PHASE_7_6C_PREFLIGHT_VERSION,
    candidates,
    summary,
    push_to_estimate_enabled: false,
    push_to_estimate_disabled_reason: PHASE_7_6C_PUSH_DISABLED_REASON,
    final_pricing_enabled: false,
  });
});

// =============================================================================
// Trade Quote Workbench Completion Phase — additive routes only.
// Bridges from plan_documents → blueprint import session, supports manual
// measurement entry, and provides a by-document workbench lookup. These
// routes MUST NOT write to estimate_line_items, enhanced_estimates,
// proposal_*, work_order_*, purchase_order_*, project_cost_invoice_*, or
// production_* tables.
// =============================================================================

// ---- POST /blueprint-importer/v2/import-from-plan-document ------------------
// Idempotent: returns existing session for (tenant_id, source_context_type=
// 'standalone', source_context_id=plan_document_id) when present. Otherwise
// loads the plan_documents row, fetches the file from the "blueprints" bucket,
// classifies, parses (Roofr/EagleView roof/EagleView wall), and persists
// session + source_document + plan_paths + measurements + detected_trades.
// Falls back to a blueprint_set session with manual_measurement_required when
// no MVP parser matches or the PDF has no selectable text.
app.post("/blueprint-importer/v2/import-from-plan-document", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = (await c.req.json().catch(() => ({}))) as { plan_document_id?: string };
  if (!body.plan_document_id) return jsonErr(c, "bad_request", "plan_document_id required", 400);
  const svc = serviceClient();

  const { data: pd, error: pdErr } = await svc.from("plan_documents")
    .select("id, tenant_id, file_path, file_name, page_count, property_address")
    .eq("id", body.plan_document_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (pdErr || !pd) return jsonErr(c, "not_found", "plan_document not found in tenant", 404);

  const { data: existing } = await svc.from("blueprint_import_sessions")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("source_context_type", "standalone")
    .eq("source_context_id", pd.id)
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return jsonOk(c, { session_id: existing.id, plan_document_id: pd.id, reused: true });
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadStorageObject(svc, "blueprints", pd.file_path);
  } catch (e) {
    return jsonErr(c, "fetch_failed", e instanceof Error ? e.message : String(e), 500);
  }

  const pdfText = await extractPdfText(bytes);

  // Create a manual-mode blueprint_set session when no selectable text or no MVP parser match.
  const createManualBlueprintSession = async (reason: string, classifier: unknown, pageCount: number | null) => {
    const { data: session, error: sErr } = await svc.from("blueprint_import_sessions").insert({
      tenant_id: tenantId,
      source_context_type: "standalone",
      source_context_id: pd.id,
      status: "parsed",
      contract_version: "blueprint-importer-v2",
      metadata: { source_origin: "plan_document", plan_document_id: pd.id, classifier, manual_measurement_required: true, reason },
      created_by: userId,
    }).select("id").single();
    if (sErr || !session) return jsonErr(c, "session_insert_failed", sErr?.message ?? "unknown", 500);

    await svc.from("blueprint_source_documents").insert({
      import_session_id: session.id,
      tenant_id: tenantId,
      storage_path: pd.file_path,
      document_reference: pd.id,
      document_type: "blueprint_set",
      provider: "user_uploaded_blueprint",
      original_filename: pd.file_name,
      page_count: pageCount,
      property_address: pd.property_address ?? null,
      extraction_status: "skipped",
      metadata: { reason, manual_measurement_required: true, classifier },
    });

    const manualCode = (REVIEW_FLAG_CODES as Record<string, string>).MANUAL_MEASUREMENT_REQUIRED ?? "manual_measurement_required";
    await svc.from("blueprint_review_flags").insert([
      flag(session.id, tenantId, null, "import_session", "warning", manualCode, "Deterministic takeoff is not available for this document. Use manual measurement entry to populate the trades you want to quote.", false),
    ]);

    return jsonOk(c, { session_id: session.id, plan_document_id: pd.id, reused: false, manual_measurement_required: true, reason });
  };

  if (!pdfText.has_selectable_text) {
    return createManualBlueprintSession("no_selectable_text", null, pd.page_count ?? null);
  }

  const cls = classifyBlueprintDocument(pdfText.full_text);

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
    return createManualBlueprintSession("no_mvp_parser_match", cls, pdfText.page_count);
  }

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

  const { data: session, error: sErr } = await svc.from("blueprint_import_sessions").insert({
    tenant_id: tenantId,
    source_context_type: "standalone",
    source_context_id: pd.id,
    status: "parsed",
    contract_version: "blueprint-importer-v2",
    deterministic_hash: dHash,
    metadata: { source_origin: "plan_document", plan_document_id: pd.id, classifier: cls, parser: winner.parser, supersedes: prior?.id ?? null },
    created_by: userId,
  }).select("id").single();
  if (sErr || !session) return jsonErr(c, "session_insert_failed", sErr?.message ?? "unknown", 500);
  const sessionId = session.id as string;

  const { data: srcDoc, error: dErr } = await svc.from("blueprint_source_documents").insert({
    import_session_id: sessionId,
    tenant_id: tenantId,
    storage_path: pd.file_path,
    document_reference: pd.id,
    document_type: cls.db_document_type,
    provider: cls.db_provider,
    original_filename: pd.file_name,
    page_count: pdfText.page_count,
    property_address: pd.property_address ?? null,
    extraction_status: "succeeded",
    metadata: {
      missing_fields: winner.missing_fields,
      field_confidences: winner.field_confidences,
      overall_confidence: winner.confidence,
    },
  }).select("id").single();
  if (dErr || !srcDoc) return jsonErr(c, "source_doc_insert_failed", dErr?.message ?? "unknown", 500);
  const srcDocId = srcDoc.id as string;

  const mapCtx = { document_type: cls.db_document_type as "roof_report" | "wall_report", provider: cls.db_provider, file_name: pd.file_name };
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
    metadata: { ...(m.measurement.metadata ?? {}), measurement_source: "report_extraction" },
  }));
  if (moRows.length) {
    const { error } = await svc.from("blueprint_measurement_objects").insert(moRows);
    if (error) return jsonErr(c, "measurement_insert_failed", error.message, 500);
  }

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

  await svc.from("blueprint_import_sessions").update({
    status: "trades_detected",
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).eq("tenant_id", tenantId);

  return jsonOk(c, {
    session_id: sessionId,
    plan_document_id: pd.id,
    reused: false,
    classifier: cls,
    parser: winner.parser,
    measurement_count: moRows.length,
    detected_trade_count: detected.length,
  });
});

// ---- POST /blueprint-importer/v2/measurements/upsert-manual ----------------
// Manual measurement entry for blueprint sheets where deterministic takeoff is
// not available. PlanPath is always written (provenance is mandatory). The
// measurement is tagged metadata.measurement_source='user_manual' so the UI
// can render a "Manual" badge and downstream draft generation can distinguish
// user-entered from report-extracted values.
interface ManualMeasurementBody {
  session_id: string;
  trade_id: string;
  measurement_key: string;
  measurement_group: string;
  quantity: number | null;
  unit: string;
  page_number?: number | null;
  section_label?: string | null;
  source_text_excerpt?: string | null;
  note?: string | null;
  source_document_id?: string | null;
  measurement_id?: string | null; // when set → update existing row
}

app.post("/blueprint-importer/v2/measurements/upsert-manual", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const body = (await c.req.json().catch(() => ({}))) as ManualMeasurementBody;
  if (!body?.session_id || !body?.trade_id || !body?.measurement_key || !body?.unit) {
    return jsonErr(c, "bad_request", "session_id, trade_id, measurement_key, unit required", 400);
  }
  const svc = serviceClient();

  const { data: session } = await svc.from("blueprint_import_sessions")
    .select("id").eq("id", body.session_id).eq("tenant_id", tenantId).maybeSingle();
  if (!session) return jsonErr(c, "not_found", "session not found", 404);

  let srcDocId: string | null = body.source_document_id ?? null;
  if (!srcDocId) {
    const { data: sd } = await svc.from("blueprint_source_documents")
      .select("id").eq("import_session_id", body.session_id).eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    srcDocId = sd?.id ?? null;
  }

  const { data: pp, error: ppErr } = await svc.from("blueprint_plan_paths").insert({
    import_session_id: body.session_id,
    tenant_id: tenantId,
    source_document_id: srcDocId,
    path_type: "user_entry",
    page_number: body.page_number ?? null,
    section_label: body.section_label ?? null,
    source_text_excerpt: body.source_text_excerpt ?? body.note ?? "manual entry",
    confidence: 1.0,
  }).select("id").single();
  if (ppErr || !pp) return jsonErr(c, "plan_path_insert_failed", ppErr?.message ?? "unknown", 500);

  const meta = {
    measurement_source: "user_manual",
    created_by: userId,
    manual_note: body.note ?? null,
  };

  if (body.measurement_id) {
    const { data, error } = await svc.from("blueprint_measurement_objects").update({
      quantity: body.quantity,
      unit: body.unit,
      plan_path_id: pp.id,
      page_number: body.page_number ?? null,
      metadata: meta,
      confidence: 1.0,
    }).eq("id", body.measurement_id).eq("tenant_id", tenantId)
      .select("id").maybeSingle();
    if (error) return jsonErr(c, "measurement_update_failed", error.message, 500);
    return jsonOk(c, { measurement_id: data?.id, plan_path_id: pp.id, mode: "update" });
  }

  const { data, error } = await svc.from("blueprint_measurement_objects").insert({
    import_session_id: body.session_id,
    tenant_id: tenantId,
    source_document_id: srcDocId,
    trade_id: body.trade_id,
    measurement_key: body.measurement_key,
    measurement_group: body.measurement_group,
    quantity: body.quantity,
    unit: body.unit,
    confidence: 1.0,
    source_value_raw: body.note ?? null,
    plan_path_id: pp.id,
    page_number: body.page_number ?? null,
    metadata: meta,
  }).select("id").single();
  if (error || !data) return jsonErr(c, "measurement_insert_failed", error?.message ?? "unknown", 500);
  return jsonOk(c, { measurement_id: data.id, plan_path_id: pp.id, mode: "insert" });
});

// ---- POST /blueprint-importer/v2/workbench/by-document ---------------------
// Resolves a plan_document_id to the active (non-superseded) import session id.
// Used by BlueprintDocumentDetail's "Open Trade Quote Workbench" entry point.
app.post("/blueprint-importer/v2/workbench/by-document", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = (await c.req.json().catch(() => ({}))) as { plan_document_id?: string };
  if (!body.plan_document_id) return jsonErr(c, "bad_request", "plan_document_id required", 400);
  const svc = serviceClient();
  const { data } = await svc.from("blueprint_import_sessions")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("source_context_type", "standalone")
    .eq("source_context_id", body.plan_document_id)
    .eq("metadata->>source_origin", "plan_document")
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return jsonOk(c, { session_id: data?.id ?? null, status: data?.status ?? null });
});

serveRouter(app);





