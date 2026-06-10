// Rasterizes every page of a blueprint PDF into JPEG images and persists them
// to the `blueprint-pages` storage bucket. Updates plan_pages.image_path and
// plan_documents.rasterization_status. Idempotent — pages that already have an
// image_path are skipped unless { force: true } is passed.
//
// Uses MuPDF (WASM) for high-quality PDF page rendering inside Deno edge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// @ts-ignore - npm specifier
import * as mupdf from "npm:mupdf@0.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SOURCE_BUCKETS = ["blueprints", "blueprint-documents", "documents"];
const TARGET_BUCKET = "blueprint-pages";
const RENDER_SCALE = 2.0; // ~144 DPI
const JPEG_QUALITY = 70;

async function downloadFromAnyBucket(svc: any, filePath: string): Promise<Uint8Array> {
  let lastErr: any = null;
  for (const bucket of SOURCE_BUCKETS) {
    try {
      const { data, error } = await svc.storage.from(bucket).download(filePath);
      if (!error && data) {
        const buf = await data.arrayBuffer();
        return new Uint8Array(buf);
      }
      lastErr = error;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not download ${filePath}: ${lastErr?.message ?? "not found"}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: optional (also callable internally from upload-blueprint-document
    // which passes a service-role authorization). Validate user when a JWT
    // is present; otherwise require the internal-call shared secret.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (jwt && jwt !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data: u } = await svc.auth.getUser(jwt);
      userId = u?.user?.id ?? null;
      if (!userId) return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { document_id, page_id, force = false } = body || {};
    if (!document_id && !page_id) {
      return json({ ok: false, error: "document_id or page_id required" }, 400);
    }

    // Resolve document
    const docQuery = document_id
      ? svc.from("plan_documents").select("*").eq("id", document_id).maybeSingle()
      : svc
          .from("plan_pages")
          .select("document_id, plan_documents:document_id(*)")
          .eq("id", page_id)
          .maybeSingle();
    const { data: docOrPage, error: dErr } = await docQuery;
    if (dErr) throw dErr;
    const doc = document_id ? docOrPage : (docOrPage as any)?.plan_documents;
    if (!doc) return json({ ok: false, error: "not_found" }, 404);

    // Access check when authenticated as a user
    if (userId) {
      const [{ data: access }, { data: prof }] = await Promise.all([
        svc
          .from("user_company_access")
          .select("tenant_id")
          .eq("user_id", userId)
          .eq("tenant_id", doc.tenant_id)
          .maybeSingle(),
        svc.from("profiles").select("tenant_id,active_tenant_id").eq("id", userId).maybeSingle(),
      ]);
      const ok =
        access ||
        prof?.tenant_id === doc.tenant_id ||
        prof?.active_tenant_id === doc.tenant_id;
      if (!ok) return json({ ok: false, error: "forbidden" }, 403);
    }

    // Mark in-progress
    await svc
      .from("plan_documents")
      .update({ rasterization_status: "rendering", rasterization_error: null })
      .eq("id", doc.id);

    // Load page rows we need to render
    let pageQuery = svc
      .from("plan_pages")
      .select("id, page_number, image_path")
      .eq("document_id", doc.id)
      .eq("tenant_id", doc.tenant_id)
      .order("page_number");
    if (page_id) pageQuery = pageQuery.eq("id", page_id);
    const { data: pages, error: pErr } = await pageQuery;
    if (pErr) throw pErr;

    const toRender = (pages || []).filter((p) => force || !p.image_path);
    if (toRender.length === 0) {
      await svc.from("plan_documents").update({ rasterization_status: "complete" }).eq("id", doc.id);
      return json({ ok: true, rendered: 0, skipped: pages?.length ?? 0 });
    }

    // Download PDF
    const pdfBytes = await downloadFromAnyBucket(svc, doc.file_path);

    // Open with MuPDF
    const mupdfDoc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    const pageCount = mupdfDoc.countPages();

    let rendered = 0;
    let firstError: string | null = null;

    for (const row of toRender) {
      const idx = (row.page_number ?? 1) - 1;
      if (idx < 0 || idx >= pageCount) continue;
      try {
        const mupdfPage = mupdfDoc.loadPage(idx);
        const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
        const pixmap = mupdfPage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        const jpegBytes = pixmap.asJPEG(JPEG_QUALITY);

        const objectPath = `${doc.tenant_id}/${doc.id}/page-${row.page_number}.jpg`;
        const { error: upErr } = await svc.storage
          .from(TARGET_BUCKET)
          .upload(objectPath, jpegBytes, {
            contentType: "image/jpeg",
            upsert: true,
          });
        if (upErr) throw upErr;

        await svc
          .from("plan_pages")
          .update({
            image_path: objectPath,
            width_px: pixmap.getWidth(),
            height_px: pixmap.getHeight(),
          })
          .eq("id", row.id);

        pixmap.destroy?.();
        mupdfPage.destroy?.();
        rendered += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!firstError) firstError = `page ${row.page_number}: ${msg}`;
      }
    }

    mupdfDoc.destroy?.();

    await svc
      .from("plan_documents")
      .update({
        rasterization_status: firstError ? "partial" : "complete",
        rasterization_error: firstError,
      })
      .eq("id", doc.id);

    return json({ ok: true, rendered, skipped: (pages?.length ?? 0) - toRender.length, error: firstError });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
