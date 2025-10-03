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

    // Get user's tenant_id
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('tenant_id, email, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Check if user already has a Stripe Connect account
    const { data: existingAccount } = await supabaseClient
      .from('stripe_connect_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    let stripeAccountId = existingAccount?.stripe_account_id;

    // Create new Stripe Connect account if doesn't exist
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: profile.email,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          user_id: user.id,
          tenant_id: profile.tenant_id,
        },
      });

      stripeAccountId = account.id;

      // Store in database
      await supabaseClient.from('stripe_connect_accounts').insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        stripe_account_id: stripeAccountId,
        account_type: 'express',
        onboarding_complete: false,
        payouts_enabled: false,
      });
    }

    // Generate onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${req.headers.get('origin')}/settings?tab=payouts&refresh=true`,
      return_url: `${req.headers.get('origin')}/settings?tab=payouts&success=true`,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({
        success: true,
        account_id: stripeAccountId,
        onboarding_url: accountLink.url,
        expires_at: accountLink.expires_at,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in stripe-connect-onboard:', error);
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
