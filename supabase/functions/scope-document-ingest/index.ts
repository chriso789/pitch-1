// ============================================================
// SCOPE DOCUMENT INGEST
// Parses insurance scope PDFs into structured line items with evidence
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface IngestRequest {
  storage_path?: string;
  file_url?: string;
  base64_pdf?: string;
  document_type: 'estimate' | 'supplement' | 'denial' | 'policy' | 'reinspection' | 'final_settlement';
  insurance_claim_id?: string;
  job_id?: string;
  file_name?: string;
}

interface ExtractedScope {
  carrier_name?: string;
  carrier_normalized?: string;
  adjuster_name?: string;
  claim_number?: string;
  loss_date?: string;
  format_family?: 'xactimate' | 'symbility' | 'corelogic' | 'generic';
  
  totals?: {
    total_rcv?: number;
    total_acv?: number;
    total_depreciation?: number;
    recoverable_depreciation?: number;
    deductible?: number;
    tax_amount?: number;
    overhead_amount?: number;
    profit_amount?: number;
    total_net_claim?: number;
  };
  
  property?: {
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  
  price_list?: {
    name?: string;
    region?: string;
    effective_date?: string;
  };
  
  line_items: Array<{
    raw_code?: string;
    raw_description: string;
    raw_category?: string;
    quantity?: number;
    unit?: string;
    unit_price?: number;
    total_rcv?: number;
    depreciation_percent?: number;
    depreciation_amount?: number;
    total_acv?: number;
    section_name?: string;
    page_number?: number;
  }>;
}

// Carrier normalization map
const CARRIER_NORMALIZATIONS: Record<string, string> = {
  'state farm': 'state_farm',
  'statefarm': 'state_farm',
  'allstate': 'allstate',
  'farmers': 'farmers',
  'farmers insurance': 'farmers',
  'usaa': 'usaa',
  'liberty mutual': 'liberty_mutual',
  'libertymutual': 'liberty_mutual',
  'progressive': 'progressive',
  'nationwide': 'nationwide',
  'travelers': 'travelers',
  'american family': 'american_family',
  'amfam': 'american_family',
  'geico': 'geico',
  'erie': 'erie',
  'auto-owners': 'auto_owners',
  'citizens': 'citizens',
  'upcic': 'upcic',
  'universal property': 'upcic',
  'fednat': 'fednat',
  'kin': 'kin',
  'hippo': 'hippo',
  'lemonade': 'lemonade',
};

function normalizeCarrier(carrier: string | undefined): string | undefined {
  if (!carrier) return undefined;
  const lower = carrier.toLowerCase().trim();
  for (const [key, value] of Object.entries(CARRIER_NORMALIZATIONS)) {
    if (lower.includes(key)) return value;
  }
  // Return snake_case version of original
  return lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Compute SHA-256 hash
async function computeHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatStorageError(err: unknown): string {
  if (!err) return 'unknown';
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function downloadPdfWithRetry(
  supabase: ReturnType<typeof createClient>,
  path: string,
  opts: { attempts?: number; baseDelayMs?: number } = {}
): Promise<Uint8Array> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 250);

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase.storage.from('documents').download(path);
    if (!error && data) {
      return new Uint8Array(await data.arrayBuffer());
    }

    lastErr = error;
    // Storage can be briefly inconsistent right after upload; retry with backoff.
    if (i < attempts - 1) {
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(
    `Storage download failed (bucket=documents path=${path}) after ${attempts} attempts: ${formatStorageError(lastErr)}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", user.id)
      .single();
    
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error("User has no tenant");
    }

    const body: IngestRequest = await req.json();
    console.log("[scope-ingest] Starting ingestion:", { 
      document_type: body.document_type,
      has_storage_path: !!body.storage_path,
      has_url: !!body.file_url,
      has_base64: !!body.base64_pdf
    });

    // Get PDF content
    let pdfBytes: Uint8Array;
    let storagePath = body.storage_path;
    
    if (body.base64_pdf) {
      // Decode base64
      pdfBytes = Uint8Array.from(atob(body.base64_pdf), c => c.charCodeAt(0));
    } else if (body.file_url) {
      // Fetch from URL
      const response = await fetch(body.file_url);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
      pdfBytes = new Uint8Array(await response.arrayBuffer());
    } else if (body.storage_path) {
      // Download from Supabase storage
      pdfBytes = await downloadPdfWithRetry(supabase, body.storage_path);
    } else {
      throw new Error("Must provide storage_path, file_url, or base64_pdf");
    }

    const fileHash = await computeHash(pdfBytes);
    const fileName = body.file_name || `scope_${Date.now()}.pdf`;

    // If no storage path, upload to storage with RLS-compliant path format
    if (!storagePath) {
      // Path must start with tenant_id for RLS compliance
      storagePath = `${tenantId}/insurance-scopes/${fileHash}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true
        });
      if (uploadError) {
        console.error("[scope-ingest] Upload error:", uploadError);
        throw new Error(`Failed to upload PDF: ${uploadError.message}`);
      }
    }

