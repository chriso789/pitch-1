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
    console.log(`[financial-report-generator] Action: ${action}`, data);

    switch (action) {
      case 'profit_loss': {
        const { tenant_id, start_date, end_date, group_by = 'month' } = data;
        
        // Get revenue from completed jobs
        const { data: jobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed')
          .gte('completed_at', start_date)
          .lte('completed_at', end_date);

        const revenue = jobs?.reduce((sum, job) => sum + (job.estimates?.[0]?.total || 0), 0) || 0;

        // Get costs
        const { data: costs } = await supabase
          .from('job_costs')
          .select('*')
          .eq('tenant_id', tenant_id)
          .gte('created_at', start_date)
          .lte('created_at', end_date);

        const totalCosts = costs?.reduce((sum, cost) => sum + (cost.amount || 0), 0) || 0;

        const grossProfit = revenue - totalCosts;
        const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

        console.log(`[financial-report-generator] P&L: Revenue $${revenue}, Costs $${totalCosts}, Profit $${grossProfit}`);
        return new Response(JSON.stringify({ 
          success: true, 
          report: {
            period: { start_date, end_date },
            revenue,
            costs: totalCosts,
            gross_profit: grossProfit,
            gross_margin: grossMargin.toFixed(2) + '%',
            jobs_count: jobs?.length || 0
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'ar_aging': {
        const { tenant_id } = data;
        
        const { data: invoices } = await supabase
          .from('invoices')
          .select('*, contacts(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'sent')
          .is('paid_at', null);

        const now = new Date();
        const aging = {
          current: { count: 0, amount: 0 },
          '1-30': { count: 0, amount: 0 },
          '31-60': { count: 0, amount: 0 },
          '61-90': { count: 0, amount: 0 },
          '90+': { count: 0, amount: 0 }
        };

        invoices?.forEach(inv => {
          const dueDate = new Date(inv.due_date);
          const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          const amount = inv.total_amount || 0;

          if (daysOverdue <= 0) {
            aging.current.count++;
            aging.current.amount += amount;
          } else if (daysOverdue <= 30) {
            aging['1-30'].count++;
            aging['1-30'].amount += amount;
          } else if (daysOverdue <= 60) {
            aging['31-60'].count++;
            aging['31-60'].amount += amount;
          } else if (daysOverdue <= 90) {
            aging['61-90'].count++;
            aging['61-90'].amount += amount;
          } else {
            aging['90+'].count++;
            aging['90+'].amount += amount;
          }
        });

        const totalOutstanding = Object.values(aging).reduce((sum, a) => sum + a.amount, 0);
        
        return new Response(JSON.stringify({ 
          success: true, 
          report: {
            total_outstanding: totalOutstanding,
            aging,
            invoices_count: invoices?.length || 0
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'commission_report': {
        const { tenant_id, start_date, end_date, user_id } = data;
        
        let query = supabase
          .from('jobs')
          .select('*, estimates(*), profiles!jobs_sales_rep_id_fkey(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed')
          .gte('completed_at', start_date)
          .lte('completed_at', end_date);

        if (user_id) {
          query = query.eq('sales_rep_id', user_id);
        }

        const { data: jobs } = await query;

        const commissionsByRep: Record<string, any> = {};
        jobs?.forEach(job => {
          const repId = job.sales_rep_id;
          if (!repId) return;

          if (!commissionsByRep[repId]) {
            commissionsByRep[repId] = {
              rep_name: job.profiles?.full_name || 'Unknown',
              jobs_count: 0,
              total_revenue: 0,
              commission_rate: 0.05, // Default 5%
              commission_earned: 0
            };
          }

          const revenue = job.estimates?.[0]?.total || 0;
          commissionsByRep[repId].jobs_count++;
          commissionsByRep[repId].total_revenue += revenue;
          commissionsByRep[repId].commission_earned += revenue * commissionsByRep[repId].commission_rate;
        });

        return new Response(JSON.stringify({ 
          success: true, 
          report: {
            period: { start_date, end_date },
            commissions: Object.values(commissionsByRep),
            total_commissions: Object.values(commissionsByRep).reduce((sum, c) => sum + c.commission_earned, 0)
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[financial-report-generator] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
