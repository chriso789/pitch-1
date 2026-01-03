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
    console.log(`[referral-manager] Action: ${action}`, data);

    switch (action) {
      case 'create_code': {
        const { tenant_id, contact_id, reward_type, reward_value, expires_at } = data;
        const code = `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        
        const { data: referral, error } = await supabase
          .from('referral_codes')
          .insert({
            tenant_id,
            contact_id,
            code,
            reward_type: reward_type || 'credit',
            reward_value: reward_value || 100,
            expires_at,
            is_active: true
          })
          .select()
          .single();

        if (error) throw error;
        console.log(`[referral-manager] Created referral code: ${code}`);
        return new Response(JSON.stringify({ success: true, referral }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'validate_code': {
        const { code, tenant_id } = data;
        const { data: referral, error } = await supabase
          .from('referral_codes')
          .select('*, contacts(*)')
          .eq('code', code)
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .single();

        if (error || !referral) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid or expired code' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (referral.expires_at && new Date(referral.expires_at) < new Date()) {
          return new Response(JSON.stringify({ success: false, error: 'Code has expired' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ success: true, referral }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'record_conversion': {
        const { referral_code_id, referred_contact_id, job_id, tenant_id } = data;
        
        const { data: conversion, error } = await supabase
          .from('referral_conversions')
          .insert({
            tenant_id,
            referral_code_id,
            referred_contact_id,
            job_id,
            conversion_date: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        // Update usage count on referral code
        await supabase.rpc('increment_referral_usage', { code_id: referral_code_id });
        
        console.log(`[referral-manager] Recorded conversion for code: ${referral_code_id}`);
        return new Response(JSON.stringify({ success: true, conversion }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_referrer_stats': {
        const { contact_id, tenant_id } = data;
        
        const { data: codes } = await supabase
          .from('referral_codes')
          .select(`
            *,
            referral_conversions(count),
            referral_rewards(*)
          `)
          .eq('contact_id', contact_id)
          .eq('tenant_id', tenant_id);

        const totalReferrals = codes?.reduce((sum, c) => sum + (c.referral_conversions?.[0]?.count || 0), 0) || 0;
        const totalRewards = codes?.reduce((sum, c) => sum + c.referral_rewards?.reduce((rs: number, r: any) => rs + (r.reward_value || 0), 0), 0) || 0;

        return new Response(JSON.stringify({ 
          success: true, 
          stats: { 
            codes: codes?.length || 0,
            totalReferrals,
            totalRewards
          },
          codes 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[referral-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