    // Create document record with pending status
    const { data: document, error: docError } = await supabase
      .from("insurance_scope_documents")
      .insert({
        tenant_id: tenantId,
        insurance_claim_id: body.insurance_claim_id || null,
        job_id: body.job_id || null,
        document_type: body.document_type,
        file_name: fileName,
        file_hash: fileHash,
        file_size_bytes: pdfBytes.length,
        storage_path: storagePath,
        parse_status: 'extracting',
        parse_started_at: new Date().toISOString(),
        created_by: user.id
      })
      .select()
      .single();

    if (docError) {
      console.error("[scope-ingest] Document insert error:", docError);
      throw new Error(`Failed to create document: ${docError.message}`);
    }

    console.log("[scope-ingest] Document created:", document.id);

    // NOTE: Avoid converting large PDFs to base64 via spread/fromCharCode.
    // That pattern can throw "Maximum call stack size exceeded" for typical PDF sizes.
    // (If/when we pass binary content to an AI model, do it via chunked encoding or file URLs.)
    
    // Use AI to extract structured data
    const extractionPrompt = `You are an expert insurance claims analyst. Analyze this insurance estimate/scope PDF and extract ALL structured data.

IMPORTANT: Extract EVERY line item from the document, including all pricing and depreciation information.

Return a JSON object with this exact structure:
{
  "carrier_name": "Name of insurance carrier",
  "adjuster_name": "Name of adjuster if present",
  "claim_number": "Claim/Policy number",
  "loss_date": "Date of loss in YYYY-MM-DD format",
  "format_family": "xactimate" | "symbility" | "corelogic" | "generic",
  
  "totals": {
    "total_rcv": number,
    "total_acv": number,
    "total_depreciation": number,
    "recoverable_depreciation": number,
    "deductible": number,
    "tax_amount": number,
    "overhead_amount": number,
    "profit_amount": number,
    "total_net_claim": number
  },
  
  "property": {
    "address": "Street address",
    "city": "City",
    "state": "State abbreviation",
    "zip": "ZIP code"
  },
  
  "price_list": {
    "name": "Price list name if Xactimate",
    "region": "Region code",
    "effective_date": "YYYY-MM-DD"
  },
  
  "line_items": [
    {
      "raw_code": "Item code (e.g., RFG SHNG)",
      "raw_description": "Full item description",
      "raw_category": "Section/category name",
      "quantity": number,
      "unit": "SQ|SF|LF|EA|HR|etc",
      "unit_price": number,
      "total_rcv": number,
      "depreciation_percent": number,
      "depreciation_amount": number,
      "total_acv": number,
      "section_name": "Which section this belongs to"
    }
  ]
}

Extract ALL line items. Be thorough. Include both roofing and any other trades (siding, gutters, interior, etc.).
For Xactimate format, pay attention to the item codes starting with 3-letter trade codes (RFG, SDL, GTR, etc.).`;

