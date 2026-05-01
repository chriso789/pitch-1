
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function bufferToDataUrl(arrayBuffer: ArrayBuffer, mimeType: string): string {
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK)) as any);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// Try to download a private storage object using the service role key
// when given either a public URL or a signed URL pointing at our Supabase storage.
async function tryServiceRoleDownload(documentUrl: string): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return null;

    // Match /storage/v1/object/{public|sign|authenticated}/{bucket}/{path}
    const m = documentUrl.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
    if (!m) return null;
    const bucket = m[1];
    const path = decodeURIComponent(m[2]);

    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
    });
    if (!resp.ok) {
      console.log(`[parse-invoice] service-role download failed: ${resp.status}`);
      return null;
    }
    const mimeType = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const buf = await resp.arrayBuffer();
    return { dataUrl: bufferToDataUrl(buf, mimeType), mimeType };
  } catch (e) {
    console.log("[parse-invoice] service-role download error:", (e as Error).message);
    return null;
  }
}

async function fetchDocumentAsDataUrl(documentUrl: string): Promise<{ dataUrl: string; mimeType: string }> {
  const response = await fetch(documentUrl);
  if (!response.ok) {
    // Fallback: attempt service-role download for private buckets
    const fallback = await tryServiceRoleDownload(documentUrl);
    if (fallback) return fallback;
    throw new Error(`Failed to fetch document: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Manual base64 encoding for Deno compatibility
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  const mimeType = contentType.split(";")[0].trim();
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
}

function isPdf(url: string, mimeType?: string): boolean {
  if (mimeType?.includes("pdf")) return true;
  return url.toLowerCase().endsWith(".pdf");
}

function isImage(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(png|jpe?g|webp|gif)(\?.*)?$/.test(lower);
}

Deno.serve(async (req) => {
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

    // Determine how to send the document to the vision model
    let imageContent: { type: string; image_url: { url: string } };

    if (isImage(document_url)) {
      // Images can be sent directly as URLs
      imageContent = { type: "image_url", image_url: { url: document_url } };
    } else {
      // PDFs and other formats: download and send as base64 data URL
      console.log("[parse-invoice] Non-image format detected, converting to base64 data URL");
      const { dataUrl } = await fetchDocumentAsDataUrl(document_url);
      imageContent = { type: "image_url", image_url: { url: dataUrl } };
    }

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
            content: `You are an expert invoice/quote data extraction assistant for the construction and roofing industry. You process invoices and quotes from suppliers like Beacon Roofing Supply, ABC Supply, SRS Distribution, GAF, and similar vendors. Extract ALL data precisely:
- Read every line item including description, quantity, unit price, and extended/line total
- Capture the SUBTOTAL (before tax), TAX amount, and GRAND TOTAL (after tax) separately
- CRITICAL: total_amount MUST be the final grand total INCLUDING tax — never the subtotal
- If the document shows Subtotal, Tax, and Total lines, use the Total line for total_amount
- Identify the vendor/company name from the header or letterhead
- Find the invoice/quote number (may be labeled as Invoice #, Inv #, Quote #, Document #, etc.)
- Find the invoice/quote date
- Be precise with dollar amounts — never round, use exact values from the document
- If a field is not visible or cannot be determined, return null for it`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all invoice data from this document: the vendor name, invoice number, invoice date, every line item (description, quantity, unit price, line total), subtotal, tax, and total amount."
              },
              imageContent
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice_data",
              description: "Extract structured invoice data including line items from the document",
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
                  vendor_name: {
                    type: "string",
                    description: "The vendor or company name on the invoice (e.g. Beacon Roofing Supply)"
                  },
                  line_items: {
                    type: "array",
                    description: "All individual line items on the invoice",
                    items: {
                      type: "object",
                      properties: {
                        description: {
                          type: "string",
                          description: "Product or service description"
                        },
                        quantity: {
                          type: "number",
                          description: "Quantity ordered"
                        },
                        unit_price: {
                          type: "number",
                          description: "Price per unit in dollars"
                        },
                        line_total: {
                          type: "number",
                          description: "Extended total for this line item in dollars"
                        }
                      },
                      required: ["description"]
                    }
                  },
                  subtotal: {
                    type: "number",
                    description: "Subtotal before tax in dollars"
                  },
                  tax_amount: {
                    type: "number",
                    description: "Tax amount in dollars"
                  },
                  total_amount: {
                    type: "number",
                    description: "Grand total of the invoice in dollars (the final amount due)"
                  }
                },
                required: ["vendor_name", "total_amount"]
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
      console.warn("[parse-invoice] No tool call in response, returning empty");
      return new Response(
        JSON.stringify({ parsed: null, message: "Could not extract invoice data" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    
    // Backward compat: also set invoice_amount from total_amount
    if (parsed.total_amount && !parsed.invoice_amount) {
      parsed.invoice_amount = parsed.total_amount;
    }
    
    console.log("[parse-invoice] Extracted:", JSON.stringify(parsed));

    return new Response(
      JSON.stringify({ parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[parse-invoice] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error), parsed: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
