// Scans roof_plan and detail_sheet pages for callouts like "5/A4.2" and links them to target pages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Matches patterns like 5/A4.2, 12/S1.0, A/A-501, 3/A2
const CALLOUT_RE = /\b([A-Z0-9]{1,3})\/([A-Z]{1,3}[-]?\d+(?:\.\d+)?)\b/g;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pages } = await supabase.from("plan_pages")
      .select("id, tenant_id, raw_text, sheet_number, page_type")
      .eq("document_id", document_id);

    const sheetIndex = new Map<string, string>();
    for (const p of pages || []) {
      if (p.sheet_number) sheetIndex.set(p.sheet_number.toUpperCase(), p.id);
    }

    const refRows: any[] = [];
    for (const p of pages || []) {
      if (!p.raw_text) continue;
      const seen = new Set<string>();
      let m;
      while ((m = CALLOUT_RE.exec(p.raw_text)) !== null) {
        const callout = m[0];
        if (seen.has(callout)) continue;
        seen.add(callout);
        const target = sheetIndex.get(m[2].toUpperCase()) || null;
        refRows.push({
          tenant_id: p.tenant_id,
          document_id,
          source_page_id: p.id,
          target_page_id: target,
          callout_text: callout,
          target_sheet_number: m[2],
          confidence: target ? 0.85 : 0.4,
        });
      }
    }

    if (refRows.length) await supabase.from("plan_detail_refs").insert(refRows);

    await supabase.from("plan_documents").update({
      status: "ready_for_review",
      status_message: `linked ${refRows.length} callouts`,
    }).eq("id", document_id);

    return new Response(JSON.stringify({ success: true, refs: refRows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("link-blueprint-details error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
