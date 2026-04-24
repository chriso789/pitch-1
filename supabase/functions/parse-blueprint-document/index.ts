// Orchestrates blueprint parsing: extract text per page -> classify -> geometry -> specs -> link details.
// Uses unpdf (Deno-compatible) instead of pdfjs-dist to avoid native canvas.node dependency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .update({ status: "classifying", status_message: "extracting page text" })
      .eq("id", document_id);

    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from("blueprints").download(doc.file_path);
    if (dlErr || !pdfBlob) throw new Error(`download failed: ${dlErr?.message}`);

    const arrayBuf = await pdfBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    // Load PDF and extract per-page text
    const pdf = await getDocumentProxy(bytes);
    const pageCount: number = pdf.numPages;

    const { text: pagesText } = await extractText(pdf, { mergePages: false });
    const textArr: string[] = Array.isArray(pagesText) ? pagesText : [String(pagesText)];

    await supabase.from("plan_documents").update({ page_count: pageCount }).eq("id", document_id);

    const rows = [];
    for (let i = 1; i <= pageCount; i++) {
      const rawText = (textArr[i - 1] || "").slice(0, 8000);
      rows.push({
        tenant_id: doc.tenant_id,
        document_id,
        page_number: i,
        width_px: null,
        height_px: null,
        raw_text: rawText,
      });
    }
    const { error: insErr } = await supabase.from("plan_pages").upsert(rows, {
      onConflict: "document_id,page_number",
    });
    if (insErr) throw new Error(`insert pages failed: ${insErr.message}`);

    // Chain to classifier (non-blocking)
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
    return new Response(JSON.stringify({ error: (e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)) || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
