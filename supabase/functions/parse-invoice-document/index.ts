import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { document_url } = await req.json();

    if (!document_url) {
      return new Response(
        JSON.stringify({ error: "document_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("Missing LOVABLE_API_KEY");
    }

    console.log("[parse-invoice] Extracting data from:", document_url);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an invoice data extraction assistant. Extract structured data from invoice documents. Be precise with numbers and dates. If you cannot determine a field, return null for it.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the invoice number, invoice date, total amount, and vendor name from this invoice document."
              },
              {
                type: "image_url",
                image_url: { url: document_url }
              }
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice_data",
              description: "Extract structured invoice data from the document",
              parameters: {
                type: "object",
                properties: {
                  invoice_number: {
                    type: "string",
                    description: "The invoice number or ID from the document"
                  },
                  invoice_date: {
                    type: "string",
                    description: "The invoice date in YYYY-MM-DD format"
                  },
                  invoice_amount: {
                    type: "number",
                    description: "The total amount of the invoice in dollars (numeric only, no currency symbols)"
                  },
                  vendor_name: {
                    type: "string",
                    description: "The vendor or company name on the invoice"
                  }
                },
                required: ["invoice_number", "invoice_date", "invoice_amount", "vendor_name"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice_data" } },
        temperature: 0.1,
      }),
    });

    if (res.status === 429) {
      return new Response(
        JSON.stringify({ error: "AI rate limited - please try again later" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (res.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted - please add funds" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error(`[parse-invoice] Gateway error ${res.status}: ${txt}`);
      throw new Error(`AI gateway error ${res.status}`);
    }

    const json = await res.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      // Fallback: try to parse from content
      console.warn("[parse-invoice] No tool call in response, returning empty");
      return new Response(
        JSON.stringify({ parsed: null, message: "Could not extract invoice data" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    console.log("[parse-invoice] Extracted:", JSON.stringify(parsed));

    return new Response(
      JSON.stringify({ parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[parse-invoice] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message, parsed: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
