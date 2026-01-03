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
    console.log(`[franchise-royalty-processor] Action: ${action}`, data);

    switch (action) {
      case 'calculate_royalties': {
        const { tenant_id, period_start, period_end } = data;
        
        // Get all branches
        const { data: branches } = await supabase
          .from('franchise_branches')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active');

        const royalties = [];
        for (const branch of branches || []) {
          // Get completed jobs for this branch in the period
          const { data: jobs } = await supabase
            .from('jobs')
            .select('*, estimates(*)')
            .eq('branch_id', branch.id)
            .eq('status', 'completed')
            .gte('completed_at', period_start)
            .lte('completed_at', period_end);

          const grossRevenue = jobs?.reduce((sum, job) => 
            sum + (job.estimates?.[0]?.total || 0), 0
          ) || 0;

          const royaltyAmount = grossRevenue * branch.royalty_rate;

          if (grossRevenue > 0) {
            const { data: royalty } = await supabase
              .from('franchise_royalties')
              .insert({
                tenant_id,
                branch_id: branch.id,
                period_start,
                period_end,
                gross_revenue: grossRevenue,
                royalty_rate: branch.royalty_rate,
                royalty_amount: royaltyAmount,
                status: 'pending'
              })
              .select()
              .single();

            if (royalty) royalties.push(royalty);
          }
        }

        console.log(`[franchise-royalty-processor] Calculated royalties for ${royalties.length} branches`);
        return new Response(JSON.stringify({ 
          success: true, 
          royalties,
          total_royalties: royalties.reduce((sum, r) => sum + r.royalty_amount, 0)
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'process_payment': {
        const { royalty_id, payment_method, reference_number } = data;
        
        const { data: royalty, error } = await supabase
          .from('franchise_royalties')
          .update({
            status: 'paid',
            payment_method,
            reference_number,
            paid_at: new Date().toISOString()
          })
          .eq('id', royalty_id)
          .select()
          .single();

        if (error) throw error;

        console.log(`[franchise-royalty-processor] Processed payment for royalty: ${royalty_id}`);
        return new Response(JSON.stringify({ success: true, royalty }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_outstanding': {
        const { tenant_id, branch_id } = data;
        
        let query = supabase
          .from('franchise_royalties')
          .select('*, franchise_branches(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'pending');

        if (branch_id) {
          query = query.eq('branch_id', branch_id);
        }

        const { data: outstanding, error } = await query.order('period_end', { ascending: false });

        if (error) throw error;

        const totalOutstanding = outstanding?.reduce((sum, r) => sum + r.royalty_amount, 0) || 0;
        
        return new Response(JSON.stringify({ 
          success: true, 
          outstanding,
          total_outstanding: totalOutstanding
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'score_compliance': {
        const { tenant_id, branch_id } = data;
        
        // Get compliance records
        const { data: compliance } = await supabase
          .from('franchise_compliance')
          .select('*')
          .eq('branch_id', branch_id)
          .order('audit_date', { ascending: false })
          .limit(10);

        // Calculate overall score
        const avgScore = compliance?.length 
          ? compliance.reduce((sum, c) => sum + c.score, 0) / compliance.length 
          : 100;

        // Check royalty payment history
        const { data: royalties } = await supabase
          .from('franchise_royalties')
          .select('*')
          .eq('branch_id', branch_id)
          .order('period_end', { ascending: false })
          .limit(12);

        const onTimePayments = royalties?.filter(r => {
          if (r.status !== 'paid' || !r.paid_at) return false;
          const dueDate = new Date(r.period_end);
          dueDate.setDate(dueDate.getDate() + 15); // 15 day grace period
          return new Date(r.paid_at) <= dueDate;
        }).length || 0;

        const paymentScore = royalties?.length 
          ? (onTimePayments / royalties.length) * 100 
          : 100;

        const overallScore = (avgScore * 0.6) + (paymentScore * 0.4);

        const scorecard = {
          branch_id,
          operational_score: avgScore,
          payment_score: paymentScore,
          overall_score: Math.round(overallScore),
          rating: overallScore >= 90 ? 'Excellent' : 
                  overallScore >= 75 ? 'Good' : 
                  overallScore >= 60 ? 'Needs Improvement' : 'At Risk',
          recent_audits: compliance
        };

        return new Response(JSON.stringify({ success: true, scorecard }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'record_compliance_audit': {
        const { tenant_id, branch_id, standard_id, score, findings, corrective_actions } = data;
        
        const { data: audit, error } = await supabase
          .from('franchise_compliance')
          .insert({
            tenant_id,
            branch_id,
            standard_id,
            score,
            findings,
            corrective_actions,
            audit_date: new Date().toISOString(),
            status: score >= 80 ? 'passed' : 'requires_action'
          })
          .select()
          .single();

        if (error) throw error;

        console.log(`[franchise-royalty-processor] Recorded compliance audit for branch: ${branch_id}`);
        return new Response(JSON.stringify({ success: true, audit }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[franchise-royalty-processor] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
