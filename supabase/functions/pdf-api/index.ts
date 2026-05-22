// pdf-api — routed Edge Function. Deterministic PDF operations only (no AI).
import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import { extractPdfText, downloadStorageObject } from "../_shared/parsers/pdf-text.ts";

const app = createRouter("pdf-api");

app.get("/__health", (c) => jsonOk(c, { fn: "pdf-api", ok: true }));
app.use("/*", requireAuth);
app.use("/*", requireTenant);

// POST /text  { bucket, path }  OR  { document_id }
// POST /extract-text — alias, same shape
async function handleText(c: Parameters<Parameters<typeof app.post>[1]>[0]) {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const svc = serviceClient();

  let bucket: string | undefined = body.bucket;
  let path: string | undefined = body.path;

  if (!bucket || !path) {
    if (!body.document_id) return jsonErr(c, "bad_request", "Provide {bucket,path} or {document_id}", 400);
    const { data: doc, error } = await svc
      .from("documents").select("file_path,tenant_id")
      .eq("id", body.document_id).maybeSingle();
    if (error || !doc) return jsonErr(c, "not_found", "Document not found", 404);
    if (doc.tenant_id !== tenantId) return jsonErr(c, "forbidden", "Cross-tenant access denied", 403);
    bucket = "documents"; path = doc.file_path;
  }

  try {
    const bytes = await downloadStorageObject(svc, bucket!, path!);
    const result = await extractPdfText(bytes);
    return jsonOk(c, result);
  } catch (e) {
    return jsonErr(c, "pdf_extract_failed", e instanceof Error ? e.message : String(e), 500);
  }
}
app.post("/text", handleText);
app.post("/extract-text", handleText);

app.post("/split-pages", async (c) => jsonErr(c, "not_implemented", "Split-pages route deferred to next loop.", 501));
app.post("/render-page", async (c) => jsonErr(c, "not_implemented", "Render-page requires server-side canvas; deferred.", 501));
app.post("/ocr", async (c) => jsonErr(c, "ocr_deferred", "OCR tier deferred. Use /text first; if has_selectable_text=false enqueue for review.", 501));
app.post("/parse", handleText);   // legacy shim target
app.post("/compile", async (c) => jsonErr(c, "not_implemented", "PDF compile route deferred.", 501));

Deno.serve(app.fetch);
