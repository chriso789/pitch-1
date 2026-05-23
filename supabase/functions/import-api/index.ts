// import-api — Pitch CRM Import & Migration Center, Phase 1 (staging only).
// Master-only. No writes to live production tables.
//
// Routes:
//   POST /batches                          create batch
//   GET  /batches                          list batches for current tenant
//   GET  /batches/:id                      batch detail
//   GET  /batches/:id/status               progress
//   POST /batches/:id/upload-url           signed upload URLs
//   POST /files/:id/detect-schema          inspect headers + suggest mapping
//   POST /files/:id/parse                  parse CSV into staging
//   POST /batches/:id/validate             run validators
//   POST /batches/:id/detect-duplicates    run duplicate detection
//   POST /batches/:id/dry-run              dry-run summary
//   POST /duplicates/:id/decide            admin decision

import { Hono } from "jsr:@hono/hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRouter, jsonOk, jsonErr, type RouterEnv } from "../_shared/router.ts";
import { suggestMapping, guessEntityType } from "../_shared/import/fieldAliases.ts";
import { normalizeRow } from "../_shared/import/normalizers.ts";
import { validateRecord } from "../_shared/import/validators.ts";
import { findDuplicates } from "../_shared/import/duplicateDetection.ts";
import { parseCSV, rowsToObjects } from "../_shared/import/csv.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type AuthCtx = { userId: string; tenantId: string; isMaster: boolean; sb: ReturnType<typeof createClient> };

async function authMaster(req: Request): Promise<{ ctx?: AuthCtx; error?: Response }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: new Response(JSON.stringify({ ok: false, error: "missing_auth" }), { status: 401 }) };
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error } = await userClient.auth.getUser();
  if (error || !u?.user) {
    return { error: new Response(JSON.stringify({ ok: false, error: "invalid_token" }), { status: 401 }) };
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "master").maybeSingle();
  if (!role) {
    return { error: new Response(JSON.stringify({ ok: false, error: "forbidden_master_only" }), { status: 403 }) };
  }
  const { data: profile } = await sb.from("profiles").select("active_tenant_id, tenant_id").eq("id", u.user.id).maybeSingle();
  const tenantId = (profile?.active_tenant_id || profile?.tenant_id) as string | undefined;
  if (!tenantId) {
    return { error: new Response(JSON.stringify({ ok: false, error: "no_tenant_resolved" }), { status: 400 }) };
  }
  return { ctx: { userId: u.user.id, tenantId, isMaster: true, sb } };
}

async function audit(sb: any, tenant_id: string, batch_id: string, actor_id: string, action: string, message?: string, extra?: any) {
  try {
    await sb.from("import_audit_log").insert({ tenant_id, batch_id, actor_id, action, message, after_data: extra ?? null });
  } catch (_) { /* best-effort */ }
}

const app = createRouter("import-api") as Hono<RouterEnv>;

app.get("/__health", (c) => jsonOk(c, { fn: "import-api", ok: true }));

// ---------------- Batches ----------------

app.post("/batches", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const body = await c.req.json().catch(() => ({}));
  const { source_system, source_label, import_mode } = body ?? {};
  if (!source_system) return jsonErr(c, "missing_source_system", "source_system is required", 400);

  const { data, error } = await sb.from("import_batches").insert({
    tenant_id: ctx!.tenantId,
    created_by: ctx!.userId,
    source_system,
    source_label: source_label ?? null,
    import_mode: import_mode ?? "dry_run",
    status: "uploaded",
  }).select().single();
  if (error) return jsonErr(c, "create_failed", error.message, 500);
  await audit(sb, ctx!.tenantId, data.id, ctx!.userId, "batch_created", `source=${source_system}`);
  return jsonOk(c, { batch: data });
});

app.get("/batches", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const { data, error } = await sb.from("import_batches")
    .select("*")
    .eq("tenant_id", ctx!.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return jsonErr(c, "list_failed", error.message, 500);
  return jsonOk(c, { batches: data });
});

