// Extracts roofing system specs and installation requirements from spec/detail/notes pages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function extractSpecs(text: string): Promise<any> {
  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: "Extract roofing system specifications and installation requirements from the page text. Output via tool call." },
      { role: "user", content: text || "(no text)" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "extract_specs",
        parameters: {
          type: "object",
          properties: {
            specs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", description: "underlayment, fasteners, flashing, ventilation, manufacturer_product, code_reference, system_type, deck_type, attachment, wind_requirement, other" },
                  key_name: { type: "string" },
                  value_text: { type: "string" },
                },
                required: ["category", "key_name", "value_text"],
                additionalProperties: false,
              },
            },
          },
          required: ["specs"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "extract_specs" } },
  };
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`AI gateway ${r.status}`);
  const j = await r.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : { specs: [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pages } = await supabase.from("plan_pages")
      .select("id, tenant_id, raw_text, page_number, page_type")
      .eq("document_id", document_id)
      .in("page_type", ["specification_sheet", "detail_sheet", "schedule_sheet", "cover_sheet"]);

    let total = 0;
    for (const p of pages || []) {
      try {
        const out = await extractSpecs(p.raw_text || "");
        const rows = (out.specs || []).map((s: any) => ({
          tenant_id: p.tenant_id,
          document_id,
          page_id: p.id,
          category: s.category,
          key_name: s.key_name,
          value_text: s.value_text,
          confidence: 0.65,
        }));
        if (rows.length) {
          await supabase.from("plan_specs").insert(rows);
          total += rows.length;
        }
      } catch (e: any) {
        console.error(`specs page ${p.page_number} failed`, e?.message);
      }
    }

    await supabase.from("plan_documents").update({
      status: "linking_details",
      status_message: `recorded ${total} spec entries`,
    }).eq("id", document_id);

    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    fetch(`${baseUrl}/functions/v1/link-blueprint-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ document_id }),
    }).catch((e) => console.error("link chain failed", e));

    return new Response(JSON.stringify({ success: true, specs: total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("extract-blueprint-specs error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
