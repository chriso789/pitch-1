// OCR scanned documents using Lovable AI Gateway (Gemini).
// Async, idempotent, tenant-scoped. Updates documents.ocr_text + ocr_status.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const OCR_MODEL = "google/gemini-2.5-flash";
const OCR_SYSTEM = `You are an OCR engine. Extract ALL readable text from the provided document (PDF or image), preserving line breaks and reading order. Output ONLY the extracted plain text — no commentary, no markdown fences, no headers. If a page break is detectable, insert a line containing exactly: --- PAGE BREAK ---. If nothing is readable, return an empty string.`;

async function runOcr(base64: string, mime: string): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
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
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`gateway_${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.toString() ?? "";
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let documentId: string | null = null;

  try {
    // Auth check — require a valid user token
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) throw new Error("unauthorized");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new Error("unauthorized");
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    documentId = body?.document_id ?? null;
    if (!documentId) throw new Error("missing document_id");

    // Load document
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, tenant_id, file_path, mime_type, filename, ocr_status")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr || !doc) throw new Error("document_not_found");

    // Tenant access — caller must belong to the same tenant
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const effective = profile?.active_tenant_id || profile?.tenant_id;
    if (!effective || effective !== doc.tenant_id) {
      // Allow service role / master via has_role check
      const { data: isMaster } = await admin.rpc("has_role", {
        _user_id: userId,
        _role: "master",
      });
      if (!isMaster) throw new Error("forbidden");
    }

    // Mark processing
    await admin
      .from("documents")
      .update({ ocr_status: "processing", ocr_error: null })
      .eq("id", documentId);

    // Download from storage
    const { data: file, error: dlErr } = await admin.storage
      .from("documents")
      .download(doc.file_path);
    if (dlErr || !file) throw new Error(`download_failed: ${dlErr?.message ?? "unknown"}`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error("file_too_large_for_ocr");
    }
    const mime = doc.mime_type || (doc.filename?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const base64 = toBase64(bytes);

    const text = await runOcr(base64, mime);

    await admin
      .from("documents")
      .update({
        ocr_status: "completed",
        ocr_text: text,
        ocr_error: null,
        ocr_completed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return new Response(JSON.stringify({ ok: true, chars: text.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ocr-scanned-document]", message);
    if (documentId) {
      await admin
        .from("documents")
        .update({ ocr_status: "failed", ocr_error: message.slice(0, 500) })
        .eq("id", documentId)
        .then(() => {})
        .catch(() => {});
    }
    const status = message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
