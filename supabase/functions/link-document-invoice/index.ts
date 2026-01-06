import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LinkDocumentInvoiceRequest {
  document_id: string;
  pipeline_entry_id: string;
  invoice_type: 'material' | 'labor';
  invoice_amount: number;
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  notes?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's tenant
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: LinkDocumentInvoiceRequest = await req.json();
    const { 
      document_id, 
      pipeline_entry_id, 
      invoice_type, 
      invoice_amount, 
      vendor_name,
      invoice_number,
      invoice_date,
      notes 
    } = body;

    // Validate required fields
    if (!document_id || !pipeline_entry_id || !invoice_type || !invoice_amount) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: document_id, pipeline_entry_id, invoice_type, invoice_amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!['material', 'labor'].includes(invoice_type)) {
      return new Response(
        JSON.stringify({ error: "invoice_type must be 'material' or 'labor'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get document to verify it exists and get file info
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, filename, file_path, tenant_id")
      .eq("id", document_id)
      .single();

    if (docError || !document) {
      console.error("Document not found:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify tenant access
    if (document.tenant_id !== profile.tenant_id) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get public URL for document
    let documentUrl = document.file_path;
    if (!documentUrl.startsWith('http')) {
      const { data: urlData } = supabase.storage
        .from("documents")
        .getPublicUrl(document.file_path);
      documentUrl = urlData?.publicUrl || document.file_path;
    }

    // Create invoice record in project_cost_invoices
    const { data: invoice, error: invoiceError } = await supabase
      .from("project_cost_invoices")
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipeline_entry_id,
        invoice_type: invoice_type,
        invoice_amount: invoice_amount,
        vendor_name: vendor_name || null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date || new Date().toISOString().split('T')[0],
        document_url: documentUrl,
        document_name: document.filename,
        notes: notes || null,
        status: 'verified',
        created_by: user.id,
      })
      .select()
      .single();

    if (invoiceError) {
      console.error("Error creating invoice:", invoiceError);
      return new Response(
        JSON.stringify({ error: "Failed to create invoice record", details: invoiceError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update the document with invoice link and metadata
    const newDocType = invoice_type === 'material' ? 'invoice_material' : 'invoice_labor';
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        linked_invoice_id: invoice.id,
        invoice_amount: invoice_amount,
        vendor_name: vendor_name || null,
        invoice_number: invoice_number || null,
        document_type: newDocType,
      })
      .eq("id", document_id);

    if (updateError) {
      console.error("Error updating document:", updateError);
      // Invoice was created, so we still return success but note the issue
    }

    console.log(`Successfully linked document ${document_id} to invoice ${invoice.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        invoice_id: invoice.id,
        document_id: document_id,
        message: "Document linked to invoice successfully" 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in link-document-invoice:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
