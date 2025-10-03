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

    const { reward_id } = await req.json();

    if (!reward_id) {
      throw new Error('reward_id is required');
    }

    // Get reward details
    const { data: reward, error: rewardError } = await supabaseClient
      .from('achievement_rewards')
      .select('*, canvass_achievements(*)')
      .eq('id', reward_id)
      .eq('user_id', user.id)
      .single();

    if (rewardError || !reward) {
      throw new Error('Reward not found or access denied');
    }

    // Check if reward is cash type
    if (reward.reward_type !== 'cash') {
      throw new Error('This reward is not a cash prize');
    }

    // Check if already processed
    if (reward.status === 'completed' || reward.status === 'processing') {
      throw new Error('Reward already processed');
    }

    // Check if user has connected Stripe account
    const { data: connectAccount } = await supabaseClient
      .from('stripe_connect_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('tenant_id', reward.tenant_id)
      .maybeSingle();

    if (!connectAccount) {
      throw new Error('No Stripe account connected. Please connect your bank account first.');
    }

    if (!connectAccount.payouts_enabled) {
      throw new Error('Your Stripe account is not ready for payouts. Please complete onboarding.');
    }

    // Create Stripe Transfer
    const amountInCents = Math.round(reward.reward_value * 100);
    
    console.log('Creating Stripe transfer:', {
      amount: amountInCents,
      destination: connectAccount.stripe_account_id,
      reward_id,
      user_id: user.id,
    });

    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: 'usd',
      destination: connectAccount.stripe_account_id,
      transfer_group: reward.competition_id || `achievement_${reward.achievement_id}`,
      metadata: {
        reward_id,
        user_id: user.id,
        tenant_id: reward.tenant_id,
        type: 'prize_distribution',
      },
    });

    // Create payout transaction record
    const { data: payoutTransaction, error: payoutError } = await supabaseClient
      .from('payout_transactions')
      .insert({
        tenant_id: reward.tenant_id,
        reward_id,
        user_id: user.id,
        stripe_transfer_id: transfer.id,
        amount: reward.reward_value,
        currency: 'usd',
        status: 'processing',
      })
      .select()
      .single();

    if (payoutError) {
      console.error('Failed to create payout transaction:', payoutError);
      throw new Error('Failed to record payout transaction');
    }

    // Update reward status
    await supabaseClient
      .from('achievement_rewards')
      .update({
        status: 'processing',
        processed_at: new Date().toISOString(),
        stripe_payment_intent_id: transfer.id,
      })
      .eq('id', reward_id);

    console.log('Prize distribution initiated:', {
      transfer_id: transfer.id,
      payout_transaction_id: payoutTransaction.id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        transfer_id: transfer.id,
        payout_transaction_id: payoutTransaction.id,
        amount: reward.reward_value,
        status: 'processing',
        message: 'Prize distribution initiated. Funds will arrive in 2-3 business days.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in stripe-distribute-prize:', error);
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
