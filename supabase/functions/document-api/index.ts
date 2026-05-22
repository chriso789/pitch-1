// document-api — routed Edge Function (Slice 2A).
// Operational document pipeline: ingest, status, extracted data, reprocess,
// approve, version history, job linking. Deterministic parsers only — no AI.
//
// Auth mode: authenticated tenant routes (requireAuth + requireTenant).
// Tenant_id is ALWAYS resolved server-side via _shared/router.ts; never trusted
// from the request body. All approve/reprocess/link actions write audit rows.
import {
  createRouter,
  jsonOk,
  jsonErr,
  requireAuth,
  requireTenant,
  serviceClient,
  serveRouter,
  type RouterEnv,
} from "../_shared/router.ts";
import type { Context } from "jsr:@hono/hono";

const app = createRouter("document-api");

app.get("/__health", (c) => jsonOk(c, { fn: "document-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Ctx = Context<RouterEnv>;
type Svc = ReturnType<typeof serviceClient>;

async function loadOwnedDocument(svc: Svc, tenantId: string, documentId: string) {
  const { data, error } = await svc
    .from("documents")
    .select(
      "id,tenant_id,file_path,filename,document_type,mime_type,project_id,pipeline_entry_id,contact_id,created_at",
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`document_lookup_failed: ${error.message}`);
  if (!data) return { doc: null as null, code: "not_found" as const };
  if (data.tenant_id && data.tenant_id !== tenantId) return { doc: null as null, code: "forbidden" as const };
  return { doc: data, code: "ok" as const };
}

async function audit(svc: Svc, row: Record<string, unknown>) {
  try {
    await svc.from("edge_function_audit").insert({
      function_name: "document-api",
      ...row,
    });
  } catch { /* swallow */ }
}

async function callWorkerParse(c: Ctx, body: Record<string, unknown>) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const auth = c.req.header("Authorization") ?? "";
  const res = await fetch(`${SUPABASE_URL}/functions/v1/document-worker/parse/roof-report`, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
      "x-route": "/parse/roof-report",
      "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "worker_parse_invalid_json", code: "worker_invalid_response" }));
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// POST /ingest/upload
//   { file_path, filename, document_type?, mime_type?, file_size?,
//     project_id?, pipeline_entry_id?, contact_id?, auto_parse? }
// Caller has already uploaded the file via tenant-safe storage path
// (`{tenant_id}/...`). This route only creates the `documents` row.
// ---------------------------------------------------------------------------
app.post("/ingest/upload", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const body = await c.req.json().catch(() => ({}));

  const file_path: string | undefined = body.file_path;
  const filename: string | undefined = body.filename;
  if (!file_path || !filename) return jsonErr(c, "bad_request", "file_path and filename required", 400);

  // Defense-in-depth: storage path MUST start with this tenant_id segment.
  const firstSeg = file_path.split("/")[0];
  if (firstSeg !== tenantId) {
    return jsonErr(c, "forbidden", "file_path must start with active tenant_id", 403);
  }

  const svc = serviceClient();
  const document_type: string = body.document_type ?? "roof_report";

  const { data: doc, error } = await svc
    .from("documents")
    .insert({
      tenant_id: tenantId,
      uploaded_by: userId,
      file_path,
      filename,
      document_type,
      mime_type: body.mime_type ?? "application/pdf",
      file_size: typeof body.file_size === "number" ? body.file_size : null,
      project_id: body.project_id ?? null,
      pipeline_entry_id: body.pipeline_entry_id ?? null,
      contact_id: body.contact_id ?? null,
    })
    .select("id,tenant_id,file_path,filename,document_type,created_at")
    .maybeSingle();

  if (error || !doc) return jsonErr(c, "ingest_failed", error?.message ?? "insert_failed", 500);

  await audit(svc, {
    route: "/ingest/upload",
    method: "POST",
    user_id: userId,
    tenant_id: tenantId,
    status: 200,
    request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event: "document_ingested", document_id: doc.id, document_type }),
  });

  let parseResult: unknown = null;
  if (body.auto_parse !== false && document_type === "roof_report") {
    const r = await callWorkerParse(c, { document_id: doc.id });
    parseResult = { status: r.status, response: r.json };
  }

  return jsonOk(c, { document: doc, parse: parseResult });
});

// ---------------------------------------------------------------------------
// POST /documents/status            { document_id }
// POST /documents/extracted-data    { document_id }
// POST /documents/versions          { document_id }
// POST /documents/reprocess         { document_id }
// POST /documents/approve-extraction{ document_id, change_note? }
// POST /documents/link-to-job       { document_id, project_id?, pipeline_entry_id?, contact_id? }
//
// (path-param variants kept for direct-HTTP / shim callers)
// ---------------------------------------------------------------------------

async function statusHandler(c: Ctx, document_id: string) {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  const [{ data: latestRun }, { data: extraction }, { data: review }] = await Promise.all([
    svc.from("document_parser_runs")
      .select("id,parser_name,parser_version,parser_tier,status,confidence_score,duration_ms,missing_fields,validation_errors,error_message,created_at")
      .eq("tenant_id", tenantId).eq("document_id", document_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    svc.from("document_extractions")
      .select("id,document_type,vendor_type,parser_name,parser_version,parser_tier,overall_confidence,requires_review,approved_at,approved_by,current_version,updated_at")
      .eq("tenant_id", tenantId).eq("document_id", document_id).maybeSingle(),
    svc.from("document_review_queue")
      .select("id,reason,reason_detail,priority,status,created_at")
      .eq("tenant_id", tenantId).eq("document_id", document_id)
      .in("status", ["open", "in_review"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  let pipeline_status: "pending" | "parsing" | "parsed" | "low_confidence" | "approved" | "failed" = "pending";
  if (extraction?.approved_at) pipeline_status = "approved";
  else if (extraction && !extraction.requires_review) pipeline_status = "parsed";
  else if (extraction?.requires_review) pipeline_status = "low_confidence";
  else if (latestRun?.status === "failed") pipeline_status = "failed";
  else if (latestRun?.status === "running" || latestRun?.status === "pending") pipeline_status = "parsing";

  return jsonOk(c, {
    document: owned.doc,
    pipeline_status,
    latest_run: latestRun,
    extraction,
    review_queue: review,
  });
}

async function extractedDataHandler(c: Ctx, document_id: string) {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  const { data, error } = await svc.from("document_extractions")
    .select("id,document_type,vendor_type,parser_name,parser_version,parser_tier,extracted_json,field_confidences,overall_confidence,requires_review,approved_at,approved_by,current_version,updated_at")
    .eq("tenant_id", tenantId).eq("document_id", document_id).maybeSingle();
  if (error) return jsonErr(c, "extraction_lookup_failed", error.message, 500);
  if (!data) return jsonErr(c, "no_extraction", "Document has no extracted data yet — call /reprocess.", 404);

  return jsonOk(c, { extraction: data });
}

async function versionsHandler(c: Ctx, document_id: string) {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  const { data, error } = await svc.from("document_extraction_versions")
    .select("id,version_number,parser_run_id,parser_name,parser_version,overall_confidence,approved_by,approved_at,change_note,created_at")
    .eq("tenant_id", tenantId).eq("document_id", document_id)
    .order("version_number", { ascending: false });
  if (error) return jsonErr(c, "versions_lookup_failed", error.message, 500);
  return jsonOk(c, { versions: data ?? [] });
}

async function reprocessHandler(c: Ctx, document_id: string) {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  // If approved, the upsert in document-worker will refuse to overwrite. Surface that early.
  const { data: existing } = await svc.from("document_extractions")
    .select("approved_at").eq("document_id", document_id).maybeSingle();
  if (existing?.approved_at) {
    return jsonErr(c, "extraction_approved_locked", "Extraction has been approved; cannot reprocess without revoking approval.", 409);
  }

  const r = await callWorkerParse(c, { document_id });
  await audit(svc, {
    route: "/documents/reprocess",
    method: "POST", user_id: userId, tenant_id: tenantId,
    status: r.status, request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event: "document_reprocessed", document_id, worker_status: r.status }),
  });
  return jsonOk(c, { worker_status: r.status, worker_response: r.json });
}

async function approveExtractionHandler(c: Ctx, document_id: string, body: Record<string, unknown>) {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  const { data: extraction, error: exErr } = await svc.from("document_extractions")
    .select("*").eq("tenant_id", tenantId).eq("document_id", document_id).maybeSingle();
  if (exErr) return jsonErr(c, "extraction_lookup_failed", exErr.message, 500);
  if (!extraction) return jsonErr(c, "no_extraction", "Nothing to approve.", 404);
  if (extraction.approved_at) return jsonErr(c, "already_approved", "Extraction is already approved.", 409);

  const change_note = typeof body.change_note === "string" ? body.change_note : null;
  const now = new Date().toISOString();

  // Snapshot into versions table FIRST (immutable history), then mark current as approved.
  const { data: latestRun } = await svc.from("document_parser_runs")
    .select("id").eq("tenant_id", tenantId).eq("document_id", document_id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { error: verErr } = await svc.from("document_extraction_versions").insert({
    tenant_id: tenantId,
    document_id,
    extraction_id: extraction.id,
    version_number: extraction.current_version,
    parser_run_id: latestRun?.id ?? null,
    parser_name: extraction.parser_name,
    parser_version: extraction.parser_version,
    extracted_json: extraction.extracted_json,
    field_confidences: extraction.field_confidences,
    overall_confidence: extraction.overall_confidence,
    approved_by: userId,
    approved_at: now,
    change_note,
  });
  if (verErr) return jsonErr(c, "version_snapshot_failed", verErr.message, 500);

  const { error: updErr } = await svc.from("document_extractions")
    .update({ approved_by: userId, approved_at: now, requires_review: false })
    .eq("id", extraction.id);
  if (updErr) return jsonErr(c, "approve_update_failed", updErr.message, 500);

  // Resolve any open review queue items.
  await svc.from("document_review_queue")
    .update({ status: "resolved", resolved_by: userId, resolved_at: now, resolution_note: change_note ?? "approved" })
    .eq("tenant_id", tenantId).eq("document_id", document_id).in("status", ["open", "in_review"]);

  await audit(svc, {
    route: "/documents/approve-extraction",
    method: "POST", user_id: userId, tenant_id: tenantId,
    status: 200, request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event: "extraction_approved", document_id, extraction_id: extraction.id, version_number: extraction.current_version }),
  });

  return jsonOk(c, { extraction_id: extraction.id, approved_at: now, version_number: extraction.current_version });
}

async function linkToJobHandler(c: Ctx, document_id: string, body: Record<string, unknown>) {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const svc = serviceClient();
  const owned = await loadOwnedDocument(svc, tenantId, document_id);
  if (owned.code === "not_found") return jsonErr(c, "not_found", "Document not found", 404);
  if (owned.code === "forbidden") return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);

  const project_id = typeof body.project_id === "string" ? body.project_id : null;
  const pipeline_entry_id = typeof body.pipeline_entry_id === "string" ? body.pipeline_entry_id : null;
  const contact_id = typeof body.contact_id === "string" ? body.contact_id : null;

  if (!project_id && !pipeline_entry_id && !contact_id) {
    return jsonErr(c, "bad_request", "Provide at least one of project_id, pipeline_entry_id, contact_id.", 400);
  }

  // Verify each linked entity belongs to the same tenant before writing.
  if (project_id) {
    const { data } = await svc.from("jobs").select("id,tenant_id").eq("id", project_id).maybeSingle();
    if (!data || (data.tenant_id && data.tenant_id !== tenantId)) {
      return jsonErr(c, "forbidden", "project_id not in tenant", 403);
    }
  }
  if (pipeline_entry_id) {
    const { data } = await svc.from("pipeline_entries").select("id,tenant_id").eq("id", pipeline_entry_id).maybeSingle();
    if (!data || (data.tenant_id && data.tenant_id !== tenantId)) {
      return jsonErr(c, "forbidden", "pipeline_entry_id not in tenant", 403);
    }
  }
  if (contact_id) {
    const { data } = await svc.from("contacts").select("id,tenant_id").eq("id", contact_id).maybeSingle();
    if (!data || (data.tenant_id && data.tenant_id !== tenantId)) {
      return jsonErr(c, "forbidden", "contact_id not in tenant", 403);
    }
  }

  const patch: Record<string, unknown> = {};
  if (project_id) patch.project_id = project_id;
  if (pipeline_entry_id) patch.pipeline_entry_id = pipeline_entry_id;
  if (contact_id) patch.contact_id = contact_id;

  const { error } = await svc.from("documents").update(patch).eq("id", document_id).eq("tenant_id", tenantId);
  if (error) return jsonErr(c, "link_failed", error.message, 500);

  await audit(svc, {
    route: "/documents/link-to-job",
    method: "POST", user_id: userId, tenant_id: tenantId,
    status: 200, request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event: "document_linked", document_id, ...patch }),
  });
  return jsonOk(c, { document_id, linked: patch });
}

