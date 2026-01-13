import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TagPlacement {
  id: string;
  tag_key: string;
  page_number: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  font_size: number;
  font_family: string;
  text_align: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { document_id, pipeline_entry_id } = body;

    if (!document_id || !pipeline_entry_id) {
      return new Response(
        JSON.stringify({ error: "document_id and pipeline_entry_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[render-tagged-pdf] Rendering document ${document_id} for pipeline entry ${pipeline_entry_id}`);

    // Fetch document details
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, filename, file_path, mime_type, tenant_id")
      .eq("id", document_id)
      .single();

    if (docError || !document) {
      console.error("Document not found:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch tag placements
    const { data: placements, error: placementsError } = await supabase
      .from("document_tag_placements")
      .select("*")
      .eq("document_id", document_id);

    if (placementsError) {
      console.error("Error fetching placements:", placementsError);
    }

    const tagPlacements: TagPlacement[] = placements || [];
    console.log(`[render-tagged-pdf] Found ${tagPlacements.length} tag placements`);

    // Build context from pipeline entry
    const context = await buildContext(supabase, pipeline_entry_id, document.tenant_id);
    console.log("[render-tagged-pdf] Context built:", Object.keys(context));

    // Resolve tag values
    const resolvedTags: Record<string, string> = {};
    for (const placement of tagPlacements) {
      const value = resolveTagValue(placement.tag_key, context);
      resolvedTags[placement.tag_key] = value;
      console.log(`[render-tagged-pdf] ${placement.tag_key} => ${value}`);
    }

    // Download the original PDF
    console.log(`[render-tagged-pdf] Downloading PDF from: ${document.file_path}`);
    
    // Try different buckets since the document might be in smartdoc-assets or documents
    let pdfBytes: ArrayBuffer | null = null;
    const buckets = ["smartdoc-assets", "documents", "company-documents"];
    
    for (const bucket of buckets) {
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(bucket)
          .download(document.file_path);
        
        if (!downloadError && fileData) {
          pdfBytes = await fileData.arrayBuffer();
          console.log(`[render-tagged-pdf] Downloaded from bucket: ${bucket}`);
          break;
        }
      } catch (e) {
        console.log(`[render-tagged-pdf] Not in bucket ${bucket}`);
      }
    }

    if (!pdfBytes) {
      console.error("[render-tagged-pdf] Could not download PDF from any bucket");
      return new Response(
        JSON.stringify({ error: "Could not download original PDF" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load and modify the PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    console.log(`[render-tagged-pdf] PDF has ${pages.length} pages`);

    // Draw text at each tag placement
    for (const placement of tagPlacements) {
      const pageIndex = (placement.page_number || 1) - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) {
        console.warn(`[render-tagged-pdf] Invalid page number ${placement.page_number} for tag ${placement.tag_key}`);
        continue;
      }

      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const text = resolvedTags[placement.tag_key] || "";
      
      if (!text || text.startsWith("{{")) {
        console.log(`[render-tagged-pdf] Skipping unresolved tag: ${placement.tag_key}`);
        continue;
      }

      const fontSize = placement.font_size || 12;
      
      // Convert coordinates - PDF uses bottom-left origin, stored coords use top-left
      // The y_position from placements is from top, we need to convert to bottom
      const x = placement.x_position || 0;
      const y = pageHeight - (placement.y_position || 0) - fontSize;

      console.log(`[render-tagged-pdf] Drawing "${text}" at (${x}, ${y}) on page ${pageIndex + 1}`);

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // Save the modified PDF
    const modifiedPdfBytes = await pdfDoc.save();
    console.log(`[render-tagged-pdf] Generated PDF with ${modifiedPdfBytes.byteLength} bytes`);

    // Return the PDF as base64
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(modifiedPdfBytes)));

    return new Response(
      JSON.stringify({
        success: true,
        pdfBase64: base64Pdf,
        filename: document.filename,
        resolvedTags,
        tagCount: tagPlacements.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[render-tagged-pdf] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function buildContext(supabase: any, pipelineEntryId: string, tenantId: string): Promise<Record<string, any>> {
  const context: Record<string, any> = {};

  try {
    // Fetch pipeline entry with contact
    const { data: entry } = await supabase
      .from("pipeline_entries")
      .select(`
        *,
        contacts(*)
      `)
      .eq("id", pipelineEntryId)
      .single();

    if (entry) {
      context.lead = entry;
      if (entry.contacts) {
        const c = entry.contacts;
        context.contact = {
          ...c,
          // Map address fields for compatibility
          address: c.address_street,
          city: c.address_city,
          state: c.address_state,
          zip: c.address_zip,
          full_name: [c.first_name, c.last_name].filter(Boolean).join(" "),
          full_address: [c.address_street, c.address_city, c.address_state, c.address_zip].filter(Boolean).join(", "),
        };
      }
    }

    // Fetch project if exists
    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("pipeline_entry_id", pipelineEntryId)
      .maybeSingle();

    if (project) {
      context.project = project;
    }

    // Fetch job if exists
    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("pipeline_entry_id", pipelineEntryId)
      .maybeSingle();

    if (job) {
      context.job = job;
    }

    // Fetch estimates
    const { data: estimates } = await supabase
      .from("enhanced_estimates")
      .select("*")
      .eq("pipeline_entry_id", pipelineEntryId)
      .order("created_at", { ascending: false });

    if (estimates && estimates.length > 0) {
      context.estimate = estimates[0];
      context.estimates = estimates;
    }

    // Fetch tenant/company info
    const { data: tenant } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .single();

    if (tenant) {
      context.company = {
        ...tenant,
        address: [tenant.address_street, tenant.address_city, tenant.address_state, tenant.address_zip].filter(Boolean).join(", "),
      };
    }

    // Add dates
    context.today = {
      date: new Date().toLocaleDateString(),
      date_long: new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      year: new Date().getFullYear().toString(),
    };

  } catch (error) {
    console.error("[buildContext] Error:", error);
  }

  return context;
}

function resolveTagValue(tagKey: string, context: Record<string, any>): string {
  const parts = tagKey.split(".");
  if (parts.length < 2) return `{{${tagKey}}}`;

  const [category, ...fieldParts] = parts;
  const field = fieldParts.join(".");

  const data = context[category];
  if (!data) return `{{${tagKey}}}`;

  // Handle nested field paths
  let value = data;
  for (const part of fieldParts) {
    if (value && typeof value === "object" && part in value) {
      value = value[part];
    } else {
      return `{{${tagKey}}}`;
    }
  }

  if (value === null || value === undefined) {
    return `{{${tagKey}}}`;
  }

  // Format value based on type
  if (typeof value === "number") {
    if (field.includes("total") || field.includes("amount") || field.includes("price")) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
    }
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  return String(value);
}
