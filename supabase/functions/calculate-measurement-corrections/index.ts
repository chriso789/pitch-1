import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FeatureAccumulator {
  ai_total: number;
  manual_total: number;
  count: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's tenant
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = profile.tenant_id;

    // Fetch all completed training sessions with AI and traced totals
    const { data: sessions, error: sessionsError } = await supabase
      .from("roof_training_sessions")
      .select("id, ai_totals, traced_totals")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .not("ai_totals", "is", null)
      .not("traced_totals", "is", null);

    if (sessionsError) {
      console.error("Error fetching sessions:", sessionsError);
      return new Response(JSON.stringify({ error: sessionsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ 
        message: "No completed training sessions with comparison data",
        sessions_analyzed: 0,
        corrections: []
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Analyzing ${sessions.length} training sessions for tenant ${tenantId}`);

    // Accumulate totals by feature type
    const featureTypes = ['ridge', 'hip', 'valley', 'eave', 'rake'];
    const accumulators: Record<string, FeatureAccumulator> = {};
    
    featureTypes.forEach(type => {
      accumulators[type] = { ai_total: 0, manual_total: 0, count: 0 };
    });

    sessions.forEach(session => {
      const aiTotals = session.ai_totals as Record<string, number> | null;
      const tracedTotals = session.traced_totals as Record<string, number> | null;

      if (!aiTotals || !tracedTotals) return;

      featureTypes.forEach(type => {
        // Handle both formats: "ridge" and "ridge_ft"
        const aiVal = aiTotals[type] ?? aiTotals[`${type}_ft`] ?? 0;
        const manualVal = tracedTotals[type] ?? tracedTotals[`${type}_ft`] ?? 0;

        // Only include if we have meaningful manual data
        if (manualVal > 0) {
          accumulators[type].ai_total += aiVal;
          accumulators[type].manual_total += manualVal;
          accumulators[type].count++;
        }
      });
    });

    // Calculate correction factors
    const corrections: {
      feature_type: string;
      correction_multiplier: number;
      sample_count: number;
      confidence: number;
      avg_variance_pct: number;
      total_ai_ft: number;
      total_manual_ft: number;
    }[] = [];

    featureTypes.forEach(type => {
      const acc = accumulators[type];
      
      if (acc.count === 0 || acc.manual_total === 0) {
        // No data - use 1.0 multiplier
        corrections.push({
          feature_type: type,
          correction_multiplier: 1.0,
          sample_count: 0,
          confidence: 0,
          avg_variance_pct: 0,
          total_ai_ft: 0,
          total_manual_ft: 0,
        });
        return;
      }

      // Calculate correction multiplier
      // If AI overestimates by 10%, multiplier = 0.909 (reduce by 10%)
      // If AI underestimates by 10%, multiplier = 1.111 (increase by 10%)
      const multiplier = acc.manual_total / acc.ai_total;
      
      // Clamp to reasonable range (0.5 to 2.0)
      const clampedMultiplier = Math.max(0.5, Math.min(2.0, multiplier));
      
      // Calculate variance percentage
      const variancePct = ((acc.ai_total - acc.manual_total) / acc.manual_total) * 100;
      
      // Calculate confidence based on sample count and consistency
      // More samples = higher confidence
      const confidenceFromSamples = Math.min(1, acc.count / 10);
      
      // Lower variance = higher confidence (if AI is already accurate, we're more confident)
      const absVariance = Math.abs(variancePct);
      const confidenceFromAccuracy = absVariance < 5 ? 1 : absVariance < 15 ? 0.7 : 0.4;
      
      const confidence = (confidenceFromSamples * 0.6 + confidenceFromAccuracy * 0.4);

      corrections.push({
        feature_type: type,
        correction_multiplier: clampedMultiplier,
        sample_count: acc.count,
        confidence,
        avg_variance_pct: variancePct,
        total_ai_ft: acc.ai_total,
        total_manual_ft: acc.manual_total,
      });

      console.log(`${type}: AI=${acc.ai_total.toFixed(0)}ft, Manual=${acc.manual_total.toFixed(0)}ft, ` +
        `Variance=${variancePct.toFixed(1)}%, Multiplier=${clampedMultiplier.toFixed(4)}, ` +
        `Confidence=${(confidence * 100).toFixed(0)}%`);
    });

    // Upsert correction factors
    for (const correction of corrections) {
      const { error: upsertError } = await supabase
        .from("measurement_correction_factors")
        .upsert({
          tenant_id: tenantId,
          feature_type: correction.feature_type,
          correction_multiplier: correction.correction_multiplier,
          sample_count: correction.sample_count,
          confidence: correction.confidence,
          avg_variance_pct: correction.avg_variance_pct,
          total_ai_ft: correction.total_ai_ft,
          total_manual_ft: correction.total_manual_ft,
          last_updated: new Date().toISOString(),
        }, {
          onConflict: "tenant_id,feature_type",
        });

      if (upsertError) {
        console.error(`Error upserting ${correction.feature_type}:`, upsertError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      sessions_analyzed: sessions.length,
      corrections,
      message: `Calculated correction factors from ${sessions.length} training sessions`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error calculating corrections:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
