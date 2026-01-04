import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface KPIRequest {
  action: "get_live_metrics" | "calculate_trends" | "set_alert_thresholds" | "get_leaderboard" | "get_channel_info";
  tenant_id: string;
  params?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { action, tenant_id, params = {} } = await req.json() as KPIRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[real-time-kpi-engine] Action: ${action}, Tenant: ${tenant_id}`);

    switch (action) {
      case "get_live_metrics": {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        // Get revenue metrics
        const { data: revenueData } = await supabase
          .from("projects")
          .select("contract_amount, created_at, status")
          .eq("tenant_id", tenant_id);

        const revenueMTD = revenueData?.filter(p => 
          new Date(p.created_at) >= startOfMonth && p.status === 'completed'
        ).reduce((sum, p) => sum + (p.contract_amount || 0), 0) || 0;

        const revenueYTD = revenueData?.filter(p => 
          new Date(p.created_at) >= startOfYear && p.status === 'completed'
        ).reduce((sum, p) => sum + (p.contract_amount || 0), 0) || 0;

        const revenueLastMonth = revenueData?.filter(p => 
          new Date(p.created_at) >= lastMonth && 
          new Date(p.created_at) <= endOfLastMonth && 
          p.status === 'completed'
        ).reduce((sum, p) => sum + (p.contract_amount || 0), 0) || 0;

        // Get lead metrics
        const { data: leads, count: totalLeads } = await supabase
          .from("pipeline_entries")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .gte("created_at", startOfMonth.toISOString());

        const { count: leadsLastMonth } = await supabase
          .from("pipeline_entries")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .gte("created_at", lastMonth.toISOString())
          .lt("created_at", startOfMonth.toISOString());

        // Get conversion metrics
        const { count: wonDeals } = await supabase
          .from("pipeline_entries")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .eq("status", "won")
          .gte("created_at", startOfMonth.toISOString());

        const { count: totalDeals } = await supabase
          .from("pipeline_entries")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .in("status", ["won", "lost"])
          .gte("created_at", startOfMonth.toISOString());

        const conversionRate = totalDeals && totalDeals > 0 
          ? ((wonDeals || 0) / totalDeals * 100).toFixed(1) 
          : 0;

        // Get appointments today
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const endOfDay = new Date(now.setHours(23, 59, 59, 999));

        const { count: appointmentsToday } = await supabase
          .from("appointments")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .gte("scheduled_start", startOfDay.toISOString())
          .lte("scheduled_start", endOfDay.toISOString());

        // Get active jobs
        const { count: activeJobs } = await supabase
          .from("jobs")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .in("status", ["in_progress", "scheduled", "pending"]);

        // Calculate projected monthly revenue
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayOfMonth = now.getDate();
        const projectedRevenue = dayOfMonth > 0 ? (revenueMTD / dayOfMonth) * daysInMonth : 0;

        // Lead velocity (leads per day this month)
        const leadVelocity = dayOfMonth > 0 ? ((totalLeads || 0) / dayOfMonth).toFixed(1) : 0;

        return new Response(
          JSON.stringify({
            success: true,
            metrics: {
              revenue: {
                mtd: revenueMTD,
                ytd: revenueYTD,
                lastMonth: revenueLastMonth,
                projected: projectedRevenue,
                trend: revenueLastMonth > 0 ? ((revenueMTD - revenueLastMonth) / revenueLastMonth * 100).toFixed(1) : 0
              },
              leads: {
                mtd: totalLeads || 0,
                lastMonth: leadsLastMonth || 0,
                velocity: leadVelocity,
                trend: leadsLastMonth && leadsLastMonth > 0 
                  ? (((totalLeads || 0) - leadsLastMonth) / leadsLastMonth * 100).toFixed(1) 
                  : 0
              },
              conversion: {
                rate: conversionRate,
                wonDeals: wonDeals || 0,
                totalDeals: totalDeals || 0
              },
              activity: {
                appointmentsToday: appointmentsToday || 0,
                activeJobs: activeJobs || 0
              },
              timestamp: new Date().toISOString()
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "calculate_trends": {
        const { period = "30d" } = params;
        const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get daily revenue data
        const { data: projects } = await supabase
          .from("projects")
          .select("contract_amount, created_at, status")
          .eq("tenant_id", tenant_id)
          .gte("created_at", startDate.toISOString())
          .eq("status", "completed");

        // Get daily lead data
        const { data: leads } = await supabase
          .from("pipeline_entries")
          .select("created_at, status")
          .eq("tenant_id", tenant_id)
          .gte("created_at", startDate.toISOString());

        // Group by day
        const dailyData: Record<string, { revenue: number; leads: number; conversions: number }> = {};
        
        for (let i = 0; i < days; i++) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const key = date.toISOString().split("T")[0];
          dailyData[key] = { revenue: 0, leads: 0, conversions: 0 };
        }

        projects?.forEach(p => {
          const key = new Date(p.created_at).toISOString().split("T")[0];
          if (dailyData[key]) {
            dailyData[key].revenue += p.contract_amount || 0;
          }
        });

        leads?.forEach(l => {
          const key = new Date(l.created_at).toISOString().split("T")[0];
          if (dailyData[key]) {
            dailyData[key].leads += 1;
            if (l.status === "won") dailyData[key].conversions += 1;
          }
        });

        const trendData = Object.entries(dailyData)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({ date, ...data }));

        return new Response(
          JSON.stringify({ success: true, trends: trendData, period }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_leaderboard": {
        const { period = "mtd", limit = 10 } = params;
        
        const now = new Date();
        let startDate: Date;
        
        if (period === "today") {
          startDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (period === "wtd") {
          startDate = new Date(now);
          startDate.setDate(now.getDate() - now.getDay());
        } else if (period === "ytd") {
          startDate = new Date(now.getFullYear(), 0, 1);
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        // Get sales by user
        const { data: sales } = await supabase
          .from("pipeline_entries")
          .select(`
            assigned_to,
            estimated_value,
            status,
            profiles!pipeline_entries_assigned_to_fkey (
              id,
              full_name,
              avatar_url
            )
          `)
          .eq("tenant_id", tenant_id)
          .eq("status", "won")
          .gte("created_at", startDate.toISOString());

        // Aggregate by user
        const userStats: Record<string, { 
          user_id: string; 
          name: string; 
          avatar: string | null;
          total_revenue: number; 
          deals_closed: number 
        }> = {};

        sales?.forEach(sale => {
          if (sale.assigned_to && sale.profiles) {
            const profile = Array.isArray(sale.profiles) ? sale.profiles[0] : sale.profiles;
            if (!userStats[sale.assigned_to]) {
              userStats[sale.assigned_to] = {
                user_id: sale.assigned_to,
                name: profile?.full_name || "Unknown",
                avatar: profile?.avatar_url || null,
                total_revenue: 0,
                deals_closed: 0
              };
            }
            userStats[sale.assigned_to].total_revenue += sale.estimated_value || 0;
            userStats[sale.assigned_to].deals_closed += 1;
          }
        });

        const leaderboard = Object.values(userStats)
          .sort((a, b) => b.total_revenue - a.total_revenue)
          .slice(0, Number(limit))
          .map((user, index) => ({ ...user, rank: index + 1 }));

        return new Response(
          JSON.stringify({ success: true, leaderboard, period }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_alert_thresholds": {
        const { thresholds } = params;
        
        // Store alert thresholds in tenant settings
        const { error } = await supabase
          .from("tenants")
          .update({ 
            settings: supabase.rpc("jsonb_set", {
              target: "settings",
              path: "{kpi_alerts}",
              new_value: JSON.stringify(thresholds)
            })
          })
          .eq("id", tenant_id);

        if (error) {
          console.error("[real-time-kpi-engine] Error setting thresholds:", error);
          return new Response(
            JSON.stringify({ error: "Failed to set thresholds" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: "Thresholds updated" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_channel_info": {
        // Return channel info for Supabase Realtime subscriptions
        return new Response(
          JSON.stringify({
            success: true,
            channels: {
              kpi_updates: `kpi:${tenant_id}`,
              leaderboard: `leaderboard:${tenant_id}`,
              alerts: `alerts:${tenant_id}`
            },
            instructions: "Subscribe to these channels using Supabase Realtime client"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[real-time-kpi-engine] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
