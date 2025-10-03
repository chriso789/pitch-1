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

    const { competition_id } = await req.json();

    if (!competition_id) {
      throw new Error("competition_id is required");
    }

    console.log(`Finalizing competition: ${competition_id}`);

    // Get competition details
    const { data: competition, error: competitionError } = await supabaseClient
      .from("canvass_competitions")
      .select("*")
      .eq("id", competition_id)
      .single();

    if (competitionError) throw competitionError;

    // Get final rankings
    const { data: participants, error: participantsError } = await supabaseClient
      .from("competition_participants")
      .select("*")
      .eq("competition_id", competition_id)
      .order("current_score", { ascending: false });

    if (participantsError) throw participantsError;

    const prizePool = competition.prize_pool || {};
    const rewards = [];

    // Distribute prizes to top performers
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      const rank = i + 1;
      const prizeKey = `rank_${rank}`;

      if (prizePool[prizeKey]) {
        const prizeAmount = prizePool[prizeKey];

        // Create reward
        const { data: reward, error: rewardError } = await supabaseClient
          .from("achievement_rewards")
          .insert({
            tenant_id: participant.tenant_id,
            user_id: participant.user_id,
            competition_id: competition_id,
            reward_type: "cash",
            reward_value: prizeAmount,
            reward_metadata: {
              competition_name: competition.name,
              rank: rank,
              score: participant.current_score,
            },
            status: "pending",
          })
          .select()
          .single();

        if (rewardError) {
          console.error(`Failed to create reward for user ${participant.user_id}:`, rewardError);
          continue;
        }

        rewards.push({
          user_id: participant.user_id,
          rank: rank,
          prize: prizeAmount,
          reward_id: reward.id,
        });

        console.log(`Created prize for rank ${rank}: $${prizeAmount}`);
      }
    }

    // Create final leaderboard snapshot
    const leaderboardEntries = participants.map((p: any, idx: number) => ({
      tenant_id: p.tenant_id,
      competition_id: competition_id,
      user_id: p.user_id,
      rank: idx + 1,
      score: p.current_score,
      metrics: p.metrics || {},
      is_final: true,
    }));

    // Delete old final snapshots
    await supabaseClient
      .from("competition_leaderboards")
      .delete()
      .eq("competition_id", competition_id)
      .eq("is_final", true);

    // Insert final snapshot
    const { error: leaderboardError } = await supabaseClient
      .from("competition_leaderboards")
      .insert(leaderboardEntries);

    if (leaderboardError) throw leaderboardError;

    // Update competition status
    const { error: updateError } = await supabaseClient
      .from("canvass_competitions")
      .update({ status: "completed" })
      .eq("id", competition_id);

    if (updateError) throw updateError;

    console.log(`Competition ${competition.name} finalized with ${rewards.length} prizes`);

    return new Response(
      JSON.stringify({
        success: true,
        competition_name: competition.name,
        total_participants: participants.length,
        prizes_distributed: rewards.length,
        rewards: rewards,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error finalizing competition:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
