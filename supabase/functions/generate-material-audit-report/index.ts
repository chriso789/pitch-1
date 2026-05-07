import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2.49.4/cors";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { auditId, format } = await req.json();
    if (!auditId) return new Response(JSON.stringify({ error: "auditId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load audit + lines
    const { data: audit } = await supabase.from("material_invoice_audits").select("*").eq("id", auditId).single();
    if (!audit) return new Response(JSON.stringify({ error: "Audit not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: auditLines } = await supabase.from("material_invoice_audit_lines").select("*").eq("audit_id", auditId).order("created_at");
    const { data: invoice } = await supabase.from("material_invoice_documents").select("*").eq("id", audit.invoice_document_id).single();
    const { data: supplier } = await supabase.from("material_suppliers").select("*").eq("id", audit.supplier_id).single();

    // Build CSV
    const csvHeader = "Line,Supplier SKU,Description,Qty,UOM,Agreed Price,Charged Price,Expected Total,Charged Total,Difference,Discrepancy";
    const csvRows = (auditLines || []).map((l: any, i: number) => {
      return [
        i + 1, l.supplier_sku || "", `"${(l.invoice_description || "").replace(/"/g, '""')}"`,
        l.quantity, l.invoice_uom || "", l.agreed_unit_price ?? "", l.charged_unit_price ?? "",
        l.expected_extended_price ?? "", l.charged_extended_price ?? "", l.total_difference ?? "",
        l.discrepancy_type,
      ].join(",");
    });
    const csvContent = [csvHeader, ...csvRows].join("\n");

    // Upload CSV
    const csvPath = `material-audit-reports/${audit.company_id}/${audit.supplier_id}/${auditId}.csv`;
    await supabase.storage.from("documents").upload(csvPath, new Blob([csvContent], { type: "text/csv" }), { upsert: true });
    const csvUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/documents/${csvPath}`;

    // Build text report (PDF generation would require a library - returning structured data for frontend PDF)
    const reportData = {
      supplier: supplier?.supplier_name || "Unknown",
      invoiceNumber: invoice?.invoice_number || "N/A",
      invoiceDate: audit.invoice_date || "N/A",
      priceListId: audit.price_list_id,
      totalOvercharge: audit.total_overcharge_amount,
      totalUndercharge: audit.total_undercharge_amount,
      matchedLines: audit.matched_lines,
      unmatchedLines: audit.unmatched_lines,
      lines: auditLines,
      creditRequestLetter: `Please review the attached material price audit.\n\nOur active agreed price list shows the listed materials should have been billed at the agreed unit prices shown in the report. The invoice appears to include overcharges totaling $${Number(audit.total_overcharge_amount || 0).toFixed(2)}.\n\nPlease issue a credit memo for the difference or provide written explanation for any line item you believe was billed correctly.`,
    };

    // Update audit with report URLs
    await supabase.from("material_invoice_audits").update({ csv_file_url: csvUrl }).eq("id", auditId);

    return new Response(JSON.stringify({
      success: true, csvUrl, reportData,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