app.get("/batches/:id", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const id = c.req.param("id");
  const [batch, files, errors, dupes] = await Promise.all([
    sb.from("import_batches").select("*").eq("id", id).eq("tenant_id", ctx!.tenantId).maybeSingle(),
    sb.from("import_files").select("*").eq("batch_id", id).eq("tenant_id", ctx!.tenantId),
    sb.from("import_validation_errors").select("*").eq("batch_id", id).eq("tenant_id", ctx!.tenantId).limit(500),
    sb.from("import_duplicate_reviews").select("*").eq("batch_id", id).eq("tenant_id", ctx!.tenantId).limit(500),
  ]);
  if (!batch.data) return jsonErr(c, "not_found", "Batch not found", 404);
  return jsonOk(c, { batch: batch.data, files: files.data ?? [], errors: errors.data ?? [], duplicates: dupes.data ?? [] });
});

app.get("/batches/:id/status", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const id = c.req.param("id");
  const { data: b } = await sb.from("import_batches").select("*").eq("id", id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!b) return jsonErr(c, "not_found", "Batch not found", 404);
  const pct = b.total_rows > 0 ? Number(((b.processed_rows / b.total_rows) * 100).toFixed(1)) : 0;
  return jsonOk(c, {
    batch_id: b.id, status: b.status, total_rows: b.total_rows, processed_rows: b.processed_rows,
    valid_rows: b.valid_rows, invalid_rows: b.invalid_rows, duplicate_rows: b.duplicate_rows,
    percent_complete: pct, current_step: b.status,
  });
});

// ---------------- Files / upload ----------------

app.post("/batches/:id/upload-url", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const files: Array<{ filename: string; mime_type?: string; file_size_bytes?: number }> = body?.files ?? [];
  if (!Array.isArray(files) || files.length === 0) return jsonErr(c, "missing_files", "files[] required", 400);

  const { data: batch } = await sb.from("import_batches").select("id").eq("id", batch_id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!batch) return jsonErr(c, "not_found", "Batch not found", 404);

  const uploads: Array<{ file_id: string; upload_url: string; storage_path: string }> = [];
  for (const f of files) {
    const safe = f.filename.replace(/[^\w.\-]+/g, "_");
    const storage_path = `${ctx!.tenantId}/imports/${batch_id}/${crypto.randomUUID()}_${safe}`;
    const { data: fileRow, error: fErr } = await sb.from("import_files").insert({
      tenant_id: ctx!.tenantId, batch_id, storage_bucket: "imports", storage_path,
      original_filename: f.filename, mime_type: f.mime_type ?? null, file_size_bytes: f.file_size_bytes ?? null,
    }).select().single();
    if (fErr) return jsonErr(c, "file_row_failed", fErr.message, 500);

    const { data: signed, error: sErr } = await sb.storage.from("imports").createSignedUploadUrl(storage_path);
    if (sErr) return jsonErr(c, "sign_failed", sErr.message, 500);
    uploads.push({ file_id: fileRow.id, upload_url: signed.signedUrl, storage_path });
  }
  await sb.from("import_batches").update({ total_files: files.length, status: "uploading", updated_at: new Date().toISOString() })
    .eq("id", batch_id);
  return jsonOk(c, { uploads });
});

// ---------------- Schema detection ----------------

app.post("/files/:id/detect-schema", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const id = c.req.param("id");
  const { data: file } = await sb.from("import_files").select("*").eq("id", id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!file) return jsonErr(c, "not_found", "File not found", 404);

  const { data: blob, error: dErr } = await sb.storage.from(file.storage_bucket).download(file.storage_path);
  if (dErr || !blob) return jsonErr(c, "download_failed", dErr?.message ?? "no blob", 500);

  // Read first 64KB to inspect header
  const head = await blob.slice(0, 65536).text();
  const rows = parseCSV(head);
  const { headers } = rowsToObjects(rows);
  const entity_type = guessEntityType(headers);
  const suggested = suggestMapping(headers);

  const detected_schema = { headers, entity_type, suggested_mapping: suggested };
  await sb.from("import_files").update({
    detected_schema, file_kind: "csv", status: "schema_detected", updated_at: new Date().toISOString(),
  }).eq("id", id);

  return jsonOk(c, { file_id: id, entity_type, detected_fields: headers, suggested_mapping: suggested });
});

