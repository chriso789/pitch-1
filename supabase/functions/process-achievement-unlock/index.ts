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

    console.log(`Processing achievement unlock for user: ${user_id}`);

    // Get user's tenant_id
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("tenant_id")
      .eq("id", user_id)
      .single();

    if (profileError) throw profileError;

    // Get all active achievements for the tenant
    const { data: achievements, error: achievementsError } = await supabaseClient
      .from("canvass_achievements")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true);

    if (achievementsError) throw achievementsError;

    // Get user's activity stats
    const { data: activities, error: activitiesError } = await supabaseClient
      .from("canvass_activity_log")
      .select("activity_type, activity_data")
      .eq("user_id", user_id);

    if (activitiesError) throw activitiesError;

    const stats = {
      doors_knocked: activities.filter((a: any) => a.activity_type === "door_knock").length,
      leads_generated: activities.filter((a: any) => a.activity_type === "lead_created").length,
      photos_taken: activities.filter((a: any) => a.activity_type === "photo_upload").length,
      appointments_set: activities.filter((a: any) => a.activity_type === "appointment_set").length,
    };

    // Get already unlocked achievements
    const { data: userAchievements, error: userAchievementsError } = await supabaseClient
      .from("user_achievements")
      .select("achievement_id")
      .eq("user_id", user_id);

    if (userAchievementsError) throw userAchievementsError;

    const unlockedIds = new Set(userAchievements.map((ua: any) => ua.achievement_id));
    const newlyUnlocked = [];

    // Check each achievement
    for (const achievement of achievements) {
      if (unlockedIds.has(achievement.id)) continue;

      const criteria = achievement.criteria;
      if (!criteria || typeof criteria !== "object") continue;

      const metric = criteria.metric;
      const targetValue = criteria.target_value || 0;
      const currentValue = stats[metric as keyof typeof stats] || 0;

      if (currentValue >= targetValue) {
        // Unlock achievement
        const { error: insertError } = await supabaseClient
          .from("user_achievements")
          .insert({
            tenant_id: profile.tenant_id,
            user_id: user_id,
            achievement_id: achievement.id,
          });

        if (insertError) {
          console.error("Failed to insert user_achievement:", insertError);
          continue;
        }

        // Create reward if achievement has one
        if (achievement.reward_type && achievement.reward_value > 0) {
          const { error: rewardError } = await supabaseClient
            .from("achievement_rewards")
            .insert({
              tenant_id: profile.tenant_id,
              user_id: user_id,
              achievement_id: achievement.id,
              reward_type: achievement.reward_type,
              reward_value: achievement.reward_value,
              reward_metadata: achievement.reward_metadata || {},
              status: "pending",
            });

          if (rewardError) {
            console.error("Failed to create reward:", rewardError);
          }
        }

        newlyUnlocked.push({
          id: achievement.id,
          name: achievement.name,
          reward_type: achievement.reward_type,
          reward_value: achievement.reward_value,
        });

        console.log(`Achievement unlocked: ${achievement.name} for user ${user_id}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        unlocked_count: newlyUnlocked.length,
        achievements: newlyUnlocked,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error processing achievement unlock:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
