// Stub: for each roof_plan page, extract geometry (outline, ridges, hips, valleys, eaves, rakes, dimensions).
// True CAD-style geometry extraction is a heavy CV task; this stub uses AI vision on text + records
// any pitch/dimension labels found in raw_text. Geometry vectorization is a follow-up phase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function extractDimensionsAndPitch(text: string): Promise<any> {
  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: "Extract roof-plan dimensions and pitch labels from raw page text. Output via tool call." },
      { role: "user", content: text || "(no text)" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "extract_roof_data",
        parameters: {
          type: "object",
          properties: {
            dimensions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label_text: { type: "string" },
                  normalized_feet: { type: "number" },
                },
                required: ["label_text"],
                additionalProperties: false,
              },
            },
            pitch_notes: {
              type: "array",
              items: { type: "string" },
            },
            scale_text: { type: "string" },
          },
          required: ["dimensions", "pitch_notes"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "extract_roof_data" } },
  };
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`AI gateway ${r.status}`);
  const j = await r.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : { dimensions: [], pitch_notes: [] };
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
      .select("id, tenant_id, raw_text, page_number")
      .eq("document_id", document_id)
      .eq("page_type", "roof_plan");

    let total = 0;
    for (const p of pages || []) {
      try {
        const out = await extractDimensionsAndPitch(p.raw_text || "");
        const dimRows = (out.dimensions || []).map((d: any) => ({
          tenant_id: p.tenant_id,
          page_id: p.id,
          label_text: d.label_text,
          normalized_feet: d.normalized_feet ?? null,
          confidence: 0.6,
        }));
        if (dimRows.length) {
          await supabase.from("plan_dimensions").insert(dimRows);
          total += dimRows.length;
        }
        // Persist pitch notes as page metadata
        if (out.pitch_notes?.length) {
          await supabase.from("plan_pages").update({
            metadata: { pitch_notes: out.pitch_notes },
          }).eq("id", p.id);
        }
      } catch (e: any) {
        console.error(`geometry page ${p.page_number} failed`, (e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)));
      }
    }

    await supabase.from("plan_documents").update({
      status: "extracting_specs",
      status_message: `recorded ${total} dimensions`,
    }).eq("id", document_id);

    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    fetch(`${baseUrl}/functions/v1/extract-blueprint-specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ document_id }),
    }).catch((e) => console.error("specs chain failed", e));

    return new Response(JSON.stringify({ success: true, dimensions: total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("extract-roof-plan-geometry error", e);
    return new Response(JSON.stringify({ error: (e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)) || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
