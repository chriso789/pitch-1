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
    console.log(`[franchise-manager] Action: ${action}`, data);

    switch (action) {
      case 'create_branch': {
        const { tenant_id, name, owner_id, territory, royalty_rate, address } = data;
        
        const { data: branch, error } = await supabase
          .from('franchise_branches')
          .insert({
            tenant_id,
            name,
            owner_id,
            territory,
            royalty_rate: royalty_rate || 0.05,
            address,
            status: 'active',
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        console.log(`[franchise-manager] Created branch: ${name}`);
        return new Response(JSON.stringify({ success: true, branch }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_branch': {
        const { branch_id, ...updates } = data;
        
        const { data: branch, error } = await supabase
          .from('franchise_branches')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', branch_id)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, branch }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_branch_performance': {
        const { tenant_id, branch_id, start_date, end_date } = data;
        
        // Get jobs for this branch's territory
        const { data: branch } = await supabase
          .from('franchise_branches')
          .select('*')
          .eq('id', branch_id)
          .single();

        if (!branch) {
          return new Response(JSON.stringify({ success: false, error: 'Branch not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Get completed jobs in territory
        const { data: jobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('branch_id', branch_id)
          .eq('status', 'completed')
          .gte('completed_at', start_date)
          .lte('completed_at', end_date);

        const totalRevenue = jobs?.reduce((sum, job) => sum + (job.estimates?.[0]?.total || 0), 0) || 0;
        const royaltyOwed = totalRevenue * branch.royalty_rate;

        const performance = {
          branch_id,
          branch_name: branch.name,
          period: { start_date, end_date },
          jobs_completed: jobs?.length || 0,
          total_revenue: totalRevenue,
          royalty_rate: branch.royalty_rate,
          royalty_owed: royaltyOwed
        };

        return new Response(JSON.stringify({ success: true, performance }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_all_branches': {
        const { tenant_id } = data;
        
        const { data: branches, error } = await supabase
          .from('franchise_branches')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('name', { ascending: true });

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, branches }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'transfer_inventory': {
        const { tenant_id, from_branch_id, to_branch_id, items } = data;
        
        // Log the inventory transfer
        const transfer = {
          tenant_id,
          from_branch_id,
          to_branch_id,
          items,
          status: 'completed',
          transferred_at: new Date().toISOString()
        };

        console.log(`[franchise-manager] Inventory transfer from ${from_branch_id} to ${to_branch_id}`);
        return new Response(JSON.stringify({ success: true, transfer }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_leaderboard': {
        const { tenant_id, metric = 'revenue', period = 'month' } = data;
        
        const startDate = new Date();
        if (period === 'month') {
          startDate.setMonth(startDate.getMonth() - 1);
        } else if (period === 'quarter') {
          startDate.setMonth(startDate.getMonth() - 3);
        } else if (period === 'year') {
          startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const { data: branches } = await supabase
          .from('franchise_branches')
          .select('*, jobs(*, estimates(*))')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active');

        const leaderboard = branches?.map(branch => {
          const completedJobs = branch.jobs?.filter((j: any) => 
            j.status === 'completed' && new Date(j.completed_at) >= startDate
          ) || [];
          
          const revenue = completedJobs.reduce((sum: number, j: any) => 
            sum + (j.estimates?.[0]?.total || 0), 0
          );

          return {
            branch_id: branch.id,
            branch_name: branch.name,
            jobs_completed: completedJobs.length,
            revenue,
            avg_job_value: completedJobs.length > 0 ? revenue / completedJobs.length : 0
          };
        })
        .sort((a, b) => b.revenue - a.revenue) || [];

        return new Response(JSON.stringify({ success: true, leaderboard, period }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[franchise-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
