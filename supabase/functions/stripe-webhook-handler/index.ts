import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0';
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const signature = req.headers.get('stripe-signature');
  
  if (!signature || !webhookSecret) {
    return new Response(
      JSON.stringify({ error: 'Missing signature or webhook secret' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Processing webhook event:', event.type);

    // Extract tenant_id from metadata
    const metadata = event.data.object.metadata || {};
    const tenantId = metadata.tenant_id;

    if (!tenantId) {
      console.warn('No tenant_id in webhook metadata');
    }

    // Log the event
    await supabase.from('payment_events').insert({
      tenant_id: tenantId,
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object as any,
      processed: false,
    });

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(supabase, session, tenantId);
        break;
      }
      
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(supabase, paymentIntent, tenantId);
        break;
      }
      
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(supabase, paymentIntent, tenantId);
        break;
      }
      
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(supabase, charge, tenantId);
        break;
      }
      
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDisputeCreated(supabase, dispute, tenantId);
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }

    // Mark event as processed
    await supabase
      .from('payment_events')
      .update({ 
        processed: true, 
        processed_at: new Date().toISOString() 
      })
      .eq('stripe_event_id', event.id);

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});

async function handleCheckoutCompleted(
  supabase: any,
  session: Stripe.Checkout.Session,
  tenantId: string
) {
  const metadata = session.metadata || {};
  const paymentId = metadata.payment_id;

  if (paymentId) {
    await supabase
      .from('payments')
      .update({
        status: 'completed',
        stripe_payment_intent_id: session.payment_intent,
        payment_date: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('tenant_id', tenantId);

    console.log('Payment completed:', paymentId);
  }
}

async function handlePaymentSucceeded(
  supabase: any,
  paymentIntent: Stripe.PaymentIntent,
  tenantId: string
) {
  const metadata = paymentIntent.metadata || {};
  const paymentId = metadata.payment_id;

  if (paymentId) {
    await supabase
      .from('payments')
      .update({
        status: 'completed',
        stripe_payment_intent_id: paymentIntent.id,
        payment_date: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('tenant_id', tenantId);

    console.log('Payment intent succeeded:', paymentId);
  }
}

async function handlePaymentFailed(
  supabase: any,
  paymentIntent: Stripe.PaymentIntent,
  tenantId: string
) {
  const metadata = paymentIntent.metadata || {};
  const paymentId = metadata.payment_id;

  if (paymentId) {
    await supabase
      .from('payments')
      .update({
        status: 'failed',
        stripe_payment_intent_id: paymentIntent.id,
      })
      .eq('id', paymentId)
      .eq('tenant_id', tenantId);

    console.log('Payment failed:', paymentId);
  }
}

async function handleChargeRefunded(
  supabase: any,
  charge: Stripe.Charge,
  tenantId: string
) {
  // Find payment by charge/payment intent
  const { data: payment } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', charge.payment_intent)
    .eq('tenant_id', tenantId)
    .single();

  if (payment) {
    await supabase
      .from('payments')
      .update({
        status: 'refunded',
      })
      .eq('id', payment.id);

    console.log('Payment refunded:', payment.id);
  }
}

async function handleDisputeCreated(
  supabase: any,
  dispute: Stripe.Dispute,
  tenantId: string
) {
  // Find payment by charge
  const { data: payment } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', dispute.payment_intent)
    .eq('tenant_id', tenantId)
    .single();

  if (payment) {
    await supabase
      .from('payments')
      .update({
        status: 'disputed',
      })
      .eq('id', payment.id);

    console.log('Payment disputed:', payment.id);
  }
}