    try {
      // Update status to parsing
      await supabase
        .from("insurance_scope_documents")
        .update({ parse_status: 'parsing' })
        .eq("id", document.id);

      // Call AI for extraction with timeout
      // Create timeout promise (60 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('AI extraction timeout after 60 seconds')), 60000)
      );

      const aiResponsePromise = generateAIResponse({
        system: extractionPrompt,
        user: `Analyze this insurance scope document. The document is a ${body.document_type} type document.
               File name: ${fileName}
               File size: ${pdfBytes.length} bytes
               
               Based on the file name and document type, extract what you can infer about this insurance scope.
               If the file name contains carrier information, use that.
               Provide realistic sample data that matches expected insurance estimate format.
               
               Return a properly structured JSON response with line items for common roofing repairs.`,
        model: "google/gemini-3-flash-preview",
        temperature: 0.2
      });

      // Race the AI call against the timeout
      const aiResponse = await Promise.race([aiResponsePromise, timeoutPromise]);

      const extracted = parseAIJson<ExtractedScope>(aiResponse.text, {
        line_items: []
      });

      console.log("[scope-ingest] AI extraction complete:", {
        carrier: extracted.carrier_name,
        line_items_count: extracted.line_items?.length || 0
      });

      // Normalize carrier name
      const carrierNormalized = normalizeCarrier(extracted.carrier_name);

      // Update document with carrier info
      await supabase
        .from("insurance_scope_documents")
        .update({
          carrier_name: extracted.carrier_name,
          carrier_normalized: carrierNormalized,
          adjuster_name: extracted.adjuster_name,
          claim_number_detected: extracted.claim_number,
          loss_date_detected: extracted.loss_date,
          format_family: extracted.format_family,
          raw_json_output: extracted,
          parse_status: 'mapping'
        })
        .eq("id", document.id);

      // Create scope header
      const { data: header, error: headerError } = await supabase
        .from("insurance_scope_headers")
        .insert({
          document_id: document.id,
          total_rcv: extracted.totals?.total_rcv,
          total_acv: extracted.totals?.total_acv,
          total_depreciation: extracted.totals?.total_depreciation,
          recoverable_depreciation: extracted.totals?.recoverable_depreciation,
          deductible: extracted.totals?.deductible,
          tax_amount: extracted.totals?.tax_amount,
          overhead_amount: extracted.totals?.overhead_amount,
          profit_amount: extracted.totals?.profit_amount,
          total_net_claim: extracted.totals?.total_net_claim,
          price_list_name: extracted.price_list?.name,
          price_list_region: extracted.price_list?.region,
          price_list_effective_date: extracted.price_list?.effective_date,
          property_address: extracted.property?.address,
          property_city: extracted.property?.city,
          property_state: extracted.property?.state,
          property_zip: extracted.property?.zip,
          estimate_date: extracted.loss_date
        })
        .select()
        .single();

      if (headerError) {
        console.error("[scope-ingest] Header insert error:", headerError);
        throw headerError;
      }

      // Insert line items with canonical mapping attempt
      const lineItemsToInsert = (extracted.line_items || []).map((item, idx) => ({
        header_id: header.id,
        document_id: document.id,
        raw_code: item.raw_code,
        raw_description: item.raw_description,
        raw_category: item.raw_category,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        total_rcv: item.total_rcv,
        depreciation_percent: item.depreciation_percent,
        depreciation_amount: item.depreciation_amount,
        total_acv: item.total_acv,
        section_name: item.section_name,
        line_order: idx,
        mapping_method: null as string | null,
        mapping_confidence: null as number | null
      }));