// ---------------- Parse into staging ----------------

app.post("/files/:id/parse", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const fieldMap: Record<string, string> = body?.field_map ?? {};
  const entity_type: string = body?.entity_type ?? "contact";

  const { data: file } = await sb.from("import_files").select("*").eq("id", id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!file) return jsonErr(c, "not_found", "File not found", 404);

  const { data: blob, error: dErr } = await sb.storage.from(file.storage_bucket).download(file.storage_path);
  if (dErr || !blob) return jsonErr(c, "download_failed", dErr?.message ?? "no blob", 500);

  const text = await blob.text();
  const rows = parseCSV(text);
  const { headers, records } = rowsToObjects(rows);

  // Use detected suggestion if no map provided
  let effectiveMap = fieldMap;
  if (Object.keys(effectiveMap).length === 0) {
    const suggested = suggestMapping(headers);
    effectiveMap = Object.fromEntries(Object.entries(suggested).map(([k, v]) => [k, v.pitch_field]));
  }

  // Chunk insert: 500 rows at a time
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const staging = slice.map((raw, idx) => ({
      tenant_id: ctx!.tenantId, batch_id: file.batch_id, file_id: id,
      row_number: i + idx + 2, // +2 = header row + 1-indexed
      entity_type, source_record_id: (raw["id"] || raw["ID"] || raw["source_id"] || null) as string | null,
      raw_data: raw, normalized_data: normalizeRow(raw, effectiveMap),
    }));
    const { error } = await sb.from("import_staging_records").insert(staging);
    if (error) return jsonErr(c, "insert_failed", error.message, 500);
    inserted += slice.length;
  }

  await sb.from("import_files").update({
    row_count: records.length, processed_count: inserted, status: "parsed", updated_at: new Date().toISOString(),
  }).eq("id", id);

  // Update batch totals
  const { data: agg } = await sb.from("import_staging_records").select("id", { count: "exact", head: true })
    .eq("batch_id", file.batch_id).eq("tenant_id", ctx!.tenantId);
  await sb.from("import_batches").update({
    total_rows: (agg as any)?.count ?? inserted, status: "parsed", updated_at: new Date().toISOString(),
  }).eq("id", file.batch_id);
  await audit(sb, ctx!.tenantId, file.batch_id, ctx!.userId, "file_parsed", `rows=${inserted}`);

  return jsonOk(c, { file_id: id, parsed_rows: inserted, entity_type });
});

// ---------------- Validation ----------------

app.post("/batches/:id/validate", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");

  // Clear prior errors for this batch
  await sb.from("import_validation_errors").delete().eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId);

  // Process in pages of 1000
  let valid = 0, invalid = 0, warnings = 0, processed = 0;
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows, error } = await sb.from("import_staging_records")
      .select("id, entity_type, normalized_data")
      .eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return jsonErr(c, "scan_failed", error.message, 500);
    if (!rows || rows.length === 0) break;

    const errInserts: any[] = [];
    const statusUpdates: Array<{ id: string; status: string }> = [];
    for (const r of rows) {
      const findings = validateRecord(r.entity_type as string, (r.normalized_data ?? {}) as any);
      let rowStatus = "valid";
      for (const f of findings) {
        errInserts.push({
          tenant_id: ctx!.tenantId, batch_id, staging_record_id: r.id,
          severity: f.severity, field_name: f.field_name ?? null, entity_type: r.entity_type,
          error_code: f.error_code, message: f.message, suggested_fix: f.suggested_fix ?? null,
          raw_value: f.raw_value ?? null,
        });
        if (f.severity === "error") rowStatus = "invalid";
        else if (f.severity === "warning" && rowStatus === "valid") rowStatus = "warning";
      }
      statusUpdates.push({ id: r.id as string, status: rowStatus });
      if (rowStatus === "invalid") invalid++;
      else if (rowStatus === "warning") { valid++; warnings++; }
      else valid++;
      processed++;
    }
    if (errInserts.length > 0) await sb.from("import_validation_errors").insert(errInserts);
    // Bulk-ish updates (one per status group)
    for (const grp of ["valid", "invalid", "warning"]) {
      const ids = statusUpdates.filter((s) => s.status === grp).map((s) => s.id);
      if (ids.length > 0) {
        await sb.from("import_staging_records").update({ validation_status: grp, updated_at: new Date().toISOString() })
          .in("id", ids);
      }
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  await sb.from("import_batches").update({
    valid_rows: valid, invalid_rows: invalid, processed_rows: processed,
    status: "validated", updated_at: new Date().toISOString(),
  }).eq("id", batch_id);
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "validated", `valid=${valid} invalid=${invalid} warnings=${warnings}`);

  return jsonOk(c, { batch_id, processed, valid, invalid, warnings });
});

