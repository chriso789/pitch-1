// OCR worker router for large/multi-page scanned PDFs.
//
// This function defines the worker contract. It does NOT attempt to rasterize
// PDFs inside Supabase Edge Runtime (Deno cannot reliably do pdfjs/poppler
// rasterization at scale). Instead it forwards the rasterization+OCR job to
// an external worker service when OCR_WORKER_URL is configured. If no worker
// is configured the document is left in `needs_worker` for manual review.
//
// Auth: internal-only. Requires `x-internal-worker-secret` matching
// INTERNAL_WORKER_SECRET, OR service-role JWT.
//
// Input:
//   {
//     document_id: string,
//     tenant_id?: string,        // verified against the document row
//     storage_path?: string,     // ignored; resolved from row
//     max_pages?: number,        // default 25
//     dpi?: number,              // default 200
//     force?: boolean
//   }
//
// Output:
//   {
//     ok: boolean,
//     document_id: string,
//     status: "completed" | "failed" | "partial" | "needs_worker",
//     pages_attempted?: number,
//     pages_completed?: number,
//     errors?: Array<{ page: number, message: string }>,
//     worker_version?: string
//   }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";
const OCR_WORKER_URL = Deno.env.get("OCR_WORKER_URL") ?? "";

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_DPI = 200;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const WORKER_VERSION = "ocr-router-1.0.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let documentId: string | null = null;

  const patchMeta = async (
    status: "completed" | "failed" | "partial" | "needs_worker",
    patch: Record<string, unknown>,
    error?: string,
  ) => {
    if (!documentId) return;
    try {
      const { data: cur } = await admin
        .from("documents")
        .select("metadata")
        .eq("id", documentId)
        .maybeSingle();
      const prevMeta = (cur?.metadata ?? {}) as Record<string, unknown>;
      const prevOcr = ((prevMeta as any).ocr ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = {
        ocr_status: status,
        metadata: {
          ...prevMeta,
          ocr: {
            ...prevOcr,
            ...patch,
            worker_version: WORKER_VERSION,
            last_retry_at: new Date().toISOString(),
            ...(status === "completed" || status === "partial"
              ? { completed_at: new Date().toISOString() }
              : {}),
          },
        },
      };
      if (error !== undefined) update.ocr_error = error?.slice(0, 500) ?? null;
      if (status === "completed" || status === "partial") {
        (update as any).ocr_completed_at = new Date().toISOString();
      }
      await admin.from("documents").update(update).eq("id", documentId);
    } catch (_e) { /* swallow */ }
  };

  try {
    // Auth gate: internal secret OR service-role JWT
    const internalSecret = req.headers.get("x-internal-worker-secret") ?? "";
    const isInternal = !!INTERNAL_SECRET && internalSecret === INTERNAL_SECRET;
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    let isService = false;
    if (!isInternal && jwt) {
      // Treat as service if equal to service role key
      isService = jwt === SERVICE_ROLE;
    }
    if (!isInternal && !isService) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    documentId = body?.document_id ?? null;
    const tenantHint: string | null = body?.tenant_id ?? null;
    const maxPages = Math.min(50, Number(body?.max_pages ?? DEFAULT_MAX_PAGES));
    const dpi = Math.min(300, Math.max(120, Number(body?.dpi ?? DEFAULT_DPI)));
    const force: boolean = !!body?.force;
    if (!documentId) return json({ ok: false, error: "missing document_id" }, 400);

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select(
        "id, tenant_id, file_path, mime_type, filename, page_count, metadata, ocr_status, file_size",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (docErr || !doc) return json({ ok: false, error: "document_not_found" }, 404);

    if (tenantHint && tenantHint !== doc.tenant_id) {
      return json({ ok: false, error: "tenant mismatch" }, 403);
    }

    if (doc.ocr_status === "completed" && !force) {
      return json({ ok: true, document_id: doc.id, status: "completed", skipped: true });
    }

    const lower = (doc.filename ?? "").toLowerCase();
    const isPdf = doc.mime_type === "application/pdf" || lower.endsWith(".pdf");
    if (!isPdf) {
      await patchMeta("failed", { mode: "worker_rasterized" }, "worker only supports PDF input");
      return json({ ok: false, error: "worker_only_supports_pdf" }, 400);
    }

    const sizeBytes = Number(doc.file_size ?? 0);
    if (sizeBytes > MAX_PDF_BYTES && !force) {
      await patchMeta("failed", { mode: "worker_rasterized", size_bytes: sizeBytes },
        `pdf too large: ${sizeBytes} > ${MAX_PDF_BYTES}`);
      return json({ ok: false, error: "pdf_too_large" }, 413);
    }

    // No external worker wired up — leave document in needs_worker.
    if (!OCR_WORKER_URL) {
      await patchMeta("needs_worker", {
        mode: "needs_worker",
        dpi,
        max_pages: maxPages,
        size_bytes: sizeBytes,
        page_count: doc.page_count ?? null,
      }, "OCR worker not configured (OCR_WORKER_URL missing)");
      return json({
        ok: true,
        document_id: documentId,
        status: "needs_worker",
        reason: "ocr_worker_not_configured",
        worker_version: WORKER_VERSION,
      });
    }

    // Mark processing
    await patchMeta("completed", {}, undefined); // placeholder
    await admin
      .from("documents")
      .update({ ocr_status: "processing", ocr_error: null })
      .eq("id", documentId);

    // Forward job to external worker. The worker downloads the file using a
    // signed URL we mint here so it never needs Supabase service credentials.
    const { data: signed, error: signErr } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 60 * 30); // 30 min
    if (signErr || !signed?.signedUrl) {
      await patchMeta("failed", { mode: "worker_rasterized" },
        `signed url failed: ${signErr?.message ?? "unknown"}`);
      return json({ ok: false, error: "signed_url_failed" }, 500);
    }

    const workerPayload = {
      document_id: documentId,
      tenant_id: doc.tenant_id,
      file_url: signed.signedUrl,
      filename: doc.filename,
      page_count: doc.page_count ?? null,
      dpi,
      max_pages: maxPages,
      callback_url: `${SUPABASE_URL}/functions/v1/ocr-scanned-document-worker?callback=1`,
    };

    let workerRes: Response;
    try {
      workerRes = await fetch(OCR_WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-worker-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify(workerPayload),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchMeta("failed", { mode: "worker_rasterized" }, `worker_unreachable: ${msg}`);
      return json({ ok: false, error: "worker_unreachable", detail: msg }, 502);
    }

    if (!workerRes.ok) {
      const txt = await workerRes.text().catch(() => "");
      await patchMeta("failed", { mode: "worker_rasterized" },
        `worker_${workerRes.status}: ${txt.slice(0, 200)}`);
      return json({ ok: false, error: `worker_${workerRes.status}`, detail: txt.slice(0, 400) }, 502);
    }

    const result = await workerRes.json().catch(() => ({}));
    const status: "completed" | "failed" | "partial" =
      result?.status === "completed" || result?.status === "partial" || result?.status === "failed"
        ? result.status
        : "completed";
    const text: string = typeof result?.text === "string" ? result.text : "";
    const pagesAttempted = Number(result?.pages_attempted ?? 0);
    const pagesCompleted = Number(result?.pages_completed ?? 0);
    const errors = Array.isArray(result?.errors) ? result.errors : [];

    if ((status === "completed" || status === "partial") && text.trim().length > 0) {
      await admin
        .from("documents")
        .update({
          ocr_status: status === "partial" ? "completed" : "completed",
          ocr_text: text,
          ocr_error: null,
          ocr_completed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      await patchMeta(status, {
        mode: "worker_rasterized",
        dpi,
        max_pages: maxPages,
        pages_attempted: pagesAttempted,
        pages_completed: pagesCompleted,
        partial: status === "partial",
        page_errors: errors,
        provider: "external-worker",
        size_bytes: sizeBytes,
      });
    } else {
      await patchMeta("failed", {
        mode: "worker_rasterized",
        dpi,
        max_pages: maxPages,
        pages_attempted: pagesAttempted,
        pages_completed: pagesCompleted,
        page_errors: errors,
      }, "worker returned no text");
    }

    return json({
      ok: true,
      document_id: documentId,
      status,
      pages_attempted: pagesAttempted,
      pages_completed: pagesCompleted,
      errors,
      worker_version: WORKER_VERSION,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ocr-scanned-document-worker]", message);
    await patchMeta("failed", { mode: "worker_rasterized" }, message);
    return json({ ok: false, error: message }, 500);
  }
});
