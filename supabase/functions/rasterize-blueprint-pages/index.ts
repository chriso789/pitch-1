// Rasterizes every page of a blueprint PDF into JPEG images and persists them
// to the `blueprint-pages` storage bucket. Updates plan_pages.image_path and
// plan_documents.rasterization_status. Idempotent — pages that already have an
// image_path are skipped unless { force: true } is passed.
//
// Image-only PDFs are supported explicitly: if plan_pages have not been created
// yet, this function opens the PDF, creates one placeholder plan_pages row per
// physical PDF page, renders every page, then chains vision classification.

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
const RENDER_SCALE = 2.0;
const JPEG_QUALITY = 76;

async function downloadFromAnyBucket(svc: any, filePath: string): Promise<Uint8Array> {
  let lastErr: any = null;
  for (const bucket of SOURCE_BUCKETS) {
    try {
      const { data, error } = await svc.storage.from(bucket).download(filePath);
      if (!error && data) return new Uint8Array(await data.arrayBuffer());
      lastErr = error;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not download ${filePath}: ${lastErr?.message ?? "not found"}`);
}

async function seedMissingPages(svc: any, doc: any, pageCount: number) {
  const { data: existing, error } = await svc.from("plan_pages")
    .select("id,page_number")
    .eq("document_id", doc.id)
    .eq("tenant_id", doc.tenant_id);
  if (error) throw error;

  const existingNumbers = new Set((existing || []).map((p: any) => Number(p.page_number)));
  const missing = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter((pageNumber) => !existingNumbers.has(pageNumber))
    .map((pageNumber) => ({
      tenant_id: doc.tenant_id,
      document_id: doc.id,
      page_number: pageNumber,
      raw_text: "",
      page_type: "unknown",
      page_type_confidence: 0,
      scale_source: null,
      metadata: { source_mode: "image_only_pending_vision" },
    }));

  if (missing.length) {
    const { error: insertErr } = await svc.from("plan_pages").insert(missing);
    if (insertErr) throw insertErr;
  }
  return missing.length;
}

async function chainVisionClassification(documentId: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${url}/functions/v1/classify-blueprint-pages-vision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ document_id: documentId }),
    });
    if (!res.ok) console.error("vision classification chain failed", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error("vision classification chain failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
    if (!document_id && !page_id) return json({ ok: false, error: "document_id or page_id required" }, 400);

    const docQuery = document_id
      ? svc.from("plan_documents").select("*").eq("id", document_id).maybeSingle()
      : svc.from("plan_pages").select("document_id, plan_documents:document_id(*)").eq("id", page_id).maybeSingle();
    const { data: docOrPage, error: dErr } = await docQuery;
    if (dErr) throw dErr;
    const doc = document_id ? docOrPage : (docOrPage as any)?.plan_documents;
    if (!doc) return json({ ok: false, error: "not_found" }, 404);

    if (userId) {
      const [{ data: access }, { data: prof }] = await Promise.all([
        svc.from("user_company_access").select("tenant_id").eq("user_id", userId).eq("tenant_id", doc.tenant_id).maybeSingle(),
        svc.from("profiles").select("tenant_id,active_tenant_id").eq("id", userId).maybeSingle(),
      ]);
      if (!(access || prof?.tenant_id === doc.tenant_id || prof?.active_tenant_id === doc.tenant_id)) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
    }

    await svc.from("plan_documents").update({
      rasterization_status: "rendering",
      rasterization_error: null,
      status: "rasterizing",
      status_message: "rendering blueprint pages for text/vision extraction",
    }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);

    const pdfBytes = await downloadFromAnyBucket(svc, doc.file_path);
    const mupdfDoc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    const pageCount = mupdfDoc.countPages();
    const seeded = await seedMissingPages(svc, doc, pageCount);

    let pageQuery = svc.from("plan_pages")
      .select("id,page_number,image_path")
      .eq("document_id", doc.id)
      .eq("tenant_id", doc.tenant_id)
      .order("page_number");
    if (page_id) pageQuery = pageQuery.eq("id", page_id);
    const { data: pages, error: pErr } = await pageQuery;
    if (pErr) throw pErr;

    const toRender = (pages || []).filter((p: any) => force || !p.image_path);
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
        const { error: upErr } = await svc.storage.from(TARGET_BUCKET).upload(objectPath, jpegBytes, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (upErr) throw upErr;

        await svc.from("plan_pages").update({
          image_path: objectPath,
          width_px: pixmap.getWidth(),
          height_px: pixmap.getHeight(),
        }).eq("id", row.id).eq("tenant_id", doc.tenant_id);

        pixmap.destroy?.();
        mupdfPage.destroy?.();
        rendered += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!firstError) firstError = `page ${row.page_number}: ${msg}`;
      }
    }
    mupdfDoc.destroy?.();

    await svc.from("plan_documents").update({
      page_count: pageCount,
      rasterization_status: firstError ? "partial" : "complete",
      rasterization_error: firstError,
      status: firstError ? "needs_review" : "vision_classifying",
      status_message: firstError ? firstError : `rendered ${rendered} page(s); running vision classification`,
    }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);

    if (!firstError) await chainVisionClassification(doc.id);

    return json({
      ok: true,
      page_count: pageCount,
      seeded_pages: seeded,
      rendered,
      skipped: (pages?.length ?? 0) - toRender.length,
      error: firstError,
      next: firstError ? "manual_review" : "vision_classification",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
