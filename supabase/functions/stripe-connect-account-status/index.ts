import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.10.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Get user's Stripe Connect account
    const { data: connectAccount } = await supabaseClient
      .from('stripe_connect_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!connectAccount) {
      return new Response(
        JSON.stringify({
          success: true,
          connected: false,
          account: null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch current status from Stripe
    const account = await stripe.accounts.retrieve(connectAccount.stripe_account_id);

    // Update database with latest status
    await supabaseClient
      .from('stripe_connect_accounts')
      .update({
        onboarding_complete: account.details_submitted || false,
        payouts_enabled: account.payouts_enabled || false,
        charges_enabled: account.charges_enabled || false,
        details_submitted: account.details_submitted || false,
        metadata: {
          capabilities: account.capabilities,
          requirements: account.requirements,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectAccount.id);

    return new Response(
      JSON.stringify({
        success: true,
        connected: true,
        account: {
          id: connectAccount.stripe_account_id,
          onboarding_complete: account.details_submitted || false,
          payouts_enabled: account.payouts_enabled || false,
          charges_enabled: account.charges_enabled || false,
          requirements_due: account.requirements?.currently_due || [],
          requirements_pending: account.requirements?.pending_verification || [],
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in stripe-connect-account-status:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