// ---- Route bindings (POST-only because edgeApi / supabase.functions.invoke is always POST) ----

function pickDocId(c: Ctx, body: Record<string, unknown>): string | null {
  const paramId = c.req.param("document_id");
  if (paramId) return paramId;
  const bodyId = typeof body.document_id === "string" ? body.document_id : null;
  return bodyId;
}

async function withDocId(c: Ctx, fn: (docId: string, body: Record<string, unknown>) => Promise<Response>) {
  const body = await c.req.json().catch(() => ({}));
  const documentId = pickDocId(c, body);
  if (!documentId) return jsonErr(c, "bad_request", "document_id required", 400);
  return fn(documentId, body);
}

app.post("/documents/status", (c) => withDocId(c, (id) => statusHandler(c, id)));
app.post("/documents/:document_id/status", (c) => withDocId(c, (id) => statusHandler(c, id)));

app.post("/documents/extracted-data", (c) => withDocId(c, (id) => extractedDataHandler(c, id)));
app.post("/documents/:document_id/extracted-data", (c) => withDocId(c, (id) => extractedDataHandler(c, id)));

app.post("/documents/versions", (c) => withDocId(c, (id) => versionsHandler(c, id)));
app.post("/documents/:document_id/versions", (c) => withDocId(c, (id) => versionsHandler(c, id)));

app.post("/documents/reprocess", (c) => withDocId(c, (id) => reprocessHandler(c, id)));
app.post("/documents/:document_id/reprocess", (c) => withDocId(c, (id) => reprocessHandler(c, id)));

app.post("/documents/approve-extraction", (c) => withDocId(c, (id, body) => approveExtractionHandler(c, id, body)));
app.post("/documents/:document_id/approve-extraction", (c) => withDocId(c, (id, body) => approveExtractionHandler(c, id, body)));

app.post("/documents/link-to-job", (c) => withDocId(c, (id, body) => linkToJobHandler(c, id, body)));
app.post("/documents/:document_id/link-to-job", (c) => withDocId(c, (id, body) => linkToJobHandler(c, id, body)));

serveRouter(app);
