// Orchestrates blueprint parsing: rasterize pages -> classify -> extract geometry -> extract specs -> link details.
// This skeleton creates plan_pages rows from the uploaded PDF and chains the downstream functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getDocument, GlobalWorkerOptions } from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// pdfjs in Deno: disable worker
// @ts-ignore
GlobalWorkerOptions.workerSrc = "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: doc, error: docErr } = await supabase
      .from("plan_documents").select("*").eq("id", document_id).single();
    if (docErr || !doc) throw new Error(`document not found: ${docErr?.message}`);

    await supabase.from("plan_documents")
      .update({ status: "classifying", status_message: "rasterizing pages" })
      .eq("id", document_id);

    // Download PDF from storage
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from("blueprints").download(doc.file_path);
    if (dlErr || !pdfBlob) throw new Error(`download failed: ${dlErr?.message}`);

    const arrayBuf = await pdfBlob.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(arrayBuf), disableWorker: true } as any).promise;
    const pageCount = pdf.numPages;

    await supabase.from("plan_documents").update({ page_count: pageCount }).eq("id", document_id);

    // Create one plan_pages row per page (image rasterization stub - we store the source PDF page index;
    // page image generation can be moved to a Python worker later for true raster output).
    const rows = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent().catch(() => ({ items: [] }));
      // @ts-ignore
      const rawText = (textContent.items || []).map((it: any) => it.str).join(" ").slice(0, 8000);
      const viewport = page.getViewport({ scale: 1.0 });
      rows.push({
        tenant_id: doc.tenant_id,
        document_id,
        page_number: i,
        width_px: Math.round(viewport.width),
        height_px: Math.round(viewport.height),
        raw_text: rawText,
      });
    }
    const { error: insErr } = await supabase.from("plan_pages").upsert(rows, {
      onConflict: "document_id,page_number",
    });
    if (insErr) throw new Error(`insert pages failed: ${insErr.message}`);

    // Kick off classifier (non-blocking: chain via fetch)
    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    fetch(`${baseUrl}/functions/v1/classify-blueprint-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ document_id }),
    }).catch((e) => console.error("classify chain failed", e));

    return new Response(
      JSON.stringify({ success: true, document_id, page_count: pageCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("parse-blueprint-document error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
