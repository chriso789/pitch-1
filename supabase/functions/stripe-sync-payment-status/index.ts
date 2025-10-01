import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0';
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's tenant_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    const { paymentIds = [] } = await req.json();

    const results = [];
    const errors = [];

    // Get payments to sync
    let query = supabase
      .from('payments')
      .select('id, stripe_payment_intent_id, status')
      .eq('tenant_id', profile.tenant_id)
      .not('stripe_payment_intent_id', 'is', null);

    if (paymentIds.length > 0) {
      query = query.in('id', paymentIds);
    }

    const { data: payments } = await query;

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No payments to sync',
          synced: 0,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Sync each payment
    for (const payment of payments) {
      try {
        if (!payment.stripe_payment_intent_id) {
          continue;
        }

        // Get payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripe_payment_intent_id
        );

        // Map Stripe status to our status
        let newStatus = payment.status;
        
        switch (paymentIntent.status) {
          case 'succeeded':
            newStatus = 'completed';
            break;
          case 'processing':
            newStatus = 'processing';
            break;
          case 'requires_payment_method':
          case 'requires_confirmation':
          case 'requires_action':
            newStatus = 'pending';
            break;
          case 'canceled':
            newStatus = 'cancelled';
            break;
          case 'requires_capture':
            newStatus = 'pending';
            break;
        }

        // Check for refunds
        if (paymentIntent.charges?.data[0]?.refunded) {
          newStatus = 'refunded';
        }

        // Update if status changed
        if (newStatus !== payment.status) {
          await supabase
            .from('payments')
            .update({ status: newStatus })
            .eq('id', payment.id);

          results.push({
            paymentId: payment.id,
            oldStatus: payment.status,
            newStatus,
            synced: true,
          });
        } else {
          results.push({
            paymentId: payment.id,
            status: payment.status,
            synced: false,
            message: 'Status unchanged',
          });
        }
      } catch (error) {
        console.error(`Error syncing payment ${payment.id}:`, error);
        errors.push({
          paymentId: payment.id,
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: results.filter(r => r.synced).length,
        total: payments.length,
        results,
        errors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error syncing payment status:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to sync payment status',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