// ---------------- Duplicate detection ----------------

app.post("/batches/:id/detect-duplicates", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");

  await sb.from("import_duplicate_reviews").delete().eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId);

  let dupeRows = 0;
  let from = 0; const PAGE = 500;
  while (true) {
    const { data: rows, error } = await sb.from("import_staging_records")
      .select("id, entity_type, normalized_data")
      .eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId)
      .neq("validation_status", "invalid")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return jsonErr(c, "scan_failed", error.message, 500);
    if (!rows || rows.length === 0) break;

    const inserts: any[] = [];
    const dupeIds: string[] = [];
    for (const r of rows) {
      const cands = await findDuplicates(sb as any, ctx!.tenantId, r.entity_type as string, (r.normalized_data ?? {}) as any);
      if (cands.length > 0) {
        dupeRows++;
        dupeIds.push(r.id as string);
        for (const cand of cands) {
          inserts.push({
            tenant_id: ctx!.tenantId, batch_id, staging_record_id: r.id, entity_type: r.entity_type,
            candidate_table: cand.candidate_table, candidate_record_id: cand.candidate_record_id,
            confidence: cand.confidence, match_reasons: cand.match_reasons, decision: "pending",
          });
        }
      }
    }
    if (inserts.length > 0) await sb.from("import_duplicate_reviews").insert(inserts);
    if (dupeIds.length > 0) {
      await sb.from("import_staging_records").update({ duplicate_status: "duplicate_pending", updated_at: new Date().toISOString() })
        .in("id", dupeIds);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  await sb.from("import_batches").update({
    duplicate_rows: dupeRows, status: "duplicates_checked", updated_at: new Date().toISOString(),
  }).eq("id", batch_id);
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "duplicates_detected", `duplicate_rows=${dupeRows}`);

  return jsonOk(c, { batch_id, duplicate_rows: dupeRows });
});

// ---------------- Dry run ----------------

app.post("/batches/:id/dry-run", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");

  const { data: batch } = await sb.from("import_batches").select("*").eq("id", batch_id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!batch) return jsonErr(c, "not_found", "Batch not found", 404);

  const { data: byEntity } = await sb.rpc("execute_sql", { sql: "" }).catch(() => ({ data: null })); // not used; fallback below
  // Build summary by entity_type via separate queries (RPCs vary per tenant)
  const types = ["contact", "lead", "job", "project", "invoice", "budget", "document", "image"];
  const would_create: Record<string, number> = {};
  for (const t of types) {
    const { count } = await sb.from("import_staging_records")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId)
      .eq("entity_type", t).in("validation_status", ["valid", "warning"]).eq("duplicate_status", "unchecked");
    if ((count ?? 0) > 0) would_create[t] = count ?? 0;
  }

  const { count: would_update } = await sb.from("import_duplicate_reviews")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batch_id).eq("tenant_id", ctx!.tenantId).eq("decision", "merge");

  const summary = {
    batch_id,
    would_create,
    would_update: { contacts: would_update ?? 0 },
    blocked: {
      invalid_rows: batch.invalid_rows ?? 0,
      unresolved_duplicates: (batch.duplicate_rows ?? 0),
    },
    note: "Phase 1 is staging-only. Commit/file-worker/rollback ship in Phase 2.",
  };
  await sb.from("import_batches").update({ status: "dry_run_complete", updated_at: new Date().toISOString() }).eq("id", batch_id);
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "dry_run", JSON.stringify(would_create));
  return jsonOk(c, summary);
});

