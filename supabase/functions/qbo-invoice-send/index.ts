import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { 
      invoice_id, 
      tenant_id,
      allow_credit_card = true,
      allow_ach = true,
      send_email = false 
    } = await req.json();

    if (!invoice_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing invoice_id or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get QBO connection
    const { data: connection } = await supabase
      .from('qbo_connections')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: 'No active QuickBooks connection' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get invoice mirror to find QBO invoice ID
    const { data: invoiceMirror } = await supabase
      .from('invoice_ar_mirror')
      .select('qbo_invoice_id')
      .eq('id', invoice_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (!invoiceMirror) {
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qboInvoiceId = invoiceMirror.qbo_invoice_id;

    // First, fetch the current invoice to get sync token
    const fetchResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/invoice/${qboInvoiceId}?minorversion=75`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Failed to fetch invoice: ${errorText}`);
    }

    const fetchData = await fetchResponse.json();
    const invoice = fetchData.Invoice;

    // Update invoice with online payment flags
    const updatePayload = {
      ...invoice,
      AllowOnlineCreditCardPayment: allow_credit_card,
      AllowOnlineACHPayment: allow_ach,
      sparse: true, // Sparse update - only update specified fields
    };

    const updateResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/invoice?minorversion=75`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update invoice: ${errorText}`);
    }

    const updateData = await updateResponse.json();
    const updatedInvoice = updateData.Invoice;

    // Optionally send email via QBO
    if (send_email) {
      const sendResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/invoice/${qboInvoiceId}/send?minorversion=75`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/octet-stream',
          },
        }
      );

      if (!sendResponse.ok) {
        const errorText = await sendResponse.text();
        console.error('Failed to send invoice email:', errorText);
        // Don't fail the whole request if email fails
      }
    }

    console.log(`Invoice ${updatedInvoice.DocNumber} updated with online payment settings`);

    return new Response(
      JSON.stringify({
        success: true,
        qbo_invoice_id: updatedInvoice.Id,
        doc_number: updatedInvoice.DocNumber,
        allow_credit_card: updatedInvoice.AllowOnlineCreditCardPayment,
        allow_ach: updatedInvoice.AllowOnlineACHPayment,
        email_sent: send_email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-invoice-send:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
