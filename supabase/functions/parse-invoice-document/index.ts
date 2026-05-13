import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// Canonicalize supplier names so all variants of "ABC Supply", "SRS / Suncoast", etc.
// collapse to a single supplier row. Mirrors src/pages/MaterialAuditPage.tsx.
function canonicalizeVendorName(raw: string): { key: string; display: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { key: "unknown", display: "Unknown" };
  const lower = trimmed.toLowerCase();
  if (/\bsrs\b|suncoast roofers|srs building/.test(lower)) {
    return { key: "srs", display: "SRS / Suncoast Roofers Supply" };
  }
  if (/\babc supply\b|abc roof/.test(lower)) {
    return { key: "abc-supply", display: "ABC Supply" };
  }
  if (/\bbeacon\b/.test(lower)) {
    return { key: "beacon", display: "Beacon Roofing Supply" };
  }
  if (/home depot/.test(lower)) return { key: "home-depot", display: "Home Depot" };
  if (/\blowes?\b|lowe's/.test(lower)) return { key: "lowes", display: "Lowe's" };
  if (/\bgaf\b/.test(lower)) return { key: "gaf", display: "GAF" };
  return { key: lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), display: trimmed };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DocumentBytes = { arrayBuffer: ArrayBuffer; mimeType: string };
type InvoiceLineItem = {
  description: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
  unit_of_measure?: string;
};

function toMoney(value?: string | null): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[$,\s]/g, "");
  const negative = /^\(.+\)$/.test(cleaned);
  const numeric = Number(cleaned.replace(/[()]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return negative ? -numeric : numeric;
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null;
  const mdy = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!mdy) return value;
  const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
  return `${year}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
}

function extractTextInvoiceFallback(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = lines.join("\n");
  const vendorName = lines.find((line) => /\b(GAF|Beacon|ABC|SRS|QXO|supplier|supply|distribution|roofing)\b/i.test(line)) || lines[0] || "Supplier";
  const invoiceNumber = joined.match(/(?:invoice|quote|estimate|document|order)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-.]+)/i)?.[1] || null;
  const invoiceDate = normalizeDate(joined.match(/(?:invoice|quote|estimate)?\s*date\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] || joined.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)?.[1]);
  const subtotal = toMoney(joined.match(/\bsub\s*total\b\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i)?.[1]);
  const taxAmount = toMoney(joined.match(/\btax\b\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i)?.[1]);
  const totalMatches = [...joined.matchAll(/\b(?:grand\s+total|total\s+amount|amount\s+due|total)\b\s*[:\-]?\s*\$?([\d,]+\.\d{2})/gi)];
  const totalAmount = toMoney(totalMatches.at(-1)?.[1]) || subtotal || 0;
  const lineItems: InvoiceLineItem[] = [];
  for (const line of lines) {
    if (/\b(sub\s*total|tax|grand\s+total|amount\s+due|balance|terms|page)\b/i.test(line)) continue;
    const amountMatches = [...line.matchAll(/\$?([\d,]+\.\d{2})/g)];
    if (!amountMatches.length) continue;
    const lineTotal = toMoney(amountMatches.at(-1)?.[1]);
    if (!lineTotal || lineTotal <= 0) continue;
    const qtyMatch = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(EA|SQ|BDL|LF|FT|HR|ROLL|GAL|PC|PCS|BOX|BAG)\b/i);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    const unitOfMeasure = qtyMatch?.[2]?.toUpperCase() || "EA";
    const unitPrice = amountMatches.length > 1 ? toMoney(amountMatches.at(-2)?.[1]) : lineTotal / quantity;
    const description = line
      .replace(/\$?[\d,]+\.\d{2}/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(EA|SQ|BDL|LF|FT|HR|ROLL|GAL|PC|PCS|BOX|BAG)\b/i, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (description.length >= 4) lineItems.push({ description, quantity, unit_price: unitPrice, line_total: lineTotal, unit_of_measure: unitOfMeasure });
  }
  return { invoice_number: invoiceNumber, invoice_date: invoiceDate, vendor_name: vendorName, line_items: lineItems.slice(0, 100), subtotal, tax_amount: taxAmount, total_amount: totalAmount, invoice_amount: totalAmount, extraction_method: "pdf_text_fallback" };
}

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
async function tryServiceRoleDownload(documentUrl: string): Promise<DocumentBytes | null> {
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
    const arrayBuffer = await resp.arrayBuffer();
    return { arrayBuffer, mimeType };
  } catch (e) {
    console.log("[parse-invoice] service-role download error:", (e as Error).message);
    return null;
  }
}

async function fetchDocumentAsBytes(documentUrl: string): Promise<DocumentBytes> {
  const response = await fetch(documentUrl);
  if (!response.ok) {
    // Fallback: attempt service-role download for private buckets
    const fallback = await tryServiceRoleDownload(documentUrl);
    if (fallback) return fallback;
    throw new Error(`Failed to fetch document: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = contentType.split(";")[0].trim();
  return { arrayBuffer, mimeType };
}

