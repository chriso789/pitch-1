import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CrossSellRequest {
  action: "find_opportunities" | "score_customer" | "generate_campaign" | "track_conversion" | "recommend_services";
  tenant_id: string;
  params?: Record<string, unknown>;
}

// Service categories for cross-sell analysis
const SERVICE_CATEGORIES = {
  roofing: ["roof_replacement", "roof_repair", "roof_inspection"],
  siding: ["siding_replacement", "siding_repair"],
  gutters: ["gutter_installation", "gutter_cleaning", "gutter_repair"],
  windows: ["window_replacement", "window_repair"],
  solar: ["solar_installation", "solar_maintenance"],
  insulation: ["attic_insulation", "wall_insulation"],
  exterior: ["painting", "deck_repair", "fence_installation"]
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { action, tenant_id, params = {} } = await req.json() as CrossSellRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[cross-sell-analyzer] Action: ${action}, Tenant: ${tenant_id}`);

    switch (action) {
      case "find_opportunities": {
        const { min_age_days = 180, limit = 50 } = params;

        // Get completed projects with their contacts
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - Number(min_age_days));

        const { data: completedProjects } = await supabase
          .from("projects")
          .select(`
            id,
            contact_id,
            project_type,
            contract_amount,
            completed_at,
            contacts!projects_contact_id_fkey (
              id,
              first_name,
              last_name,
              email,
              phone,
              address,
              city,
              state,
              property_type,
              property_year_built
            )
          `)
          .eq("tenant_id", tenant_id)
          .eq("status", "completed")
          .lte("completed_at", cutoffDate.toISOString())
          .order("completed_at", { ascending: false })
          .limit(Number(limit) * 2);

        // Analyze for cross-sell opportunities
        const opportunities: Array<{
          contact: unknown;
          completed_services: string[];
          recommended_services: Array<{ service: string; reason: string; priority: string }>;
          opportunity_score: number;
          estimated_value: number;
        }> = [];

        const contactProjects: Record<string, typeof completedProjects> = {};
        completedProjects?.forEach(project => {
          if (project.contact_id) {
            if (!contactProjects[project.contact_id]) {
              contactProjects[project.contact_id] = [];
            }
            contactProjects[project.contact_id].push(project);
          }
        });

        Object.entries(contactProjects).forEach(([contactId, projects]) => {
          const contact = projects[0]?.contacts;
          if (!contact) return;

          const completedServices = projects.map(p => p.project_type).filter(Boolean);
          const totalSpent = projects.reduce((sum, p) => sum + (p.contract_amount || 0), 0);
          const lastProjectDate = projects[0]?.completed_at;
          const daysSinceLastProject = lastProjectDate 
            ? Math.floor((Date.now() - new Date(lastProjectDate).getTime()) / (1000 * 60 * 60 * 24))
            : 999;

          // Determine recommended services
          const recommendations: Array<{ service: string; reason: string; priority: string }> = [];

          // If they got roofing, recommend gutters and siding
          if (completedServices.some(s => s?.toLowerCase().includes("roof"))) {
            if (!completedServices.some(s => s?.toLowerCase().includes("gutter"))) {
              recommendations.push({
                service: "Gutter Installation/Cleaning",
                reason: "Complement to recent roof work - protects investment",
                priority: "high"
              });
            }
            if (!completedServices.some(s => s?.toLowerCase().includes("siding"))) {
              recommendations.push({
                service: "Siding Inspection",
                reason: "Often discovered during roofing projects",
                priority: "medium"
              });
            }
          }

          // Property age analysis
          const propertyAge = (contact as any).property_year_built 
            ? new Date().getFullYear() - (contact as any).property_year_built 
            : null;

          if (propertyAge && propertyAge > 20) {
            if (!completedServices.some(s => s?.toLowerCase().includes("window"))) {
              recommendations.push({
                service: "Window Replacement",
                reason: `Property is ${propertyAge} years old - likely needs window updates`,
                priority: "medium"
              });
            }
            if (!completedServices.some(s => s?.toLowerCase().includes("insulation"))) {
              recommendations.push({
                service: "Insulation Upgrade",
                reason: "Older homes typically have inadequate insulation",
                priority: "low"
              });
            }
          }

          // Seasonal recommendations
          const currentMonth = new Date().getMonth();
          if (currentMonth >= 8 && currentMonth <= 10) { // Fall
            recommendations.push({
              service: "Gutter Cleaning",
              reason: "Seasonal maintenance before winter",
              priority: "high"
            });
          } else if (currentMonth >= 2 && currentMonth <= 4) { // Spring
            recommendations.push({
              service: "Roof Inspection",
              reason: "Post-winter damage assessment",
              priority: "medium"
            });
          }

          // Calculate opportunity score
          const recencyScore = Math.max(0, 100 - (daysSinceLastProject / 10));
          const spendScore = Math.min(50, totalSpent / 500);
          const recommendationScore = recommendations.length * 10;
          const opportunityScore = Math.min(100, recencyScore * 0.3 + spendScore * 0.3 + recommendationScore * 0.4);

          if (recommendations.length > 0) {
            opportunities.push({
              contact,
              completed_services: completedServices,
              recommended_services: recommendations.slice(0, 3),
              opportunity_score: Math.round(opportunityScore),
              estimated_value: Math.round(totalSpent * 0.5) // Estimate 50% of previous spend
            });
          }
        });

        // Sort by opportunity score
        opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);

        return new Response(
          JSON.stringify({
            success: true,
            opportunities: opportunities.slice(0, Number(limit)),
            summary: {
              total_opportunities: opportunities.length,
              high_priority: opportunities.filter(o => o.opportunity_score >= 70).length,
              total_estimated_value: opportunities.reduce((sum, o) => sum + o.estimated_value, 0)
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "score_customer": {
        const { contact_id } = params;

        if (!contact_id) {
          return new Response(
            JSON.stringify({ error: "contact_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get contact data
        const { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("id", contact_id)
          .eq("tenant_id", tenant_id)
          .single();

        // Get all projects for this contact
        const { data: projects } = await supabase
          .from("projects")
          .select("*")
          .eq("contact_id", contact_id)
          .eq("tenant_id", tenant_id);

        // Get communication history
        const { count: callCount } = await supabase
          .from("call_logs")
          .select("*", { count: "exact" })
          .eq("contact_id", contact_id)
          .eq("tenant_id", tenant_id);

        const { count: smsCount } = await supabase
          .from("sms_messages")
          .select("*", { count: "exact" })
          .eq("contact_id", contact_id)
          .eq("tenant_id", tenant_id);

        // Calculate lifetime value
        const lifetimeValue = projects?.reduce((sum, p) => sum + (p.contract_amount || 0), 0) || 0;
        const projectCount = projects?.length || 0;
        const avgProjectValue = projectCount > 0 ? lifetimeValue / projectCount : 0;

        // Calculate engagement score
        const communicationScore = Math.min(30, ((callCount || 0) + (smsCount || 0)) * 3);
        const projectScore = Math.min(40, projectCount * 15);
        const valueScore = Math.min(30, lifetimeValue / 1000);
        const engagementScore = communicationScore + projectScore + valueScore;

        // Propensity to buy again
        const daysSinceLastProject = projects?.length 
          ? Math.floor((Date.now() - new Date(projects[0].completed_at || projects[0].created_at).getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        
        let propensityScore = 50;
        if (projectCount >= 2) propensityScore += 20;
        if (daysSinceLastProject < 365) propensityScore += 15;
        if (lifetimeValue > 10000) propensityScore += 15;
        propensityScore = Math.min(100, propensityScore);

        return new Response(
          JSON.stringify({
            success: true,
            customer_score: {
              contact_id,
              contact_name: `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim(),
              lifetime_value: lifetimeValue,
              total_projects: projectCount,
              avg_project_value: Math.round(avgProjectValue),
              engagement_score: Math.round(engagementScore),
              propensity_score: propensityScore,
              customer_tier: lifetimeValue > 20000 ? "platinum" 
                : lifetimeValue > 10000 ? "gold" 
                : lifetimeValue > 5000 ? "silver" : "bronze",
              days_since_last_project: daysSinceLastProject,
              communication_activity: {
                calls: callCount || 0,
                sms: smsCount || 0
              }
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "generate_campaign": {
        const { campaign_type = "cross_sell", min_score = 50, limit = 100 } = params;

        // Get opportunities
        const { data: completedProjects } = await supabase
          .from("projects")
          .select(`
            contact_id,
            project_type,
            contract_amount,
            completed_at,
            contacts!projects_contact_id_fkey (
              id,
              first_name,
              last_name,
              email,
              phone
            )
          `)
          .eq("tenant_id", tenant_id)
          .eq("status", "completed")
          .not("contacts.email", "is", null);

        // Filter and dedupe by contact
        const contactMap = new Map();
        completedProjects?.forEach(project => {
          if (project.contacts && !contactMap.has(project.contact_id)) {
            contactMap.set(project.contact_id, {
              contact: project.contacts,
              total_spent: project.contract_amount || 0,
              last_project: project.completed_at,
              services: [project.project_type]
            });
          } else if (project.contacts) {
            const existing = contactMap.get(project.contact_id);
            existing.total_spent += project.contract_amount || 0;
            existing.services.push(project.project_type);
          }
        });

        // Score and filter
        const campaignTargets = Array.from(contactMap.values())
          .map(entry => {
            const daysSinceLast = entry.last_project 
              ? Math.floor((Date.now() - new Date(entry.last_project).getTime()) / (1000 * 60 * 60 * 24))
              : 999;
            
            let score = 50;
            if (entry.total_spent > 10000) score += 25;
            else if (entry.total_spent > 5000) score += 15;
            if (daysSinceLast >= 180 && daysSinceLast <= 730) score += 25; // 6mo - 2yr sweet spot

            return {
              ...entry,
              score,
              days_since_last: daysSinceLast
            };
          })
          .filter(t => t.score >= Number(min_score))
          .sort((a, b) => b.score - a.score)
          .slice(0, Number(limit));

        // Generate campaign suggestions based on type
        let campaignSuggestions = {};
        if (campaign_type === "cross_sell") {
          campaignSuggestions = {
            subject_line: "Time for your home's next upgrade?",
            template_type: "cross_sell_services",
            recommended_channel: "email",
            timing: "Tuesday or Wednesday, 10am-2pm"
          };
        } else if (campaign_type === "seasonal") {
          const month = new Date().getMonth();
          campaignSuggestions = {
            subject_line: month >= 8 ? "Prepare your home for winter" : "Spring home maintenance time",
            template_type: "seasonal_reminder",
            recommended_channel: "email",
            timing: "Monday morning"
          };
        }

        return new Response(
          JSON.stringify({
            success: true,
            campaign: {
              type: campaign_type,
              target_count: campaignTargets.length,
              targets: campaignTargets.map(t => ({
                contact_id: t.contact.id,
                name: `${t.contact.first_name} ${t.contact.last_name}`,
                email: t.contact.email,
                phone: t.contact.phone,
                score: t.score,
                total_spent: t.total_spent,
                days_since_last: t.days_since_last
              })),
              suggestions: campaignSuggestions,
              estimated_response_rate: "3-5%",
              estimated_conversion_rate: "15-20%"
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "track_conversion": {
        const { contact_id, campaign_id, converted, new_project_value } = params;

        if (!contact_id) {
          return new Response(
            JSON.stringify({ error: "contact_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Log the conversion event
        const { error } = await supabase
          .from("activity_log")
          .insert({
            tenant_id,
            entity_type: "cross_sell_conversion",
            entity_id: contact_id,
            action: converted ? "converted" : "declined",
            metadata: {
              campaign_id,
              converted,
              project_value: new_project_value
            }
          });

        if (error) {
          console.error("[cross-sell-analyzer] Error tracking conversion:", error);
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Conversion tracked successfully",
            converted,
            value: new_project_value
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "recommend_services": {
        const { contact_id } = params;

        if (!contact_id) {
          return new Response(
            JSON.stringify({ error: "contact_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get contact and their history
        const { data: contact } = await supabase
          .from("contacts")
          .select("*, property_type, property_year_built")
          .eq("id", contact_id)
          .single();

        const { data: projects } = await supabase
          .from("projects")
          .select("project_type, completed_at, contract_amount")
          .eq("contact_id", contact_id)
          .eq("status", "completed");

        const completedServices = projects?.map(p => p.project_type?.toLowerCase()) || [];
        const recommendations: Array<{
          service: string;
          confidence: number;
          reason: string;
          estimated_value: number;
          urgency: string;
        }> = [];

        // Cross-sell logic based on completed services
        if (completedServices.some(s => s?.includes("roof"))) {
          if (!completedServices.some(s => s?.includes("gutter"))) {
            recommendations.push({
              service: "Gutter System",
              confidence: 85,
              reason: "Protects your new roof investment",
              estimated_value: 3500,
              urgency: "high"
            });
          }
          if (!completedServices.some(s => s?.includes("attic") || s?.includes("insulation"))) {
            recommendations.push({
              service: "Attic Insulation",
              confidence: 70,
              reason: "Maximize energy efficiency with new roof",
              estimated_value: 2500,
              urgency: "medium"
            });
          }
        }

        if (completedServices.some(s => s?.includes("siding"))) {
          if (!completedServices.some(s => s?.includes("window"))) {
            recommendations.push({
              service: "Window Replacement",
              confidence: 75,
              reason: "Complete your exterior renovation",
              estimated_value: 8000,
              urgency: "medium"
            });
          }
        }

        // Property age recommendations
        const propertyAge = contact?.property_year_built 
          ? new Date().getFullYear() - contact.property_year_built 
          : null;

        if (propertyAge && propertyAge > 25) {
          recommendations.push({
            service: "Full Home Inspection",
            confidence: 60,
            reason: `Your ${propertyAge}-year-old home may benefit from a comprehensive assessment`,
            estimated_value: 500,
            urgency: "low"
          });
        }

        // Sort by confidence
        recommendations.sort((a, b) => b.confidence - a.confidence);

        return new Response(
          JSON.stringify({
            success: true,
            contact_id,
            completed_services: completedServices,
            recommendations: recommendations.slice(0, 5),
            property_info: {
              type: contact?.property_type,
              year_built: contact?.property_year_built,
              age: propertyAge
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
    console.error("[cross-sell-analyzer] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
