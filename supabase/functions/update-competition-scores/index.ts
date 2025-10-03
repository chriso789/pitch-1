import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { user_id } = await req.json();

    if (!user_id) {
      throw new Error("user_id is required");
    }

    console.log(`Updating competition scores for user: ${user_id}`);

    // Get user's active competitions
    const { data: participations, error: participationsError } = await supabaseClient
      .from("competition_participants")
      .select(`
        *,
        competition:canvass_competitions(*)
      `)
      .eq("user_id", user_id);

    if (participationsError) throw participationsError;

    const activeCompetitions = participations.filter((p: any) => 
      p.competition?.status === "active" || p.competition?.status === "published"
    );

    if (activeCompetitions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No active competitions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const updates = [];

    for (const participation of activeCompetitions) {
      const competition = participation.competition;
      const scoringCriteria = competition.scoring_criteria || {};

      // Get user's activities within competition timeframe
      const { data: activities, error: activitiesError } = await supabaseClient
        .from("canvass_activity_log")
        .select("*")
        .eq("user_id", user_id)
        .gte("created_at", competition.start_date)
        .lte("created_at", competition.end_date);

      if (activitiesError) throw activitiesError;

      // Calculate score based on criteria
      let score = 0;
      const metrics: any = {};

      const activityCounts = {
        door_knock: activities.filter((a: any) => a.activity_type === "door_knock").length,
        lead_created: activities.filter((a: any) => a.activity_type === "lead_created").length,
        photo_upload: activities.filter((a: any) => a.activity_type === "photo_upload").length,
        appointment_set: activities.filter((a: any) => a.activity_type === "appointment_set").length,
      };

      // Apply scoring weights
      if (scoringCriteria.door_knock_points) {
        score += activityCounts.door_knock * scoringCriteria.door_knock_points;
        metrics.doors_knocked = activityCounts.door_knock;
      }
      if (scoringCriteria.lead_points) {
        score += activityCounts.lead_created * scoringCriteria.lead_points;
        metrics.leads_generated = activityCounts.lead_created;
      }
      if (scoringCriteria.photo_points) {
        score += activityCounts.photo_upload * scoringCriteria.photo_points;
        metrics.photos_taken = activityCounts.photo_upload;
      }
      if (scoringCriteria.appointment_points) {
        score += activityCounts.appointment_set * scoringCriteria.appointment_points;
        metrics.appointments_set = activityCounts.appointment_set;
      }

      // Update participant score
      const { error: updateError } = await supabaseClient
        .from("competition_participants")
        .update({
          current_score: score,
          metrics: metrics,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", participation.id);

      if (updateError) throw updateError;

      updates.push({
        competition_id: competition.id,
        competition_name: competition.name,
        score: score,
        metrics: metrics,
      });

      console.log(`Updated score for competition ${competition.name}: ${score}`);
    }

    // Recalculate rankings for each competition
    for (const participation of activeCompetitions) {
      const { data: allParticipants, error: rankError } = await supabaseClient
        .from("competition_participants")
        .select("id, current_score")
        .eq("competition_id", participation.competition_id)
        .order("current_score", { ascending: false });

      if (rankError) throw rankError;

      // Update ranks
      for (let i = 0; i < allParticipants.length; i++) {
        await supabaseClient
          .from("competition_participants")
          .update({ current_rank: i + 1 })
          .eq("id", allParticipants[i].id);
      }

      // Create leaderboard snapshot
      const leaderboardEntries = allParticipants.slice(0, 10).map((p: any, idx: number) => ({
        tenant_id: participation.tenant_id,
        competition_id: participation.competition_id,
        user_id: p.user_id,
        rank: idx + 1,
        score: p.current_score,
        metrics: p.metrics || {},
        is_final: false,
      }));

      // Delete old non-final snapshots
      await supabaseClient
        .from("competition_leaderboards")
        .delete()
        .eq("competition_id", participation.competition_id)
        .eq("is_final", false);

      // Insert new snapshot
      await supabaseClient
        .from("competition_leaderboards")
        .insert(leaderboardEntries);
    }

    return new Response(
      JSON.stringify({
        success: true,
        updates: updates,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error updating competition scores:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
