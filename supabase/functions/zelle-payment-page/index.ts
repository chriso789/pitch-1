import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // POST = customer notifying they sent payment
    if (req.method === 'POST') {
      const { token, action } = await req.json();

      if (!token || action !== 'notify_sent') {
        return new Response(
          JSON.stringify({ error: 'Invalid request' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update payment link status to pending_verification
      const { data: paymentLink, error: linkError } = await supabase
        .from('payment_links')
        .update({ 
          zelle_confirmation_status: 'pending_verification',
          updated_at: new Date().toISOString()
        })
        .eq('shareable_token', token)
        .eq('payment_type', 'zelle')
        .eq('status', 'active')
        .select('id, tenant_id, invoice_id, amount, pipeline_entry_id')
        .single();

      if (linkError || !paymentLink) {
        return new Response(
          JSON.stringify({ error: 'Payment link not found or already processed' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Broadcast real-time notification to the tenant
      const channel = supabase.channel(`zelle-notification-${paymentLink.tenant_id}`);
      await channel.send({
        type: 'broadcast',
        event: 'zelle_payment_sent',
        payload: {
          payment_link_id: paymentLink.id,
          invoice_id: paymentLink.invoice_id,
          amount: paymentLink.amount,
          pipeline_entry_id: paymentLink.pipeline_entry_id,
        },
      });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // GET = fetch payment details
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up payment link by shareable token
    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .select('*')
      .eq('shareable_token', token)
      .eq('payment_type', 'zelle')
      .single();

    if (linkError || !paymentLink) {
      return new Response(
        JSON.stringify({ error: 'Payment link not found or expired' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get tenant settings for Zelle info
    const { data: tenantSettings } = await supabase
      .from('tenant_settings')
      .select('zelle_email, zelle_phone, zelle_display_name, zelle_instructions, zelle_enabled')
      .eq('tenant_id', paymentLink.tenant_id)
      .single();

    if (!tenantSettings?.zelle_enabled) {
      return new Response(
        JSON.stringify({ error: 'Zelle payments are not enabled for this company' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get company name from tenants table
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', paymentLink.tenant_id)
      .single();

    // Get invoice number if linked
    let invoiceNumber = null;
    if (paymentLink.invoice_id) {
      const { data: invoice } = await supabase
        .from('project_invoices')
        .select('invoice_number')
        .eq('id', paymentLink.invoice_id)
        .single();
      invoiceNumber = invoice?.invoice_number;
    }

    return new Response(
      JSON.stringify({
        amount: paymentLink.amount,
        currency: paymentLink.currency,
        description: paymentLink.description,
        status: paymentLink.zelle_confirmation_status || 'pending',
        company_name: tenant?.name || tenantSettings.zelle_display_name || 'Company',
        zelle_email: tenantSettings.zelle_email,
        zelle_phone: tenantSettings.zelle_phone,
        zelle_display_name: tenantSettings.zelle_display_name,
        zelle_instructions: tenantSettings.zelle_instructions,
        invoice_number: invoiceNumber,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Error in Zelle payment page:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