async function extractPdfInvoiceText(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text || "")];
    return pages
      .map((page, index) => `--- Page ${index + 1} ---\n${String(page || "").trim()}`)
      .join("\n\n")
      .slice(0, 70000);
  } finally {
    await pdf.destroy?.();
  }
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
    const body = await req.json();
    const { document_url, auto_persist, pipeline_entry_id, project_id, source_file_name } = body || {};
    let tenant_id: string | null = body?.tenant_id || null;

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

    let userContent: Array<Record<string, unknown>>;
    let pdfTextFallback: string | null = null;

    if (isImage(document_url)) {
      // Images can be sent directly as URLs
      userContent = [
        {
          type: "text",
          text: "Extract all invoice data from this document image: the vendor name, invoice number, invoice date, every line item (description, quantity, unit price, line total), subtotal, tax, and total amount."
        },
        { type: "image_url", image_url: { url: document_url } }
      ];
    } else {
      console.log("[parse-invoice] Non-image format detected, extracting PDF text");
      const { arrayBuffer, mimeType } = await fetchDocumentAsBytes(document_url);

      if (isPdf(document_url, mimeType)) {
        const extractedText = await extractPdfInvoiceText(arrayBuffer);
        if (!extractedText.trim()) {
          throw new Error("No readable text found in PDF. Please upload a text-based supplier invoice or add line items manually.");
        }
        pdfTextFallback = extractedText;
        userContent = [
          {
            type: "text",
            text: `Extract all invoice data from this PDF text: the vendor name, invoice number, invoice date, every line item (description, quantity, unit price, line total), subtotal, tax, and total amount.\n\n${extractedText}`
          }
        ];
      } else {
        const dataUrl = bufferToDataUrl(arrayBuffer, mimeType);
        userContent = [
          {
            type: "text",
            text: "Extract all invoice data from this document: the vendor name, invoice number, invoice date, every line item (description, quantity, unit price, line total), subtotal, tax, and total amount."
          },
          { type: "image_url", image_url: { url: dataUrl } }
        ];
      }
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
            content: userContent
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
                    description: "All individual line items on the invoice. For each item, also try to identify roofing material attributes (brand, color, style, category) from the description text — e.g. 'GAF Timberline HDZ Charcoal' → brand: GAF, style: Timberline HDZ, color: Charcoal, category: shingles.",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string", description: "Product or service description as printed" },
                        quantity: { type: "number", description: "Quantity ordered" },
                        unit_price: { type: "number", description: "Price per unit in dollars" },
                        line_total: { type: "number", description: "Extended total for this line item in dollars" },
                        unit_of_measure: { type: "string", description: "Unit (BDL, SQ, LF, EA, ROLL, etc.) if shown" },
                        sku: { type: "string", description: "Vendor SKU / part number if shown" },
                        brand: { type: "string", description: "Manufacturer brand if identifiable (e.g. GAF, Owens Corning, CertainTeed, Malarkey, Atlas, IKO)" },
                        style: { type: "string", description: "Product line / style if identifiable (e.g. Timberline HDZ, Duration, Landmark Pro)" },
                        color: { type: "string", description: "Color name if identifiable (e.g. Charcoal, Weathered Wood, Pewter Gray, Hunter Green)" },
                        material_category: { type: "string", description: "High-level category: shingles, underlayment, ridge_cap, starter, drip_edge, vents, flashing, nails, ice_water, siding, gutters, accessories, other" }
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
                  },
                  job_number: {
                    type: "string",
                    description: "Job number, PO number, or work order # tied to the customer's project (often labeled 'Job', 'Job #', 'PO', 'Job Name', 'Order #', 'CLJ', 'Reference')."
                  },
                  customer_name: {
                    type: "string",
                    description: "Homeowner / customer / job site contact name printed on the invoice (e.g. 'Bill To', 'Sold To', 'Job Name', 'Site Contact'). Prefer the homeowner over the contractor / company being billed."
                  },
                  service_address: {
                    type: "string",
                    description: "Job site / service / delivery address (NOT the billing address of the contractor). Look for 'Ship To', 'Job Site', 'Delivery Address', 'Service Address'. Return as a single-line full street address."
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
      if (pdfTextFallback) {
        const parsed = extractTextInvoiceFallback(pdfTextFallback);
        console.log("[parse-invoice] AI credits exhausted, used PDF text fallback");
        return new Response(
          JSON.stringify({ parsed, warning: "AI credits exhausted; used basic PDF text extraction." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

    // Auto-persist + auto-audit (so the user never sees a manual "audit queue").
    let auditResult: any = null;
    if (auto_persist) {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

        // Resolve tenant from caller if not provided
        const authHeader = req.headers.get("Authorization") || "";
        if (!tenant_id && authHeader) {
          const { data: { user } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
          if (user) {
            const { data: prof } = await admin.from("profiles")
              .select("active_tenant_id, tenant_id").eq("id", user.id).maybeSingle();
            tenant_id = prof?.active_tenant_id || prof?.tenant_id || null;
          }
        }

        if (!tenant_id) {
          console.warn("[parse-invoice] auto_persist requested but tenant_id could not be resolved");
        } else {
          // 1. Resolve / create canonical supplier
          const { key: supKey, display: supDisplay } = canonicalizeVendorName(parsed.vendor_name || "");
          let supplierId: string | null = null;
          const { data: existingSupplier } = await admin.from("material_suppliers")
            .select("id").eq("company_id", tenant_id).eq("normalized_name", supKey).maybeSingle();
          if (existingSupplier) {
            supplierId = existingSupplier.id;
          } else {
            const { data: newSup, error: supErr } = await admin.from("material_suppliers")
              .insert({ company_id: tenant_id, supplier_name: supDisplay, normalized_name: supKey, status: "active" })
              .select("id").single();
            if (supErr) console.warn("[parse-invoice] supplier insert failed:", supErr.message);
            supplierId = newSup?.id || null;
          }

          // 2. Insert invoice document
          const { data: invDoc, error: invErr } = await admin.from("material_invoice_documents").insert({
            company_id: tenant_id,
            supplier_id: supplierId,
            job_id: project_id || null,
            source_file_url: document_url,
            source_file_name: source_file_name || null,
            supplier_detected_name: parsed.vendor_name || null,
            supplier_confidence: supplierId ? 0.9 : 0.3,
            invoice_number: parsed.invoice_number || null,
            invoice_date: parsed.invoice_date || null,
            subtotal: parsed.subtotal ?? null,
            tax_total: parsed.tax_amount ?? null,
            invoice_total: parsed.total_amount ?? parsed.invoice_amount ?? null,
            scrape_status: "complete",
            audit_status: supplierId ? "pending" : "needs_review",
            raw_extraction_json: parsed,
          }).select("id").single();

          if (invErr) {
            console.warn("[parse-invoice] invoice doc insert failed:", invErr.message);
          } else if (invDoc) {
            // 3. Insert line items
            const items: any[] = Array.isArray(parsed.line_items) ? parsed.line_items : [];
            if (items.length) {
              const lineRows = items.map((li: any, idx: number) => {
                const desc = String(li.description || "").replace(/\\([\"'\\])/g, "$1").trim();
                return {
                  company_id: tenant_id,
                  invoice_document_id: invDoc.id,
                  supplier_id: supplierId,
                  line_number: idx + 1,
                  supplier_sku: li.sku || null,
                  manufacturer_sku: null,
                  item_description: desc,
                  normalized_description: desc.toLowerCase().replace(/\s+/g, " "),
                  category: li.material_category || null,
                  brand: li.brand || null,
                  unit_of_measure: li.unit_of_measure || null,
                  quantity: typeof li.quantity === "number" ? li.quantity : null,
                  charged_unit_price: typeof li.unit_price === "number" ? li.unit_price : null,
                  charged_extended_price: typeof li.line_total === "number" ? li.line_total : null,
                  raw_line_json: li,
                };
              });
              const { error: linesErr } = await admin.from("material_invoice_line_items").insert(lineRows);
              if (linesErr) console.warn("[parse-invoice] line insert failed:", linesErr.message);
            }

            // 4. Auto-invoke audit (uses caller's auth so audit_run_by is correct)
            if (supplierId && items.length) {
              try {
                const auditRes = await fetch(`${SUPABASE_URL}/functions/v1/audit-material-invoice`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: authHeader || `Bearer ${SERVICE_ROLE}`,
                    apikey: SERVICE_ROLE,
                  },
                  body: JSON.stringify({ invoiceDocumentId: invDoc.id }),
                });
                auditResult = await auditRes.json();
                console.log("[parse-invoice] auto-audit:", JSON.stringify(auditResult));
              } catch (auditErr) {
                console.warn("[parse-invoice] auto-audit failed:", (auditErr as Error).message);
              }
            }

            (parsed as any).invoice_document_id = invDoc.id;
            (parsed as any).supplier_id = supplierId;
          }
        }
      } catch (persistErr) {
        console.warn("[parse-invoice] auto_persist failed:", (persistErr as Error).message);
      }
    }

    return new Response(
      JSON.stringify({ parsed, audit: auditResult }),
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
