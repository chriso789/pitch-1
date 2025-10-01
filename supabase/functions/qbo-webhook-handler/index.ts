import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from 'https://deno.land/std@0.177.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, intuit-signature',
};

const QBO_WEBHOOK_VERIFIER = Deno.env.get('QBO_WEBHOOK_VERIFIER');

interface WebhookEvent {
  realmId: string;
  name: string; // Entity type: Invoice, Payment, Customer, etc.
  id: string;
  operation: string; // Create, Update, Delete, Void
  lastUpdated: string;
}

interface WebhookPayload {
  eventNotifications: Array<{
    realmId: string;
    dataChangeEvent: {
      entities: WebhookEvent[];
    };
  }>;
}

function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!QBO_WEBHOOK_VERIFIER) {
    console.error('QBO_WEBHOOK_VERIFIER not set');
    return false;
  }

  const hmac = createHmac('sha256', QBO_WEBHOOK_VERIFIER);
  hmac.update(payload);
  const hash = hmac.digest('base64');
  
  return hash === signature;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify webhook signature
    const signature = req.headers.get('intuit-signature');
    const rawPayload = await req.text();
    
    if (!signature || !verifyWebhookSignature(rawPayload, signature)) {
      console.error('Invalid webhook signature');
      return new Response('Unauthorized', { status: 401 });
    }

    const payload: WebhookPayload = JSON.parse(rawPayload);
    console.log('Received QBO webhook:', JSON.stringify(payload, null, 2));

    // Process each notification
    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId;
      
      // Get tenant for this realm
      const { data: connection } = await supabase
        .from('qbo_connections')
        .select('tenant_id')
        .eq('realm_id', realmId)
        .eq('is_active', true)
        .single();

      if (!connection) {
        console.warn(`No active connection for realm ${realmId}`);
        continue;
      }

      // Log each entity change
      for (const entity of notification.dataChangeEvent.entities) {
        const { error: logError } = await supabase
          .from('qbo_webhook_journal')
          .insert({
            tenant_id: connection.tenant_id,
            realm_id: realmId,
            event_type: entity.name,
            operation: entity.operation,
            entity_id: entity.id,
            payload: entity,
            signature_verified: true,
            processed: false,
          });

        if (logError) {
          console.error('Failed to log webhook event:', logError);
        }

        // Process immediately for critical events
        if (entity.name === 'Payment' && (entity.operation === 'Create' || entity.operation === 'Update')) {
          console.log('Processing payment event:', entity);
          await processPaymentEvent(supabase, connection.tenant_id, realmId, entity.id);
        }
      }
    }

    // Quick acknowledgment (< 3 seconds)
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-webhook-handler:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function processPaymentEvent(
  supabase: any,
  tenantId: string,
  realmId: string,
  paymentId: string
) {
  try {
    console.log(`Processing payment ${paymentId} for tenant ${tenantId}`);
    
    // Get connection tokens
    const { data: connection } = await supabase
      .from('qbo_connections')
      .select('access_token, realm_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (!connection) {
      throw new Error('No active QBO connection');
    }

    // Fetch payment from QBO
    const paymentResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/payment/${paymentId}?minorversion=75`,
      {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!paymentResponse.ok) {
      throw new Error('Failed to fetch payment from QBO');
    }

    const paymentData = await paymentResponse.json();
    const payment = paymentData.Payment;

    console.log('Payment data:', JSON.stringify(payment, null, 2));

    // Process linked invoices
    if (payment.Line) {
      for (const line of payment.Line) {
        if (line.LinkedTxn && line.LinkedTxn.some((txn: any) => txn.TxnType === 'Invoice')) {
          for (const linkedTxn of line.LinkedTxn) {
            if (linkedTxn.TxnType === 'Invoice') {
              await updateInvoiceBalance(supabase, tenantId, realmId, linkedTxn.TxnId, connection.access_token);
            }
          }
        }
      }
    }

    // Mark webhook event as processed
    await supabase
      .from('qbo_webhook_journal')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('entity_id', paymentId)
      .eq('event_type', 'Payment');

  } catch (error) {
    console.error('Error processing payment event:', error);
    throw error;
  }
}

async function updateInvoiceBalance(
  supabase: any,
  tenantId: string,
  realmId: string,
  invoiceId: string,
  accessToken: string
) {
  try {
    // Fetch invoice from QBO
    const invoiceResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/invoice/${invoiceId}?minorversion=75`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!invoiceResponse.ok) {
      throw new Error('Failed to fetch invoice from QBO');
    }

    const invoiceData = await invoiceResponse.json();
    const invoice = invoiceData.Invoice;

    console.log(`Updating invoice ${invoiceId} balance to ${invoice.Balance}`);

    // Update local mirror with QBO balance
    await supabase
      .from('invoice_ar_mirror')
      .update({
        balance: parseFloat(invoice.Balance),
        total_amount: parseFloat(invoice.TotalAmt),
        qbo_status: invoice.EmailStatus || 'Draft',
        last_qbo_pull_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('qbo_invoice_id', invoiceId);

  } catch (error) {
    console.error('Error updating invoice balance:', error);
    throw error;
  }
}
