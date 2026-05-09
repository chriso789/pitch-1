const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { document_base64, mime_type } = await req.json();
    if (!document_base64 || !mime_type) {
      return new Response(JSON.stringify({ error: "document_base64 and mime_type are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const dataUrl = `data:${mime_type};base64,${document_base64}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You extract supplier price-list / pricebook tables from PDFs and images for the roofing & construction industry. Read EVERY row in the price list — do not summarize, do not skip. For each row capture: sku (supplier or manufacturer item code), description (full product description), category (Shingles, Underlayment, Metal, Accessories, Vents, Fasteners, Adhesives, Coatings, Tools, Other), brand (manufacturer e.g. GAF, Owens Corning, CertainTeed, Atlas, Carlisle, etc.), uom (unit of measure: SQ, BDL, ROLL, EA, BX, LF, GAL, etc.), price (agreed unit price in dollars, numeric only — strip $ and commas). If a value isn't present, return null for that field. Never invent SKUs or prices.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract every row from this supplier price list." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_price_list",
              description: "Extract structured supplier price-list rows.",
              parameters: {
                type: "object",
                properties: {
                  supplier_name: { type: ["string", "null"] },
                  rows: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        sku: { type: ["string", "null"] },
                        description: { type: "string" },
                        category: { type: ["string", "null"] },
                        brand: { type: ["string", "null"] },
                        uom: { type: ["string", "null"] },
                        price: { type: ["number", "null"] },
                      },
                      required: ["description"],
                    },
                  },
                },
                required: ["rows"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_price_list" } },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway error: ${res.status} ${txt}`);
    }

    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : { rows: [] };

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
