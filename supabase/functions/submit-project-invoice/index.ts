import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { 
      project_id,
      invoice_type,
      vendor_name,
      crew_name,
      invoice_number,
      invoice_date,
      invoice_amount,
      document_url,
      document_name,
      notes
    } = await req.json();

    if (!project_id || !invoice_type || !invoice_amount) {
      throw new Error('project_id, invoice_type, and invoice_amount are required');
    }

    if (!['material', 'labor'].includes(invoice_type)) {
      throw new Error('invoice_type must be "material" or "labor"');
    }

    console.log(`[submit-project-invoice] Submitting ${invoice_type} invoice for project: ${project_id}`);

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User has no tenant');
    }

    // Get project's pipeline_entry_id
    const { data: project } = await supabase
      .from('projects')
      .select('pipeline_entry_id')
      .eq('id', project_id)
      .single();

    // Create invoice record
    const { data: invoice, error: invoiceError } = await supabase
      .from('project_cost_invoices')
      .insert({
        tenant_id: profile.tenant_id,
        project_id,
        pipeline_entry_id: project?.pipeline_entry_id,
        invoice_type,
        vendor_name: vendor_name || null,
        crew_name: crew_name || null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date || null,
        invoice_amount: parseFloat(invoice_amount),
        document_url: document_url || null,
        document_name: document_name || null,
        notes: notes || null,
        status: 'pending',
        created_by: user.id
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('[submit-project-invoice] Error creating invoice:', invoiceError);
      throw new Error('Failed to create invoice record');
    }

    console.log(`[submit-project-invoice] Created invoice: ${invoice.id}`);

    // Calculate new totals from all invoices
    const { data: allInvoices } = await supabase
      .from('project_cost_invoices')
      .select('invoice_type, invoice_amount')
      .eq('project_id', project_id)
      .in('status', ['pending', 'approved']);

    const materialTotal = (allInvoices || [])
      .filter(inv => inv.invoice_type === 'material')
      .reduce((sum, inv) => sum + parseFloat(inv.invoice_amount), 0);

    const laborTotal = (allInvoices || [])
      .filter(inv => inv.invoice_type === 'labor')
      .reduce((sum, inv) => sum + parseFloat(inv.invoice_amount), 0);

    // Update reconciliation with new actual costs
    const { data: reconciliation, error: reconError } = await supabase
      .from('project_cost_reconciliation')
      .update({
        actual_material_cost: materialTotal,
        actual_labor_cost: laborTotal,
        status: 'in_progress',
        updated_at: new Date().toISOString()
      })
      .eq('project_id', project_id)
      .select()
      .single();

    if (reconError) {
      console.error('[submit-project-invoice] Error updating reconciliation:', reconError);
      // Don't fail - reconciliation might not exist yet
    }

    // Update production workflow status
    await supabase
      .from('production_workflows')
      .update({
        cost_verification_status: 'in_progress'
      })
      .eq('project_id', project_id);

    console.log(`[submit-project-invoice] Updated reconciliation - Materials: $${materialTotal}, Labor: $${laborTotal}`);

    return new Response(
      JSON.stringify({
        success: true,
        invoice,
        reconciliation,
        totals: {
          material: materialTotal,
          labor: laborTotal
        },
        message: 'Invoice submitted successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[submit-project-invoice] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
