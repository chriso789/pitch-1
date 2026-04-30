import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_TEXT_CHARS = 120_000;

function bufferToDataUrl(arrayBuffer: ArrayBuffer, mimeType: string): string {
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK)) as any);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function tryServiceRoleDownload(documentUrl: string): Promise<{ arrayBuffer: ArrayBuffer; mimeType: string } | null> {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return null;
    const m = documentUrl.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
    if (!m) return null;
    const bucket = m[1];
    const path = decodeURIComponent(m[2]);
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
    });
    if (!resp.ok) return null;
    const mimeType = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const buf = await resp.arrayBuffer();
    return { arrayBuffer: buf, mimeType };
  } catch {
    return null;
  }
}

async function fetchDocument(documentUrl: string): Promise<{ arrayBuffer: ArrayBuffer; mimeType: string }> {
  const response = await fetch(documentUrl);
  if (!response.ok) {
    const fallback = await tryServiceRoleDownload(documentUrl);
    if (fallback) return fallback;
    throw new Error(`Failed to fetch document: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  return { arrayBuffer, mimeType: contentType.split(";")[0].trim() };
}

async function extractPdfPagesText(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  const pageCount = pdf.numPages || 0;
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text || "")];
  const combined = pages
    .map((page, index) => `--- PAGE ${index + 1} ---\n${String(page || "").trim()}`)
    .join("\n\n")
    .trim();
  return { text: combined.slice(0, MAX_TEXT_CHARS), pageCount };
}

function isImage(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?.*)?$/.test(url.toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { document_url } = await req.json();
    if (!document_url) {
      return new Response(JSON.stringify({ error: "document_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    console.log("[parse-supplier-quote] Parsing:", document_url);

    let documentText = "";
    let mediaContent: any | null = null;
    let pageCount = 0;
    if (isImage(document_url)) {
      mediaContent = { type: "image_url", image_url: { url: document_url } };
    } else {
      const { arrayBuffer, mimeType } = await fetchDocument(document_url);
      if (mimeType === "application/pdf" || document_url.toLowerCase().includes(".pdf")) {
        const extracted = await extractPdfPagesText(arrayBuffer);
        documentText = extracted.text;
        pageCount = extracted.pageCount;
        console.log(`[parse-supplier-quote] Extracted PDF text from ${pageCount} pages (${documentText.length} chars)`);
        if (!documentText) {
          mediaContent = { type: "image_url", image_url: { url: bufferToDataUrl(arrayBuffer, mimeType) } };
        }
      } else {
        mediaContent = { type: "image_url", image_url: { url: bufferToDataUrl(arrayBuffer, mimeType) } };
      }
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an expert at extracting MATERIAL LINE ITEMS from MULTI-PAGE supplier quotes for the construction and roofing industry — especially METAL ROOFING quotes from suppliers like Worthouse, Sheffield Metals, McElroy Metal, ABC Supply, Beacon, SRS Distribution, etc.

CRITICAL — MULTI-PAGE HANDLING:
- The PDF may contain MULTIPLE PAGES. You MUST scan EVERY page from first to last.
- Line items often continue across page breaks. Treat the document as ONE continuous list.
- If the same SKU/description appears on multiple pages with the same unit price, COMBINE them into ONE line with summed quantity. If unit prices differ, keep them as separate lines.
- Do NOT stop after the first page. Do NOT skip pages. Capture EVERY material row across ALL pages.
- Headers/footers/page numbers repeat per page — ignore those, but never skip the items.

EXTRACTION RULES:
- Extract EVERY material line item: panels, ridge cap, hip cap, eave/rake trim, valley metal, underlayment, fasteners, screws, sealant, closures, pipe boots, snow guards, vents, flashing, etc.
- For each line capture: description (verbatim from quote), sku/part number if present, quantity, unit (panel, piece, roll, box, lf, sq, ea), unit_price, line_total
- IGNORE labor lines, taxes, shipping, freight, fees, discounts — materials only
- Capture vendor name, quote number, quote date, subtotal, tax, total (from final summary page)
- Use exact dollar amounts — never round
- Return null for fields you cannot determine`,
          },
          {
            role: "user",
            content: documentText
              ? `Extract every material line item from this supplier quote text. It was extracted from ${pageCount || "multiple"} PDF pages — scan ALL page sections first to last and return the complete combined list of materials with quantities and unit prices.\n\n${documentText}`
              : [
                  { type: "text", text: "Extract every material line item from this supplier quote. The PDF may have multiple pages — scan ALL pages first to last and return the complete combined list of materials with quantities and unit prices." },
                  mediaContent,
                ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_supplier_quote",
              description: "Extract structured material line items from a supplier quote",
              parameters: {
                type: "object",
                properties: {
                  vendor_name: { type: "string" },
                  quote_number: { type: "string" },
                  quote_date: { type: "string", description: "YYYY-MM-DD" },
                  line_items: {
                    type: "array",
                    description: "Material line items only — exclude labor/tax/shipping",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        sku: { type: "string" },
                        quantity: { type: "number" },
                        unit: { type: "string", description: "e.g. panel, piece, roll, box, lf, sq, ea" },
                        unit_price: { type: "number" },
                        line_total: { type: "number" },
                      },
                      required: ["description"],
                    },
                  },
                  subtotal: { type: "number" },
                  tax_amount: { type: "number" },
                  total_amount: { type: "number" },
                },
                required: ["line_items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_supplier_quote" } },
        temperature: 0.1,
        max_tokens: 8192,
      }),
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "AI rate limited - please try again later" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted - please add funds" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[parse-supplier-quote] Gateway error ${res.status}: ${txt}`);
      throw new Error(`AI gateway error ${res.status}`);
    }

    const json = await res.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ parsed: null, message: "Could not extract quote data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    console.log(`[parse-supplier-quote] Extracted ${parsed?.line_items?.length || 0} items from ${parsed?.vendor_name || "unknown vendor"}`);

    return new Response(JSON.stringify({ parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[parse-supplier-quote] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error), parsed: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
