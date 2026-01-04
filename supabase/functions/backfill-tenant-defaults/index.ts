import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * BACKFILL TENANT DEFAULTS
 * 
 * This function applies missing default configurations to existing tenants.
 * It ensures all companies have the same base functionality that new companies get.
 * 
 * Can be called:
 * - With no body: processes ALL tenants
 * - With { tenant_id: "uuid" }: processes a single tenant
 * - With { dry_run: true }: shows what would be created without making changes
 */

interface BackfillRequest {
  tenant_id?: string;
  dry_run?: boolean;
}

interface BackfillResult {
  tenant_id: string;
  tenant_name: string;
  dynamic_pricing_config: boolean;
  pipeline_stages: number;
  job_types: number;
  tags: number;
  commission_plans: number;
  errors: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Verify caller is master or admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check if user is master
    const { data: callerRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["master", "corporate"])
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Only master/corporate users can run backfill" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse request
    let requestBody: BackfillRequest = {};
    try {
      requestBody = await req.json();
    } catch {
      // Empty body is fine - process all tenants
    }

    const { tenant_id, dry_run = false } = requestBody;

    console.log(`[backfill-tenant-defaults] Starting backfill. tenant_id=${tenant_id || 'ALL'}, dry_run=${dry_run}`);

    // Get tenants to process
    let tenantsQuery = supabase.from("tenants").select("id, name");
    if (tenant_id) {
      tenantsQuery = tenantsQuery.eq("id", tenant_id);
    }
    
    const { data: tenants, error: tenantsError } = await tenantsQuery;

    if (tenantsError) {
      throw new Error(`Failed to fetch tenants: ${tenantsError.message}`);
    }

    if (!tenants || tenants.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No tenants found to process",
        results: [] 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`[backfill-tenant-defaults] Processing ${tenants.length} tenant(s)`);

    const results: BackfillResult[] = [];