// ---------------- Duplicate decision ----------------

app.post("/duplicates/:id/decide", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const decision = String(body?.decision ?? "");
  if (!["merge", "skip", "create_new", "pending"].includes(decision)) {
    return jsonErr(c, "bad_decision", "decision must be merge|skip|create_new|pending", 400);
  }
  const { data: dr } = await sb.from("import_duplicate_reviews").select("*").eq("id", id).eq("tenant_id", ctx!.tenantId).maybeSingle();
  if (!dr) return jsonErr(c, "not_found", "Duplicate review not found", 404);
  await sb.from("import_duplicate_reviews").update({
    decision, reviewed_by: ctx!.userId, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  const newStatus = decision === "merge" ? "duplicate_merged" : decision === "skip" ? "duplicate_skipped" : decision === "create_new" ? "unchecked" : "duplicate_pending";
  await sb.from("import_staging_records").update({ duplicate_status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", dr.staging_record_id);
  return jsonOk(c, { id, decision });
});

// ============================================================
// Vendor Migration Adapter Layer (Phase 1, staging-only)
// ============================================================
import { listAdapters, getAdapter, rankAdapters, detectBestAdapter } from "../_shared/import/adapters/registry.ts";
import type { ImportFileDescriptor, PitchImportEntity } from "../_shared/import/adapters/types.ts";

async function loadBatchFiles(sb: any, tenantId: string, batchId: string): Promise<ImportFileDescriptor[]> {
  const { data: files } = await sb.from("import_files").select("*")
    .eq("tenant_id", tenantId).eq("batch_id", batchId);
  return (files ?? []).map((f: any) => ({
    id: f.id, name: f.file_name ?? f.name ?? "",
    path: f.storage_path ?? null, size: f.file_size ?? null,
    mime_type: f.mime_type ?? null,
    ext: ((f.file_name ?? "").split(".").pop() ?? "").toLowerCase(),
    headers: f.detected_headers ?? f.headers ?? [],
    sample_rows: f.sample_rows ?? [],
    folder: f.folder ?? null,
  }));
}

// POST /batches/:id/detect-source-system
app.post("/batches/:id/detect-source-system", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");
  const files = await loadBatchFiles(sb, ctx!.tenantId, batch_id);
  const ranked = await rankAdapters(files);
  const top = await detectBestAdapter(files);
  if (top) {
    await sb.from("import_source_manifests").insert({
      tenant_id: ctx!.tenantId, batch_id,
      source_system: top.source_system,
      detected_confidence: top.confidence,
      files: files as any,
      detected_entities: top.entities,
      folder_structure: {},
      warnings: top.warnings,
    });
  }
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "vendor_detect", top?.source_system ?? "none");
  return jsonOk(c, { ranked, top });
});

// POST /batches/:id/source-manifest  body: { source_system }
app.post("/batches/:id/source-manifest", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const adapter = getAdapter(String(body?.source_system ?? ""));
  if (!adapter) return jsonErr(c, "unknown_adapter", "source_system not recognized", 400);
  const files = await loadBatchFiles(sb, ctx!.tenantId, batch_id);
  const manifest = await adapter.buildManifest(files);
  const { data: row, error } = await sb.from("import_source_manifests").insert({
    tenant_id: ctx!.tenantId, batch_id,
    source_system: manifest.source_system,
    detected_confidence: manifest.detected_confidence,
    files: manifest.files as any,
    detected_entities: manifest.detected_entities,
    folder_structure: manifest.folder_structure,
    warnings: manifest.warnings,
  }).select().single();
  if (error) return jsonErr(c, "manifest_failed", error.message, 500);
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "vendor_manifest", manifest.source_system);
  return jsonOk(c, { manifest: row });
});

