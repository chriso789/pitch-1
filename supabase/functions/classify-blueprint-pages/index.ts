// Classifies each plan_pages row using Lovable AI Gateway (text-based for now).
// Updates page_type, sheet_name, sheet_number, scale_text on each page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function classifyPage(text: string): Promise<any> {
  const sys = `You classify a single page from an architectural blueprint PDF. Output ONLY via the tool call.`;
  const user = `Raw text from one PDF page (may be partial):\n\n${text || "(no text)"}\n\nClassify this page.`;
  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    tools: [{
      type: "function",
      function: {
        name: "classify_page",
        description: "Return structured classification for a blueprint page",
        parameters: {
          type: "object",
          properties: {
            page_type: {
              type: "string",
              enum: ["roof_plan","detail_sheet","specification_sheet","section_sheet","schedule_sheet","cover_sheet","framing_plan","irrelevant","unknown"],
            },
            confidence: { type: "number" },
            sheet_name: { type: "string" },
            sheet_number: { type: "string" },
            scale_text: { type: "string" },
            summary: { type: "string" },
          },
          required: ["page_type", "confidence"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "classify_page" } },
  };
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`AI gateway ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : { page_type: "unknown", confidence: 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pages, error } = await supabase
      .from("plan_pages").select("id, raw_text, page_number")
      .eq("document_id", document_id).order("page_number");
    if (error) throw error;

    const results: any[] = [];
    for (const p of pages || []) {
      try {
        const cls = await classifyPage(p.raw_text || "");
        await supabase.from("plan_pages").update({
          page_type: cls.page_type,
          page_type_confidence: cls.confidence,
          sheet_name: cls.sheet_name || null,
          sheet_number: cls.sheet_number || null,
          scale_text: cls.scale_text || null,
          ai_summary: cls.summary || null,
        }).eq("id", p.id);
        results.push({ page: p.page_number, ...cls });
      } catch (e: any) {
        console.error(`page ${p.page_number} classify failed`, (e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)));
      }
    }

    await supabase.from("plan_documents").update({
      status: "extracting_geometry",
      status_message: `classified ${results.length} pages`,
    }).eq("id", document_id);

    // Chain to geometry extractor
    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    fetch(`${baseUrl}/functions/v1/extract-roof-plan-geometry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ document_id }),
    }).catch((e) => console.error("geometry chain failed", e));

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("classify-blueprint-pages error", e);
    return new Response(JSON.stringify({ error: (e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)) || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
