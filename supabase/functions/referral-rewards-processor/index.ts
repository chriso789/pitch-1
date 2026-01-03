import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[referral-rewards-processor] Action: ${action}`, data);

    switch (action) {
      case 'process_pending': {
        const { tenant_id } = data;
        
        // Get pending rewards
        const { data: pendingRewards, error } = await supabase
          .from('referral_rewards')
          .select('*, referral_codes(*), referral_conversions(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });

        if (error) throw error;

        const processed = [];
        for (const reward of pendingRewards || []) {
          try {
            // Update status to processing
            await supabase
              .from('referral_rewards')
              .update({ status: 'processing', processed_at: new Date().toISOString() })
              .eq('id', reward.id);

            // Process based on reward type
            if (reward.reward_type === 'credit') {
              // Apply credit to customer account
              console.log(`[referral-rewards-processor] Applying credit: $${reward.reward_value}`);
            } else if (reward.reward_type === 'cash') {
              // Queue for payout via Stripe
              console.log(`[referral-rewards-processor] Queueing cash payout: $${reward.reward_value}`);
            } else if (reward.reward_type === 'gift_card') {
              // Generate gift card
              console.log(`[referral-rewards-processor] Generating gift card: $${reward.reward_value}`);
            }

            // Mark as completed
            await supabase
              .from('referral_rewards')
              .update({ status: 'completed', completed_at: new Date().toISOString() })
              .eq('id', reward.id);

            processed.push(reward.id);
          } catch (err) {
            console.error(`[referral-rewards-processor] Failed to process reward ${reward.id}:`, err);
            await supabase
              .from('referral_rewards')
              .update({ status: 'failed', error_message: err.message })
              .eq('id', reward.id);
          }
        }

        return new Response(JSON.stringify({ success: true, processed: processed.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create_reward': {
        const { tenant_id, conversion_id, referral_code_id, reward_type, reward_value } = data;
        
        const { data: reward, error } = await supabase
          .from('referral_rewards')
          .insert({
            tenant_id,
            conversion_id,
            referral_code_id,
            reward_type,
            reward_value,
            status: 'pending'
          })
          .select()
          .single();

        if (error) throw error;
        console.log(`[referral-rewards-processor] Created reward: ${reward.id}`);
        return new Response(JSON.stringify({ success: true, reward }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'expire_unused': {
        const { tenant_id, days_old = 90 } = data;
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() - days_old);

        const { data: expired, error } = await supabase
          .from('referral_rewards')
          .update({ status: 'expired' })
          .eq('tenant_id', tenant_id)
          .eq('status', 'pending')
          .lt('created_at', expiryDate.toISOString())
          .select();

        if (error) throw error;
        console.log(`[referral-rewards-processor] Expired ${expired?.length || 0} rewards`);
        return new Response(JSON.stringify({ success: true, expired: expired?.length || 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[referral-rewards-processor] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
