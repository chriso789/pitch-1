import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MultiLocationRequest {
  action: "create_location" | "get_location_metrics" | "transfer_lead" | "compare_locations" | "consolidate_reports" | "set_location_rules";
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

    const { action, tenant_id, params = {} } = await req.json() as MultiLocationRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[multi-location-hub] Action: ${action}, Tenant: ${tenant_id}`);

    switch (action) {
      case "create_location": {
        const { 
          name, 
          code,
          address, 
          territory_geojson, 
          manager_id, 
          phone, 
          email,
          is_headquarters = false,
          settings = {}
        } = params;

        if (!name) {
          return new Response(
            JSON.stringify({ error: "name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If setting as headquarters, unset existing HQ
        if (is_headquarters) {
          await supabase
            .from("business_locations")
            .update({ is_headquarters: false })
            .eq("tenant_id", tenant_id)
            .eq("is_headquarters", true);
        }

        const { data: location, error } = await supabase
          .from("business_locations")
          .insert({
            tenant_id,
            name,
            code,
            address,
            territory_geojson,
            manager_id,
            phone,
            email,
            is_headquarters,
            settings,
            status: "active"
          })
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            location,
            message: "Location created successfully"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_location_metrics": {
        const { location_id, period = "mtd" } = params;

        // Get all locations if no specific one requested
        let locationsQuery = supabase
          .from("business_locations")
          .select(`
            *,
            profiles!business_locations_manager_id_fkey (
              id,
              full_name
            )
          `)
          .eq("tenant_id", tenant_id)
          .eq("status", "active");

        if (location_id) {
          locationsQuery = locationsQuery.eq("id", location_id);
        }

        const { data: locations } = await locationsQuery;

        // Calculate date range based on period
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

        // Get metrics for each location
        const metrics = await Promise.all(
          (locations || []).map(async (location) => {
            // Get leads/contacts for this location (by territory or assignment)
            const { count: leadCount } = await supabase
              .from("pipeline_entries")
              .select("*", { count: "exact" })
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id)
              .gte("created_at", startDate.toISOString());

            const { data: wonDeals } = await supabase
              .from("pipeline_entries")
              .select("estimated_value")
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id)
              .eq("status", "won")
              .gte("created_at", startDate.toISOString());

            const revenue = wonDeals?.reduce((sum, d) => sum + (d.estimated_value || 0), 0) || 0;

            const { count: projectCount } = await supabase
              .from("projects")
              .select("*", { count: "exact" })
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id)
              .gte("created_at", startDate.toISOString());

            const { count: teamSize } = await supabase
              .from("profiles")
              .select("*", { count: "exact" })
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id);

            return {
              location_id: location.id,
              location_name: location.name,
              code: location.code,
              is_headquarters: location.is_headquarters,
              manager: location.profiles?.full_name,
              metrics: {
                leads: leadCount || 0,
                deals_won: wonDeals?.length || 0,
                revenue,
                projects: projectCount || 0,
                team_size: teamSize || 0,
                avg_deal_size: wonDeals?.length 
                  ? Math.round(revenue / wonDeals.length) 
                  : 0
              }
            };
          })
        );

        return new Response(
          JSON.stringify({
            success: true,
            period,
            locations: metrics,
            totals: {
              total_leads: metrics.reduce((s, m) => s + m.metrics.leads, 0),
              total_revenue: metrics.reduce((s, m) => s + m.metrics.revenue, 0),
              total_projects: metrics.reduce((s, m) => s + m.metrics.projects, 0),
              total_team: metrics.reduce((s, m) => s + m.metrics.team_size, 0)
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "transfer_lead": {
        const { lead_id, from_location_id, to_location_id, reason } = params;

        if (!lead_id || !to_location_id) {
          return new Response(
            JSON.stringify({ error: "lead_id and to_location_id are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get current lead info
        const { data: lead } = await supabase
          .from("pipeline_entries")
          .select("*, location_id")
          .eq("id", lead_id)
          .eq("tenant_id", tenant_id)
          .single();

        if (!lead) {
          return new Response(
            JSON.stringify({ error: "Lead not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update lead location
        const { error: updateError } = await supabase
          .from("pipeline_entries")
          .update({ 
            location_id: to_location_id,
            metadata: {
              ...lead.metadata,
              transfer_history: [
                ...(lead.metadata?.transfer_history || []),
                {
                  from: from_location_id || lead.location_id,
                  to: to_location_id,
                  reason,
                  transferred_at: new Date().toISOString()
                }
              ]
            }
          })
          .eq("id", lead_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: updateError.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Log the transfer
        await supabase
          .from("activity_log")
          .insert({
            tenant_id,
            entity_type: "pipeline_entry",
            entity_id: lead_id,
            action: "location_transfer",
            metadata: {
              from_location: from_location_id || lead.location_id,
              to_location: to_location_id,
              reason
            }
          });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Lead transferred successfully",
            lead_id,
            new_location_id: to_location_id
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "compare_locations": {
        const { location_ids, period = "mtd" } = params;

        // Get locations to compare
        let query = supabase
          .from("business_locations")
          .select("*")
          .eq("tenant_id", tenant_id)
          .eq("status", "active");

        if (location_ids && Array.isArray(location_ids)) {
          query = query.in("id", location_ids);
        }

        const { data: locations } = await query;

        // Calculate period dates
        const now = new Date();
        let startDate: Date;
        let previousStartDate: Date;
        
        if (period === "mtd") {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          previousStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        } else {
          startDate = new Date(now.getFullYear(), 0, 1);
          previousStartDate = new Date(now.getFullYear() - 1, 0, 1);
        }

        // Get comparison metrics
        const comparison = await Promise.all(
          (locations || []).map(async (location) => {
            // Current period
            const { data: currentDeals } = await supabase
              .from("pipeline_entries")
              .select("estimated_value, status")
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id)
              .gte("created_at", startDate.toISOString());

            // Previous period
            const { data: previousDeals } = await supabase
              .from("pipeline_entries")
              .select("estimated_value, status")
              .eq("tenant_id", tenant_id)
              .eq("location_id", location.id)
              .gte("created_at", previousStartDate.toISOString())
              .lt("created_at", startDate.toISOString());

            const currentRevenue = currentDeals
              ?.filter(d => d.status === "won")
              .reduce((s, d) => s + (d.estimated_value || 0), 0) || 0;

            const previousRevenue = previousDeals
              ?.filter(d => d.status === "won")
              .reduce((s, d) => s + (d.estimated_value || 0), 0) || 0;

            const currentConversion = currentDeals?.length 
              ? (currentDeals.filter(d => d.status === "won").length / currentDeals.length * 100)
              : 0;

            const previousConversion = previousDeals?.length 
              ? (previousDeals.filter(d => d.status === "won").length / previousDeals.length * 100)
              : 0;

            return {
              location_id: location.id,
              location_name: location.name,
              current_period: {
                revenue: currentRevenue,
                leads: currentDeals?.length || 0,
                won: currentDeals?.filter(d => d.status === "won").length || 0,
                conversion_rate: currentConversion.toFixed(1)
              },
              previous_period: {
                revenue: previousRevenue,
                leads: previousDeals?.length || 0,
                won: previousDeals?.filter(d => d.status === "won").length || 0,
                conversion_rate: previousConversion.toFixed(1)
              },
              growth: {
                revenue_change: previousRevenue > 0 
                  ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1)
                  : "N/A",
                lead_change: previousDeals?.length 
                  ? (((currentDeals?.length || 0) - previousDeals.length) / previousDeals.length * 100).toFixed(1)
                  : "N/A"
              }
            };
          })
        );

        // Rank locations
        const ranked = comparison
          .sort((a, b) => b.current_period.revenue - a.current_period.revenue)
          .map((loc, idx) => ({ ...loc, rank: idx + 1 }));

        return new Response(
          JSON.stringify({
            success: true,
            period,
            comparison: ranked,
            top_performer: ranked[0]?.location_name,
            total_revenue: ranked.reduce((s, l) => s + l.current_period.revenue, 0)
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "consolidate_reports": {
        const { report_type = "summary", period = "mtd" } = params;

        // Get all locations
        const { data: locations } = await supabase
          .from("business_locations")
          .select("*")
          .eq("tenant_id", tenant_id)
          .eq("status", "active");

        const now = new Date();
        let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        if (period === "ytd") {
          startDate = new Date(now.getFullYear(), 0, 1);
        }

        // Consolidated data
        const { data: allLeads } = await supabase
          .from("pipeline_entries")
          .select("location_id, status, estimated_value, created_at")
          .eq("tenant_id", tenant_id)
          .gte("created_at", startDate.toISOString());

        const { data: allProjects } = await supabase
          .from("projects")
          .select("location_id, status, contract_amount, created_at")
          .eq("tenant_id", tenant_id)
          .gte("created_at", startDate.toISOString());

        // Build consolidated report
        const report = {
          generated_at: new Date().toISOString(),
          period,
          company_wide: {
            total_leads: allLeads?.length || 0,
            total_revenue: allLeads
              ?.filter(l => l.status === "won")
              .reduce((s, l) => s + (l.estimated_value || 0), 0) || 0,
            total_projects: allProjects?.length || 0,
            project_value: allProjects?.reduce((s, p) => s + (p.contract_amount || 0), 0) || 0,
            location_count: locations?.length || 0
          },
          by_location: (locations || []).map(loc => {
            const locLeads = allLeads?.filter(l => l.location_id === loc.id) || [];
            const locProjects = allProjects?.filter(p => p.location_id === loc.id) || [];
            
            return {
              location_id: loc.id,
              name: loc.name,
              leads: locLeads.length,
              revenue: locLeads
                .filter(l => l.status === "won")
                .reduce((s, l) => s + (l.estimated_value || 0), 0),
              projects: locProjects.length
            };
          }),
          trends: {
            // Simplified trend data
            top_location_by_leads: locations?.reduce((top, loc) => {
              const count = allLeads?.filter(l => l.location_id === loc.id).length || 0;
              return count > (top?.count || 0) ? { name: loc.name, count } : top;
            }, null as { name: string; count: number } | null),
            top_location_by_revenue: locations?.reduce((top, loc) => {
              const revenue = allLeads
                ?.filter(l => l.location_id === loc.id && l.status === "won")
                .reduce((s, l) => s + (l.estimated_value || 0), 0) || 0;
              return revenue > (top?.revenue || 0) ? { name: loc.name, revenue } : top;
            }, null as { name: string; revenue: number } | null)
          }
        };

        return new Response(
          JSON.stringify({
            success: true,
            report
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_location_rules": {
        const { location_id, rules } = params;

        if (!location_id || !rules) {
          return new Response(
            JSON.stringify({ error: "location_id and rules are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error } = await supabase
          .from("business_locations")
          .update({ lead_routing_rules: rules })
          .eq("id", location_id)
          .eq("tenant_id", tenant_id);

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Lead routing rules updated",
            location_id
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
    console.error("[multi-location-hub] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
