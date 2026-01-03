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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[financial-forecasting-ai] Action: ${action}`, data);

    switch (action) {
      case 'revenue_forecast': {
        const { tenant_id, months_ahead = 3 } = data;
        
        // Get historical data
        const { data: historicalJobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(100);

        // Calculate monthly averages
        const monthlyRevenue: Record<string, number> = {};
        historicalJobs?.forEach(job => {
          if (job.completed_at && job.estimates?.[0]) {
            const month = job.completed_at.substring(0, 7);
            monthlyRevenue[month] = (monthlyRevenue[month] || 0) + (job.estimates[0].total || 0);
          }
        });

        const monthlyValues = Object.values(monthlyRevenue);
        const avgMonthlyRevenue = monthlyValues.length > 0 
          ? monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.length 
          : 0;

        // Simple growth forecast
        const growthRate = 0.05; // Assume 5% month-over-month growth
        const forecast = [];
        let currentRevenue = avgMonthlyRevenue;

        for (let i = 1; i <= months_ahead; i++) {
          const forecastDate = new Date();
          forecastDate.setMonth(forecastDate.getMonth() + i);
          currentRevenue *= (1 + growthRate);
          
          forecast.push({
            month: forecastDate.toISOString().substring(0, 7),
            projected_revenue: Math.round(currentRevenue),
            confidence: Math.max(50, 95 - (i * 10))
          });
        }

        console.log(`[financial-forecasting-ai] Generated ${months_ahead} month forecast`);
        return new Response(JSON.stringify({ 
          success: true, 
          forecast: {
            historical_average: avgMonthlyRevenue,
            projections: forecast,
            model: 'linear_growth',
            growth_rate: growthRate
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'cash_flow_forecast': {
        const { tenant_id, weeks_ahead = 8 } = data;
        
        // Get pending receivables
        const { data: invoices } = await supabase
          .from('invoices')
          .select('*')
          .eq('tenant_id', tenant_id)
          .is('paid_at', null);

        const pendingReceivables = invoices?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0;

        // Get upcoming payables (estimated)
        const { data: pendingJobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .in('status', ['scheduled', 'in_progress']);

        const estimatedCosts = pendingJobs?.reduce((sum, job) => {
          const jobTotal = job.estimates?.[0]?.total || 0;
          return sum + (jobTotal * 0.6); // Assume 60% cost ratio
        }, 0) || 0;

        const forecast = [];
        let runningBalance = pendingReceivables - estimatedCosts;

        for (let i = 1; i <= weeks_ahead; i++) {
          const weekDate = new Date();
          weekDate.setDate(weekDate.getDate() + (i * 7));
          
          // Simple decay model for collections
          const expectedCollections = pendingReceivables * (0.1 / i);
          const expectedExpenses = estimatedCosts * (0.15 / i);
          
          runningBalance += expectedCollections - expectedExpenses;
          
          forecast.push({
            week: i,
            date: weekDate.toISOString().substring(0, 10),
            projected_balance: Math.round(runningBalance),
            expected_inflows: Math.round(expectedCollections),
            expected_outflows: Math.round(expectedExpenses)
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          forecast: {
            current_receivables: pendingReceivables,
            estimated_payables: estimatedCosts,
            weekly_projections: forecast
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'seasonal_analysis': {
        const { tenant_id } = data;
        
        // Get jobs by month
        const { data: jobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed');

        const monthlyData: Record<number, { count: number; revenue: number }> = {};
        
        for (let i = 1; i <= 12; i++) {
          monthlyData[i] = { count: 0, revenue: 0 };
        }

        jobs?.forEach(job => {
          if (job.completed_at) {
            const month = new Date(job.completed_at).getMonth() + 1;
            monthlyData[month].count++;
            monthlyData[month].revenue += job.estimates?.[0]?.total || 0;
          }
        });

        const totalRevenue = Object.values(monthlyData).reduce((sum, m) => sum + m.revenue, 0);
        const avgMonthlyRevenue = totalRevenue / 12;

        const seasonalIndices = Object.entries(monthlyData).map(([month, data]) => ({
          month: parseInt(month),
          month_name: new Date(2024, parseInt(month) - 1).toLocaleString('default', { month: 'long' }),
          jobs_count: data.count,
          revenue: data.revenue,
          seasonal_index: avgMonthlyRevenue > 0 ? (data.revenue / avgMonthlyRevenue) : 1
        }));

        return new Response(JSON.stringify({ 
          success: true, 
          analysis: {
            total_revenue: totalRevenue,
            average_monthly: avgMonthlyRevenue,
            seasonal_indices: seasonalIndices,
            peak_months: seasonalIndices.filter(m => m.seasonal_index > 1.2).map(m => m.month_name),
            slow_months: seasonalIndices.filter(m => m.seasonal_index < 0.8).map(m => m.month_name)
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[financial-forecasting-ai] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