// POST /batches/:id/preview-normalized  body: { source_system, entity_type, limit? }
app.post("/batches/:id/preview-normalized", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const adapter = getAdapter(String(body?.source_system ?? ""));
  if (!adapter) return jsonErr(c, "unknown_adapter", "source_system not recognized", 400);
  const entity = String(body?.entity_type ?? "contact") as PitchImportEntity;
  const limit = Math.min(Number(body?.limit ?? 50), 200);
  const { data: rows } = await sb.from("import_staging_records")
    .select("id, raw_data, entity_type")
    .eq("tenant_id", ctx!.tenantId).eq("batch_id", batch_id).eq("entity_type", entity).limit(limit);
  const preview = [];
  for (const r of rows ?? []) {
    const norm = await adapter.normalizeRecord({
      entityType: entity, raw: r.raw_data ?? {}, batchId: batch_id, tenantId: ctx!.tenantId,
    });
    preview.push({ staging_id: r.id, raw: r.raw_data, normalized: norm.normalized, confidence: norm.confidence, warnings: norm.warnings, source_record_id: norm.sourceRecordId });
  }
  return jsonOk(c, { preview, entity_type: entity, count: preview.length });
});

// POST /batches/:id/migration-plan  body: { source_system }
app.post("/batches/:id/migration-plan", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a; const sb = ctx!.sb;
  const batch_id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const source_system = String(body?.source_system ?? "");
  const adapter = getAdapter(source_system);
  if (!adapter) return jsonErr(c, "unknown_adapter", "source_system not recognized", 400);
  const { data: man } = await sb.from("import_source_manifests").select("*")
    .eq("tenant_id", ctx!.tenantId).eq("batch_id", batch_id).eq("source_system", source_system)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!man) return jsonErr(c, "no_manifest", "Run source-manifest first.", 400);
  const plan = await adapter.buildMigrationPlan({
    source_system, detected_confidence: man.detected_confidence,
    files: man.files ?? [], detected_entities: man.detected_entities ?? {},
    folder_structure: man.folder_structure ?? {}, warnings: man.warnings ?? [],
  });
  const { data: row, error } = await sb.from("import_migration_plans").insert({
    tenant_id: ctx!.tenantId, batch_id, source_system,
    plan_status: "draft",
    entity_order: plan.entity_order,
    estimated_counts: plan.estimated_counts,
    required_mappings: plan.required_mappings,
    optional_mappings: plan.optional_mappings,
    unresolved_requirements: plan.unresolved_requirements,
    risk_flags: plan.risk_flags,
    recommended_actions: plan.recommended_actions,
    confidence_score: plan.confidence_score,
    confidence_band: plan.confidence_band,
    created_by: ctx!.userId,
  }).select().single();
  if (error) return jsonErr(c, "plan_failed", error.message, 500);
  await audit(sb, ctx!.tenantId, batch_id, ctx!.userId, "vendor_plan", `score=${plan.confidence_score}`);
  return jsonOk(c, { plan: row });
});

// POST /adapters/test  body: { source_system, entity_type, sample_rows[] }
app.post("/adapters/test", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  const { ctx } = a;
  const body = await c.req.json().catch(() => ({}));
  const adapter = getAdapter(String(body?.source_system ?? ""));
  if (!adapter) return jsonErr(c, "unknown_adapter", "source_system not recognized", 400);
  const entity = String(body?.entity_type ?? "contact") as PitchImportEntity;
  const samples: any[] = Array.isArray(body?.sample_rows) ? body.sample_rows : [];
  const results = [];
  for (const raw of samples.slice(0, 20)) {
    const n = await adapter.normalizeRecord({ entityType: entity, raw, batchId: "__test__", tenantId: ctx!.tenantId });
    results.push(n);
  }
  const avg = results.length ? results.reduce((a, b) => a + b.confidence, 0) / results.length : 0;
  return jsonOk(c, { adapter: adapter.sourceSystem, entity_type: entity, results, average_confidence: avg });
});

// GET /adapters  — list registry
app.get("/adapters", async (c) => {
  const a = await authMaster(c.req.raw); if (a.error) return a.error;
  return jsonOk(c, { adapters: listAdapters().map((x) => ({
    source_system: x.sourceSystem, display_name: x.displayName, version: x.version,
    supported_file_types: x.supportedFileTypes, supported_entity_types: x.supportedEntityTypes,
  })) });
});

Deno.serve(app.fetch);

