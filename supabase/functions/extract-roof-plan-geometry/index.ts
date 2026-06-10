// Extracts roof-plan dimensions + pitch labels.
// - Accepts { document_id } OR { page_id }.
// - Uses raw_text when meaningful; otherwise falls back to vision on the
//   rasterized page image (image_path in `blueprint-pages` bucket).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VISION_MODEL = "google/gemini-2.5-flash";
const TEXT_MODEL = "google/gemini-3-flash-preview";

const TOOL = {
  type: "function" as const,
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
        pitch_notes: { type: "array", items: { type: "string" } },
        scale_text: { type: "string" },
      },
      required: ["dimensions", "pitch_notes"],
      additionalProperties: false,
    },
  },
};

async function callGateway(messages: any[], model: string) {
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "extract_roof_data" } },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`AI gateway ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : { dimensions: [], pitch_notes: [] };
}

async function extractFromText(text: string) {
  return callGateway(
    [
      { role: "system", content: "Extract roof-plan dimensions and pitch labels from raw page text. Output via tool call." },
      { role: "user", content: text || "(no text)" },
    ],
    TEXT_MODEL,
  );
}

async function extractFromImage(imageUrl: string) {
  return callGateway(
    [
      { role: "system", content: "You are reading a roof framing/roof plan sheet. Extract every visible dimension callout (e.g. 24'-6\", 12'), and every pitch label (e.g. 6/12, 8:12). Return via the tool call." },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all dimensions and pitch labels from this roof plan." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    VISION_MODEL,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id, page_id } = await req.json();
    if (!document_id && !page_id) {
      return new Response(JSON.stringify({ error: "document_id or page_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let pagesQuery = supabase.from("plan_pages")
      .select("id, tenant_id, document_id, raw_text, page_number, image_path, page_type");
    if (page_id) {
      pagesQuery = pagesQuery.eq("id", page_id);
    } else {
      pagesQuery = pagesQuery.eq("document_id", document_id).eq("page_type", "roof_plan");
    }
    const { data: pages, error: pErr } = await pagesQuery;
    if (pErr) throw pErr;
    if (!pages?.length) {
      return new Response(JSON.stringify({ success: true, dimensions: 0, pages: 0, note: "no matching pages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docId = document_id || pages[0].document_id;
    let totalDims = 0;
    let totalPitch = 0;
    const perPage: any[] = [];

    for (const p of pages) {
      const summary: any = { page_id: p.id, page_number: p.page_number, source: null, dims: 0, pitch: 0 };
      try {
        const text = (p.raw_text || "").trim();
        let out: any = { dimensions: [], pitch_notes: [] };

        if (text.length > 60) {
          out = await extractFromText(text);
          summary.source = "text";
        }

        const textDims = (out.dimensions || []).length;
        const textPitch = (out.pitch_notes || []).length;

        // Vision fallback when text is empty/sparse or yielded nothing
        if ((!summary.source || (textDims === 0 && textPitch === 0)) && p.image_path) {
          const { data: signed, error: sErr } = await supabase.storage
            .from("blueprint-pages")
            .createSignedUrl(p.image_path, 600);
          if (sErr) throw sErr;
          if (signed?.signedUrl) {
            out = await extractFromImage(signed.signedUrl);
            summary.source = "vision";
          }
        }

        if (!summary.source) {
          summary.source = "none";
          summary.reason = "no_text_no_image";
        }

        const dimRows = (out.dimensions || []).map((d: any) => ({
          tenant_id: p.tenant_id,
          page_id: p.id,
          label_text: d.label_text,
          normalized_feet: d.normalized_feet ?? null,
          confidence: summary.source === "vision" ? 0.7 : 0.6,
        }));
        if (dimRows.length) {
          await supabase.from("plan_dimensions").insert(dimRows);
          totalDims += dimRows.length;
          summary.dims = dimRows.length;
        }
        if (out.pitch_notes?.length) {
          await supabase.from("plan_pages").update({
            metadata: { pitch_notes: out.pitch_notes, scale_text: out.scale_text ?? null },
          }).eq("id", p.id);
          totalPitch += out.pitch_notes.length;
          summary.pitch = out.pitch_notes.length;
        }
      } catch (e: any) {
        summary.error = e?.message || String(e);
        console.error(`geometry page ${p.page_number} failed`, summary.error);
      }
      perPage.push(summary);
    }

    if (docId) {
      await supabase.from("plan_documents").update({
        status: "extracting_specs",
        status_message: `recorded ${totalDims} dimensions, ${totalPitch} pitch notes`,
      }).eq("id", docId);
    }

    return new Response(JSON.stringify({
      success: true,
      dimensions: totalDims,
      pitch_notes: totalPitch,
      pages: pages.length,
      per_page: perPage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("extract-roof-plan-geometry error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
