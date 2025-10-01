import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { payment_id, tenant_id, realm_id } = await req.json();

    console.log('Syncing payment:', { payment_id, tenant_id, realm_id });

    // Get QBO connection
    const { data: connection, error: connError } = await supabaseClient
      .from('qbo_connections')
      .select('access_token, realm_id')
      .eq('tenant_id', tenant_id)
      .eq('realm_id', realm_id)
      .eq('is_active', true)
      .single();

    if (connError || !connection) {
      throw new Error('QBO connection not found');
    }

    // Fetch payment from QBO
    const qboUrl = `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/payment/${payment_id}`;
    const qboResponse = await fetch(qboUrl, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!qboResponse.ok) {
      throw new Error(`QBO API error: ${qboResponse.statusText}`);
    }

    const qboPayment = await qboResponse.json();
    const payment = qboPayment.Payment;

    console.log('Payment fetched:', payment);

    // Process each linked invoice
    for (const line of payment.Line || []) {
      if (line.LinkedTxn) {
        for (const linkedTxn of line.LinkedTxn) {
          if (linkedTxn.TxnType === 'Invoice') {
            const invoiceId = linkedTxn.TxnId;
            const appliedAmount = line.Amount || 0;

            // Find the project linked to this invoice
            const { data: mapping } = await supabaseClient
              .from('qbo_entity_mapping')
              .select('pitch_entity_id')
              .eq('tenant_id', tenant_id)
              .eq('qbo_entity_type', 'Invoice')
              .eq('qbo_entity_id', invoiceId)
              .single();

            if (mapping) {
              // Insert payment history
              await supabaseClient
                .from('qbo_payment_history')
                .insert({
                  tenant_id,
                  qbo_payment_id: payment.Id,
                  qbo_invoice_id: invoiceId,
                  project_id: mapping.pitch_entity_id,
                  payment_amount: appliedAmount,
                  payment_date: payment.TxnDate,
                  payment_method: payment.PaymentMethodRef?.name || 'Unknown',
                  qbo_customer_id: payment.CustomerRef?.value,
                  metadata: {
                    payment_ref_number: payment.PaymentRefNum,
                    total_amount: payment.TotalAmt,
                  },
                });

              // Update invoice balance in mirror table
              await updateInvoiceBalance(supabaseClient, tenant_id, realm_id, invoiceId, connection.access_token);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, payment_id: payment.Id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Payment sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function updateInvoiceBalance(
  supabase: any,
  tenantId: string,
  realmId: string,
  invoiceId: string,
  accessToken: string
) {
  const qboUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/invoice/${invoiceId}`;
  const qboResponse = await fetch(qboUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!qboResponse.ok) {
    console.error('Failed to fetch invoice from QBO');
    return;
  }

  const qboInvoice = await qboResponse.json();
  const invoice = qboInvoice.Invoice;

  // Update invoice AR mirror
  await supabase
    .from('invoice_ar_mirror')
    .update({
      balance: invoice.Balance || 0,
      total_amount: invoice.TotalAmt || 0,
      qbo_status: invoice.EmailStatus || 'Unknown',
      last_qbo_pull_at: new Date().toISOString(),
    })
    .eq('qbo_invoice_id', invoiceId)
    .eq('tenant_id', tenantId);
}
