import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TerritoryRequest {
  action: "analyze_distribution" | "recommend_rebalance" | "execute_rebalance" | "forecast_capacity" | "identify_hotspots";
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

    const { action, tenant_id, params = {} } = await req.json() as TerritoryRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[sales-territory-balancer] Action: ${action}, Tenant: ${tenant_id}`);

    switch (action) {
      case "analyze_distribution": {
        // Get all territories
        const { data: territories } = await supabase
          .from("territories")
          .select(`
            *,
            profiles!territories_assigned_to_fkey (
              id,
              full_name
            )
          `)
          .eq("tenant_id", tenant_id);

        // Get leads/contacts per territory
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, territory_id, latitude, longitude")
          .eq("tenant_id", tenant_id);

        // Get pipeline entries for value analysis
        const { data: pipelineEntries } = await supabase
          .from("pipeline_entries")
          .select("id, contact_id, estimated_value, status, assigned_to")
          .eq("tenant_id", tenant_id);

        // Build territory analysis
        const analysis = territories?.map(territory => {
          const territoryContacts = contacts?.filter(c => c.territory_id === territory.id) || [];
          const territoryLeads = pipelineEntries?.filter(pe => 
            territoryContacts.some(c => c.id === pe.contact_id)
          ) || [];

          const totalValue = territoryLeads.reduce((sum, l) => sum + (l.estimated_value || 0), 0);
          const wonValue = territoryLeads
            .filter(l => l.status === "won")
            .reduce((sum, l) => sum + (l.estimated_value || 0), 0);

          return {
            territory_id: territory.id,
            territory_name: territory.name,
            assigned_to: territory.profiles,
            metrics: {
              total_contacts: territoryContacts.length,
              total_leads: territoryLeads.length,
              total_pipeline_value: totalValue,
              won_value: wonValue,
              conversion_rate: territoryLeads.length > 0 
                ? (territoryLeads.filter(l => l.status === "won").length / territoryLeads.length * 100).toFixed(1)
                : 0,
              avg_deal_size: territoryLeads.length > 0 
                ? (totalValue / territoryLeads.length).toFixed(0)
                : 0
            }
          };
        }) || [];

        // Calculate balance score (how evenly distributed workload is)
        const leadCounts = analysis.map(a => a.metrics.total_leads);
        const avgLeads = leadCounts.reduce((a, b) => a + b, 0) / (leadCounts.length || 1);
        const variance = leadCounts.reduce((sum, count) => sum + Math.pow(count - avgLeads, 2), 0) / (leadCounts.length || 1);
        const stdDev = Math.sqrt(variance);
        const balanceScore = avgLeads > 0 ? Math.max(0, 100 - (stdDev / avgLeads * 100)).toFixed(0) : 100;

        return new Response(
          JSON.stringify({
            success: true,
            analysis,
            summary: {
              total_territories: territories?.length || 0,
              total_contacts: contacts?.length || 0,
              total_leads: pipelineEntries?.length || 0,
              balance_score: Number(balanceScore),
              balance_rating: Number(balanceScore) >= 80 ? "Good" : Number(balanceScore) >= 50 ? "Fair" : "Poor"
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "recommend_rebalance": {
        // Get current distribution
        const { data: territories } = await supabase
          .from("territories")
          .select("id, name, assigned_to")
          .eq("tenant_id", tenant_id);

        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, territory_id, latitude, longitude")
          .eq("tenant_id", tenant_id);

        const { data: pipelineEntries } = await supabase
          .from("pipeline_entries")
          .select("contact_id, estimated_value")
          .eq("tenant_id", tenant_id)
          .eq("status", "open");

        // Calculate current load per territory
        const territoryLoad = territories?.map(t => {
          const tContacts = contacts?.filter(c => c.territory_id === t.id) || [];
          const tValue = pipelineEntries
            ?.filter(pe => tContacts.some(c => c.id === pe.contact_id))
            .reduce((sum, pe) => sum + (pe.estimated_value || 0), 0) || 0;

          return {
            territory_id: t.id,
            name: t.name,
            assigned_to: t.assigned_to,
            contact_count: tContacts.length,
            pipeline_value: tValue
          };
        }) || [];

        // Calculate ideal distribution
        const totalValue = territoryLoad.reduce((sum, t) => sum + t.pipeline_value, 0);
        const idealValuePerTerritory = totalValue / (territoryLoad.length || 1);
        const totalContacts = contacts?.length || 0;
        const idealContactsPerTerritory = totalContacts / (territoryLoad.length || 1);

        // Generate recommendations
        const recommendations = territoryLoad.map(t => {
          const valueDeviation = ((t.pipeline_value - idealValuePerTerritory) / (idealValuePerTerritory || 1) * 100);
          const contactDeviation = ((t.contact_count - idealContactsPerTerritory) / (idealContactsPerTerritory || 1) * 100);

          let recommendation = "balanced";
          let action = null;

          if (valueDeviation > 30 || contactDeviation > 30) {
            recommendation = "overloaded";
            action = `Consider moving ${Math.abs(Math.round(t.contact_count - idealContactsPerTerritory))} contacts to other territories`;
          } else if (valueDeviation < -30 || contactDeviation < -30) {
            recommendation = "underutilized";
            action = `Can receive ${Math.abs(Math.round(idealContactsPerTerritory - t.contact_count))} more contacts`;
          }

          return {
            ...t,
            recommendation,
            action,
            value_deviation: valueDeviation.toFixed(1),
            contact_deviation: contactDeviation.toFixed(1)
          };
        });

        return new Response(
          JSON.stringify({
            success: true,
            recommendations,
            ideal_distribution: {
              contacts_per_territory: Math.round(idealContactsPerTerritory),
              value_per_territory: Math.round(idealValuePerTerritory)
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "execute_rebalance": {
        const { moves } = params as { moves: Array<{ contact_id: string; new_territory_id: string }> };

        if (!moves || !Array.isArray(moves)) {
          return new Response(
            JSON.stringify({ error: "moves array is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Execute the moves
        const results = await Promise.all(
          moves.map(async (move) => {
            const { error } = await supabase
              .from("contacts")
              .update({ territory_id: move.new_territory_id })
              .eq("id", move.contact_id)
              .eq("tenant_id", tenant_id);

            return { contact_id: move.contact_id, success: !error, error: error?.message };
          })
        );

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);

        console.log(`[sales-territory-balancer] Rebalance executed: ${successful}/${moves.length} successful`);

        return new Response(
          JSON.stringify({
            success: true,
            summary: {
              total_moves: moves.length,
              successful,
              failed: failed.length
            },
            failed_moves: failed
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "forecast_capacity": {
        const { weeks_ahead = 4 } = params;

        // Get historical lead generation rate
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: recentLeads, count: leadCount } = await supabase
          .from("pipeline_entries")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenant_id)
          .gte("created_at", thirtyDaysAgo.toISOString());

        const leadsPerDay = (leadCount || 0) / 30;
        const leadsPerWeek = leadsPerDay * 7;

        // Get current capacity (leads per rep)
        const { data: territories } = await supabase
          .from("territories")
          .select("id, assigned_to")
          .eq("tenant_id", tenant_id);

        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, territory_id")
          .eq("tenant_id", tenant_id);

        const activeReps = new Set(territories?.map(t => t.assigned_to).filter(Boolean)).size;
        const currentLeadsPerRep = contacts?.length ? contacts.length / (activeReps || 1) : 0;
        const maxCapacity = 50; // Assumed max leads per rep

        // Forecast
        const forecast = [];
        let projectedLeads = contacts?.length || 0;

        for (let week = 1; week <= Number(weeks_ahead); week++) {
          projectedLeads += leadsPerWeek;
          const projectedPerRep = projectedLeads / (activeReps || 1);
          const capacityUsed = (projectedPerRep / maxCapacity * 100).toFixed(0);

          forecast.push({
            week,
            projected_total_leads: Math.round(projectedLeads),
            projected_per_rep: Math.round(projectedPerRep),
            capacity_used: `${capacityUsed}%`,
            status: Number(capacityUsed) > 90 ? "critical" : Number(capacityUsed) > 70 ? "warning" : "healthy"
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            current: {
              total_leads: contacts?.length || 0,
              active_reps: activeReps,
              leads_per_rep: Math.round(currentLeadsPerRep),
              lead_velocity: leadsPerWeek.toFixed(1)
            },
            forecast,
            recommendation: Number(forecast[forecast.length - 1]?.capacity_used?.replace("%", "")) > 80
              ? "Consider hiring additional sales reps or expanding territories"
              : "Current capacity is sufficient for projected growth"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "identify_hotspots": {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, latitude, longitude, city, state, zip_code")
          .eq("tenant_id", tenant_id)
          .not("latitude", "is", null)
          .not("longitude", "is", null);

        const { data: wonDeals } = await supabase
          .from("pipeline_entries")
          .select("contact_id, estimated_value")
          .eq("tenant_id", tenant_id)
          .eq("status", "won");

        // Group by ZIP code
        const zipStats: Record<string, { 
          zip: string; 
          city: string;
          state: string;
          contacts: number; 
          deals: number; 
          revenue: number;
          coords: { lat: number; lng: number }[]
        }> = {};

        contacts?.forEach(contact => {
          if (contact.zip_code) {
            if (!zipStats[contact.zip_code]) {
              zipStats[contact.zip_code] = {
                zip: contact.zip_code,
                city: contact.city || "",
                state: contact.state || "",
                contacts: 0,
                deals: 0,
                revenue: 0,
                coords: []
              };
            }
            zipStats[contact.zip_code].contacts++;
            if (contact.latitude && contact.longitude) {
              zipStats[contact.zip_code].coords.push({ 
                lat: contact.latitude, 
                lng: contact.longitude 
              });
            }

            const deal = wonDeals?.find(d => d.contact_id === contact.id);
            if (deal) {
              zipStats[contact.zip_code].deals++;
              zipStats[contact.zip_code].revenue += deal.estimated_value || 0;
            }
          }
        });

        // Calculate hotspot scores
        const hotspots = Object.values(zipStats)
          .map(zip => {
            // Calculate centroid
            const centroid = zip.coords.length > 0 ? {
              lat: zip.coords.reduce((s, c) => s + c.lat, 0) / zip.coords.length,
              lng: zip.coords.reduce((s, c) => s + c.lng, 0) / zip.coords.length
            } : null;

            const conversionRate = zip.contacts > 0 ? (zip.deals / zip.contacts * 100) : 0;
            const avgDealSize = zip.deals > 0 ? zip.revenue / zip.deals : 0;
            
            // Composite score: weighted by conversion and revenue potential
            const score = (conversionRate * 0.4) + (Math.min(zip.revenue / 10000, 60) * 0.6);

            return {
              ...zip,
              centroid,
              conversion_rate: conversionRate.toFixed(1),
              avg_deal_size: avgDealSize.toFixed(0),
              hotspot_score: score.toFixed(0),
              coords: undefined // Remove individual coords from response
            };
          })
          .filter(z => z.contacts >= 3) // Minimum sample size
          .sort((a, b) => Number(b.hotspot_score) - Number(a.hotspot_score))
          .slice(0, 20);

        return new Response(
          JSON.stringify({
            success: true,
            hotspots,
            summary: {
              total_zips_analyzed: Object.keys(zipStats).length,
              top_hotspots: hotspots.slice(0, 5).map(h => h.zip)
            }
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
    console.error("[sales-territory-balancer] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