    for (const tenant of tenants) {
      const result: BackfillResult = {
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        dynamic_pricing_config: false,
        pipeline_stages: 0,
        job_types: 0,
        tags: 0,
        commission_plans: 0,
        errors: []
      };

      try {
        // 1. Check/Create dynamic_pricing_config
        const { data: existingConfig } = await supabase
          .from("dynamic_pricing_config")
          .select("id")
          .eq("tenant_id", tenant.id)
          .maybeSingle();

        if (!existingConfig) {
          const defaultPricingConfig = {
            tenant_id: tenant.id,
            base_markup_percent: 25,
            min_margin_percent: 15,
            max_margin_percent: 45,
            weather_risk_multiplier: 1.15,
            backlog_multiplier: 1.10,
            season_multipliers: {
              spring: 1.05,
              summer: 1.10,
              fall: 1.00,
              winter: 0.95
            },
            vendor_leadtime_multipliers: {
              "0-7": 1.00,
              "8-14": 1.02,
              "15-30": 1.05,
              "30+": 1.08
            },
            price_anomaly_threshold_percent: 15,
            is_active: true
          };

          if (!dry_run) {
            const { error: configError } = await supabase
              .from("dynamic_pricing_config")
              .insert(defaultPricingConfig);

            if (configError) {
              result.errors.push(`dynamic_pricing_config: ${configError.message}`);
            } else {
              result.dynamic_pricing_config = true;
              console.log(`[backfill] Created dynamic_pricing_config for ${tenant.name}`);
            }
          } else {
            result.dynamic_pricing_config = true; // Would be created
          }
        }

        // 2. Check/Create pipeline_stages
        const { data: existingStages, error: stagesCheckError } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("tenant_id", tenant.id)
          .limit(1);

        if (!stagesCheckError && (!existingStages || existingStages.length === 0)) {
          const defaultStages = [
            { tenant_id: tenant.id, name: 'New Lead', stage_order: 1, color: '#3b82f6', is_active: true },
            { tenant_id: tenant.id, name: 'Contacted', stage_order: 2, color: '#8b5cf6', is_active: true },
            { tenant_id: tenant.id, name: 'Inspection Scheduled', stage_order: 3, color: '#f59e0b', is_active: true },
            { tenant_id: tenant.id, name: 'Estimate Sent', stage_order: 4, color: '#ec4899', is_active: true },
            { tenant_id: tenant.id, name: 'Negotiation', stage_order: 5, color: '#6366f1', is_active: true },
            { tenant_id: tenant.id, name: 'Sold', stage_order: 6, color: '#22c55e', is_active: true },
            { tenant_id: tenant.id, name: 'In Production', stage_order: 7, color: '#14b8a6', is_active: true },
            { tenant_id: tenant.id, name: 'Complete', stage_order: 8, color: '#10b981', is_active: true },
            { tenant_id: tenant.id, name: 'Lost', stage_order: 9, color: '#ef4444', is_active: true },
          ];

          if (!dry_run) {
            const { data: stagesData, error: stagesError } = await supabase
              .from("pipeline_stages")
              .insert(defaultStages)
              .select();

            if (stagesError) {
              result.errors.push(`pipeline_stages: ${stagesError.message}`);
            } else {
              result.pipeline_stages = stagesData?.length || 0;
              console.log(`[backfill] Created ${result.pipeline_stages} pipeline_stages for ${tenant.name}`);
            }
          } else {
            result.pipeline_stages = defaultStages.length;
          }
        }

        // 3. Check/Create job_types
        const { data: existingJobTypes } = await supabase
          .from("job_types")
          .select("id")
          .eq("tenant_id", tenant.id)
          .limit(1);

        if (!existingJobTypes || existingJobTypes.length === 0) {
          const defaultJobTypes = [
            { tenant_id: tenant.id, name: 'Roofing - Shingle', description: 'Asphalt shingle roofing', is_active: true },
            { tenant_id: tenant.id, name: 'Roofing - Metal', description: 'Metal roofing installation', is_active: true },
            { tenant_id: tenant.id, name: 'Roofing - Tile', description: 'Tile roofing installation', is_active: true },
            { tenant_id: tenant.id, name: 'Siding', description: 'Siding installation and repair', is_active: true },
            { tenant_id: tenant.id, name: 'Gutters', description: 'Gutter installation and repair', is_active: true },
            { tenant_id: tenant.id, name: 'Storm Damage', description: 'Storm damage restoration', is_active: true },
          ];

          if (!dry_run) {
            const { error: jobTypesError } = await supabase
              .from("job_types")
              .insert(defaultJobTypes);

            if (jobTypesError) {
              result.errors.push(`job_types: ${jobTypesError.message}`);
            } else {
              result.job_types = defaultJobTypes.length;
              console.log(`[backfill] Created ${result.job_types} job_types for ${tenant.name}`);
            }
          } else {
            result.job_types = defaultJobTypes.length;
          }
        }

        // 4. Check/Create tags
        const { data: existingTags } = await supabase
          .from("tags")
          .select("id")
          .eq("tenant_id", tenant.id)
          .limit(1);

        if (!existingTags || existingTags.length === 0) {
          const defaultTags = [
            { tenant_id: tenant.id, name: 'Hot Lead', color: '#ef4444', tag_type: 'contact' },
            { tenant_id: tenant.id, name: 'Referral', color: '#22c55e', tag_type: 'contact' },
            { tenant_id: tenant.id, name: 'Insurance', color: '#3b82f6', tag_type: 'contact' },
            { tenant_id: tenant.id, name: 'VIP', color: '#8b5cf6', tag_type: 'contact' },
            { tenant_id: tenant.id, name: 'Urgent', color: '#ef4444', tag_type: 'project' },
          ];

          if (!dry_run) {
            const { error: tagsError } = await supabase
              .from("tags")
              .insert(defaultTags);

            if (tagsError) {
              result.errors.push(`tags: ${tagsError.message}`);
            } else {
              result.tags = defaultTags.length;
              console.log(`[backfill] Created ${result.tags} tags for ${tenant.name}`);
            }
          } else {
            result.tags = defaultTags.length;
          }
        }

        // 5. Check/Create commission_plans
        const { data: existingPlans } = await supabase
          .from("commission_plans")
          .select("id")
          .eq("tenant_id", tenant.id)
          .limit(1);

        if (!existingPlans || existingPlans.length === 0) {
          const defaultPlan = {
            tenant_id: tenant.id,
            name: 'Standard Commission',
            commission_type: 'percentage',
            base_rate: 10,
            is_active: true,
            plan_config: {
              type: 'percentage',
              rate: 10,
              description: 'Standard 10% commission on contract value'
            }
          };

          if (!dry_run) {
            const { error: planError } = await supabase
              .from("commission_plans")
              .insert(defaultPlan);

            if (planError) {
              result.errors.push(`commission_plans: ${planError.message}`);
            } else {
              result.commission_plans = 1;
              console.log(`[backfill] Created commission_plan for ${tenant.name}`);
            }
          } else {
            result.commission_plans = 1;
          }
        }

      } catch (tenantError: any) {
        result.errors.push(`General error: ${tenantError.message}`);
        console.error(`[backfill] Error processing ${tenant.name}:`, tenantError);
      }

      results.push(result);
    }

    // Summary
    const summary = {
      total_tenants: results.length,
      tenants_with_errors: results.filter(r => r.errors.length > 0).length,
      configs_created: results.filter(r => r.dynamic_pricing_config).length,
      stages_created: results.reduce((sum, r) => sum + r.pipeline_stages, 0),
      job_types_created: results.reduce((sum, r) => sum + r.job_types, 0),
      tags_created: results.reduce((sum, r) => sum + r.tags, 0),
      commission_plans_created: results.reduce((sum, r) => sum + r.commission_plans, 0),
    };

    console.log(`[backfill-tenant-defaults] Complete. Summary:`, summary);

    return new Response(
      JSON.stringify({ 
        success: true,
        dry_run,
        message: dry_run ? "Dry run complete - no changes made" : "Backfill complete",
        summary,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[backfill-tenant-defaults] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
