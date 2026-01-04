import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
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
    const { document_id, contact_id, project_id, estimate_id } = body;

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "document_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Merging document ${document_id} with contact ${contact_id}`);

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
    console.log(`Found ${tagPlacements.length} tag placements`);

    // Build context data for tag resolution
    const context: Record<string, any> = {};

    // Fetch contact data if provided
    if (contact_id) {
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contact_id)
        .single();

      if (contact && !contactError) {
        context.contact = contact;
        console.log(`Loaded contact: ${contact.first_name} ${contact.last_name}`);
      }
    }

    // Fetch project data if provided
    if (project_id) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", project_id)
        .single();

      if (project && !projectError) {
        context.project = project;
      }
    }

    // Fetch estimate data if provided
    if (estimate_id) {
      const { data: estimate, error: estimateError } = await supabase
        .from("estimates")
        .select("*")
        .eq("id", estimate_id)
        .single();

      if (estimate && !estimateError) {
        context.estimate = estimate;
      }
    }

    // Fetch tenant/company data
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", document.tenant_id)
      .single();

    if (tenant && !tenantError) {
      context.company = tenant;
    }

    // Resolve tag values
    const resolvedTags: Record<string, string> = {};
    for (const placement of tagPlacements) {
      const value = resolveTagValue(placement.tag_key, context);
      resolvedTags[placement.tag_key] = value;
    }

    console.log("Resolved tags:", resolvedTags);

    // For now, return the resolved data
    // Full PDF generation with overlay would require a PDF library
    // This could be enhanced to use pdf-lib or similar
    
    // Get signed URL for original document
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("smartdoc-assets")
      .createSignedUrl(document.file_path, 3600);

    if (signedUrlError) {
      console.error("Error creating signed URL:", signedUrlError);
      return new Response(
        JSON.stringify({ error: "Failed to access document" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the merge event
    await supabase.from("audit_log").insert({
      table_name: "documents",
      record_id: document_id,
      action: "MERGE_TAGS",
      changed_by: userData.user.id,
      tenant_id: document.tenant_id,
      new_values: {
        contact_id,
        resolved_tags: resolvedTags,
        tag_count: tagPlacements.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        document_id,
        original_url: signedUrlData.signedUrl,
        pdf_url: signedUrlData.signedUrl, // For now, return original
        resolved_tags: resolvedTags,
        tag_placements: tagPlacements,
        message: tagPlacements.length > 0
          ? `Merged ${tagPlacements.length} tags`
          : "No tags to merge, returning original document",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in merge-document-tags:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function resolveTagValue(tagKey: string, context: Record<string, any>): string {
  const parts = tagKey.split(".");
  if (parts.length < 2) return `{{${tagKey}}}`;

  const [category, ...fieldParts] = parts;
  const field = fieldParts.join(".");

  // Handle special "today" category
  if (category === "today") {
    const now = new Date();
    switch (field) {
      case "date":
        return now.toLocaleDateString();
      case "date_long":
        return now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      case "year":
        return now.getFullYear().toString();
      default:
        return now.toLocaleDateString();
    }
  }

  const data = context[category];
  if (!data) return `{{${tagKey}}}`;

  // Handle special computed fields
  if (category === "contact" && field === "full_name") {
    const firstName = data.first_name || "";
    const lastName = data.last_name || "";
    return `${firstName} ${lastName}`.trim() || `{{${tagKey}}}`;
  }

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
    // Check if it looks like currency
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
