// OCR scanned documents via Lovable AI Gateway (Gemini Vision).
// - Images and small PDFs: direct multimodal call.
// - Large multi-page PDFs: marked `needs_worker` (no fake rasterization).
// Tenant-scoped. Updates documents.ocr_text, ocr_status, ocr_error, ocr_completed_at,
// and documents.metadata.ocr (retry_count, last_retry_at, mode, etc).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const OCR_MODEL = "google/gemini-2.5-flash";
const OCR_SYSTEM =
  "You are an OCR engine. Extract ALL readable text from the provided document, preserving line breaks and reading order. Output ONLY the extracted plain text — no commentary, no markdown fences. If a page break is detectable, insert a line containing exactly: --- PAGE BREAK ---. If nothing is readable, return an empty string.";

// Hard limits for the direct (no-rasterization) path.
const MAX_DIRECT_BYTES = 8 * 1024 * 1024;     // 8 MB
const MAX_DIRECT_PDF_PAGES = 5;               // small PDFs only

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function detectMime(filename: string | null | undefined, fallback: string | null | undefined): string {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function runOcr(base64: string, mime: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      messages: [
        { role: "system", content: OCR_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every word of text from this document." },
            mime === "application/pdf"
              ? { type: "file", file: { filename: "doc.pdf", file_data: `data:${mime};base64,${base64}` } }
              : { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("provider_rate_limited");
    if (res.status === 402) throw new Error("provider_credits_exhausted");
    throw new Error(`gateway_${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.toString() ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let documentId: string | null = null;

  const markFailure = async (status: "failed" | "needs_worker", error: string, metaPatch: Record<string, unknown> = {}) => {
    if (!documentId) return;
    try {
      const { data: cur } = await admin
        .from("documents")
        .select("metadata")
        .eq("id", documentId)
        .maybeSingle();
      const prevMeta = (cur?.metadata ?? {}) as Record<string, unknown>;
      const prevOcr = ((prevMeta as any).ocr ?? {}) as Record<string, unknown>;
      const nextMeta = {
        ...prevMeta,
        ocr: {
          ...prevOcr,
          last_status: status,
          last_error: error,
          last_retry_at: new Date().toISOString(),
          ...metaPatch,
        },
      };
      await admin
        .from("documents")
        .update({
          ocr_status: status,
          ocr_error: error.slice(0, 500),
          metadata: nextMeta,
        })
        .eq("id", documentId);
    } catch (_e) { /* swallow */ }
  };

  try {
    if (!LOVABLE_API_KEY) {
      const body = await req.json().catch(() => ({}));
      documentId = body?.document_id ?? null;
      await markFailure("failed", "OCR provider not configured");
      return jsonResponse({ ok: false, error: "OCR provider not configured" }, 500);
    }

    // Auth: caller JWT or internal sweeper secret
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    const internalSecret = req.headers.get("x-internal-worker-secret") ?? "";
    const expectedSecret = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;

    let userId: string | null = null;
    if (!isInternal) {
      if (!jwt) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userData?.user) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      userId = userData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    documentId = body?.document_id ?? null;
    if (!documentId) return jsonResponse({ ok: false, error: "missing document_id" }, 400);

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, tenant_id, file_path, mime_type, filename, page_count, metadata, ocr_status")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr || !doc) return jsonResponse({ ok: false, error: "document_not_found" }, 404);

    // Tenant gate (skipped for internal sweeper)
    if (!isInternal && userId) {
      const { data: profile } = await admin
        .from("profiles")
        .select("tenant_id, active_tenant_id")
        .eq("id", userId)
        .maybeSingle();
      const effective = profile?.active_tenant_id || profile?.tenant_id;
      let allowed = !!effective && effective === doc.tenant_id;
      if (!allowed) {
        const { data: isMaster } = await admin.rpc("has_role", { _user_id: userId, _role: "master" as any });
        allowed = !!isMaster;
      }
      if (!allowed) return jsonResponse({ ok: false, error: "tenant access denied" }, 403);
    }

    const prevMeta = (doc.metadata ?? {}) as Record<string, unknown>;
    const prevOcr = ((prevMeta as any).ocr ?? {}) as Record<string, unknown>;
    const retryCount = Number(prevOcr.retry_count ?? 0) + (doc.ocr_status === "processing" ? 0 : 1);

    // Mark processing
    await admin
      .from("documents")
      .update({
        ocr_status: "processing",
        ocr_error: null,
        metadata: {
          ...prevMeta,
          ocr: { ...prevOcr, retry_count: retryCount, last_retry_at: new Date().toISOString() },
        },
      })
      .eq("id", documentId);

    const mime = detectMime(doc.filename, doc.mime_type);
    const supportedImage = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
    const supportedPdf = mime === "application/pdf";
    if (!supportedImage && !supportedPdf) {
      await markFailure("failed", `unsupported MIME type: ${mime}`);
      return jsonResponse({ ok: false, error: `unsupported MIME type: ${mime}` }, 400);
    }

    // Download
    const { data: file, error: dlErr } = await admin.storage.from("documents").download(doc.file_path);
    if (dlErr || !file) {
      await markFailure("failed", `download failed: ${dlErr?.message ?? "unknown"}`);
      return jsonResponse({ ok: false, error: "download_failed" }, 500);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sizeBytes = bytes.byteLength;
    const pageCount = Number(doc.page_count ?? 0);

    // Large PDF gate: hand off to worker router if available, else mark needs_worker.
    if (supportedPdf && (sizeBytes > MAX_DIRECT_BYTES || pageCount > MAX_DIRECT_PDF_PAGES)) {
      const workerUrl = Deno.env.get("OCR_WORKER_URL") ?? "";
      const internalSecret = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";
      if (workerUrl && internalSecret) {
        fetch(`${SUPABASE_URL}/functions/v1/ocr-scanned-document-worker`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-worker-secret": internalSecret,
          },
          body: JSON.stringify({ document_id: documentId, tenant_id: doc.tenant_id }),
        }).catch((e) => console.error("[ocr] worker dispatch failed", e));
        return jsonResponse({ ok: true, status: "processing", dispatched: "worker" });
      }
      await markFailure(
        "needs_worker",
        "PDF requires worker rasterization",
        { mode: "needs_worker", size_bytes: sizeBytes, page_count: pageCount, retry_count: retryCount },
      );
      return jsonResponse({ ok: true, status: "needs_worker", reason: "pdf_too_large_for_direct_ocr" });
    }

    if (sizeBytes > MAX_DIRECT_BYTES) {
      await markFailure("failed", "file too large for OCR");
      return jsonResponse({ ok: false, error: "file_too_large" }, 413);
    }

    const base64 = toBase64(bytes);
    const text = await runOcr(base64, mime);

    if (!text || text.trim().length === 0) {
      await markFailure("failed", "empty OCR result", {
        mode: supportedPdf ? "direct_pdf" : "image",
        size_bytes: sizeBytes,
        page_count: pageCount,
        retry_count: retryCount,
      });
      return jsonResponse({ ok: false, error: "empty_result" }, 422);
    }

    const nextMeta = {
      ...prevMeta,
      ocr: {
        ...prevOcr,
        retry_count: retryCount,
        last_retry_at: new Date().toISOString(),
        mode: supportedPdf ? "direct_pdf" : "image",
        direct_pdf_mode: supportedPdf,
        rasterized: false,
        size_bytes: sizeBytes,
        page_count_attempted: pageCount || 1,
        pages_completed: pageCount || 1,
        provider: "lovable-ai-gateway",
        model: OCR_MODEL,
        completed_at: new Date().toISOString(),
      },
    };

    await admin
      .from("documents")
      .update({
        ocr_status: "completed",
        ocr_text: text,
        ocr_error: null,
        ocr_completed_at: new Date().toISOString(),
        metadata: nextMeta,
      })
      .eq("id", documentId);

    return jsonResponse({ ok: true, chars: text.length, mode: supportedPdf ? "direct_pdf" : "image" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ocr-scanned-document]", message);
    await markFailure("failed", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
