import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2.49.4/cors";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { auditId, submittedTo } = await req.json();
    if (!auditId) return new Response(JSON.stringify({ error: "auditId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: audit } = await supabase.from("material_invoice_audits").select("*").eq("id", auditId).single();
    if (!audit) return new Response(JSON.stringify({ error: "Audit not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: supplier } = await supabase.from("material_suppliers").select("*").eq("id", audit.supplier_id).single();
    const { data: invoice } = await supabase.from("material_invoice_documents").select("invoice_number").eq("id", audit.invoice_document_id).single();

    const claimNumber = `CRD-${Date.now().toString(36).toUpperCase()}`;
    const overchargeAmt = Number(audit.total_overcharge_amount || 0).toFixed(2);

    const emailSubject = `Material Price Discrepancy - Credit Request - Invoice ${invoice?.invoice_number || "N/A"} - $${overchargeAmt}`;
    const emailBody = `Dear ${supplier?.supplier_name || "Supplier"} Team,\n\nPlease review the attached material price audit for Invoice ${invoice?.invoice_number || "N/A"}.\n\nOur active agreed price list shows the listed materials should have been billed at the agreed unit prices shown in the report. The invoice appears to include overcharges totaling $${overchargeAmt}.\n\nPlease issue a credit memo for the difference or provide written explanation for any line item you believe was billed correctly.\n\nClaim Reference: ${claimNumber}\n\nThank you.`;

    const { data: claim, error: claimErr } = await supabase.from("material_supplier_credit_claims").insert({
      company_id: audit.company_id,
      supplier_id: audit.supplier_id,
      audit_id: auditId,
      claim_number: claimNumber,
      claim_status: "draft",
      total_claim_amount: audit.total_overcharge_amount || 0,
      submitted_to: submittedTo || null,
      email_subject: emailSubject,
      email_body: emailBody,
      report_file_url: audit.report_file_url,
      csv_file_url: audit.csv_file_url,
    }).select("*").single();

    if (claimErr) throw claimErr;

    await supabase.from("material_price_audit_events").insert({
      company_id: audit.company_id, supplier_id: audit.supplier_id, audit_id: auditId,
      event_type: "credit_claim_created",
      event_message: `Credit claim ${claimNumber} created for $${overchargeAmt}`,
      created_by: user.id,
    });

    return new Response(JSON.stringify({ success: true, claim }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