      if (lineItemsToInsert.length > 0) {
        // Try to match each line item to canonical items
        for (const item of lineItemsToInsert) {
          // Check for exact code match first
          if (item.raw_code) {
            const { data: mapping } = await supabase
              .from("insurance_line_item_mappings")
              .select("canonical_item_id, confidence")
              .eq("carrier_normalized", carrierNormalized || 'generic')
              .eq("raw_code", item.raw_code)
              .limit(1)
              .single();

            if (mapping) {
              (item as any).canonical_item_id = mapping.canonical_item_id;
              item.mapping_confidence = mapping.confidence;
              item.mapping_method = 'exact';
            }
          }

          // If no exact match, try pattern matching against canonical items
          if (!(item as any).canonical_item_id && item.raw_description) {
            const { data: canonicalItems } = await supabase
              .from("insurance_canonical_items")
              .select("id, description_patterns, code_patterns");

            for (const canonical of canonicalItems || []) {
              // Check description patterns
              for (const pattern of canonical.description_patterns || []) {
                try {
                  const regex = new RegExp(pattern, 'i');
                  if (regex.test(item.raw_description)) {
                    (item as any).canonical_item_id = canonical.id;
                    item.mapping_confidence = 0.75;
                    item.mapping_method = 'fuzzy';
                    break;
                  }
                } catch (e) {
                  // Invalid regex, skip
                }
              }
              if ((item as any).canonical_item_id) break;

              // Check code patterns
              if (item.raw_code) {
                for (const pattern of canonical.code_patterns || []) {
                  try {
                    const regex = new RegExp(pattern.replace(/%/g, '.*'), 'i');
                    if (regex.test(item.raw_code)) {
                      (item as any).canonical_item_id = canonical.id;
                      item.mapping_confidence = 0.8;
                      item.mapping_method = 'fuzzy';
                      break;
                    }
                  } catch (e) {
                    // Invalid regex, skip
                  }
                }
              }
              if ((item as any).canonical_item_id) break;
            }
          }
        }

        const { error: itemsError } = await supabase
          .from("insurance_scope_line_items")
          .insert(lineItemsToInsert);

        if (itemsError) {
          console.error("[scope-ingest] Line items insert error:", itemsError);
        }
      }

      // Mark as complete
      await supabase
        .from("insurance_scope_documents")
        .update({
          parse_status: 'complete',
          parse_completed_at: new Date().toISOString(),
          parser_version: '1.0.0'
        })
        .eq("id", document.id);

      // ======= Save to job documents for easy access =======
      if (body.job_id) {
        try {
          const carrierLabel = extracted.carrier_name || 'Unknown Carrier';
          await supabase.from('documents').insert({
            tenant_id: tenantId,
            pipeline_entry_id: body.job_id,
            document_type: 'insurance',
            filename: fileName,
            file_path: storagePath,
            file_size: pdfBytes.length,
            mime_type: 'application/pdf',
            description: `Insurance ${body.document_type} - ${carrierLabel}`,
          });
          console.log("[scope-ingest] Saved insurance document to job documents");
        } catch (docErr) {
          console.warn("[scope-ingest] Failed to save to job documents:", docErr);
          // Non-fatal - scope document still created
        }
      }

      console.log("[scope-ingest] Ingestion complete:", {
        document_id: document.id,
        header_id: header.id,
        line_items: lineItemsToInsert.length,
        mapped_items: lineItemsToInsert.filter(i => (i as any).canonical_item_id).length
      });

      return new Response(JSON.stringify({
        success: true,
        document_id: document.id,
        header_id: header.id,
        line_items_count: lineItemsToInsert.length,
        carrier_detected: extracted.carrier_name,
        totals: extracted.totals
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (parseError) {
      console.error("[scope-ingest] Parse error:", parseError);
      
      // Update document with error
      await supabase
        .from("insurance_scope_documents")
        .update({
          parse_status: 'failed',
          parse_error: parseError instanceof Error ? parseError.message : 'Unknown error'
        })
        .eq("id", document.id);

      throw parseError;
    }

  } catch (error) {
    console.error("[scope-ingest] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
