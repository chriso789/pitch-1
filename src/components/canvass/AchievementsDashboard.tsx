import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Award, Star, Crown } from "lucide-react";
import ClaimPrizeButton from "@/components/stripe/ClaimPrizeButton";

const tierIcons = {
  bronze: Award,
  silver: Star,
  gold: Trophy,
  platinum: Crown,
};

const tierColors = {
  bronze: "bg-orange-600",
  silver: "bg-slate-400",
  gold: "bg-yellow-500",
  platinum: "bg-purple-600",
};

export function AchievementsDashboard() {
  const { data: achievements, isLoading: achievementsLoading } = useQuery({
    queryKey: ["achievements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvass_achievements")
        .select("*")
        .eq("is_active", true)
        .order("tier", { ascending: true })
        .order("reward_points", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userAchievements, isLoading: userAchievementsLoading } = useQuery({
    queryKey: ["user-achievements"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("user_achievements")
        .select("*, achievement:canvass_achievements(*)")
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: userActivity } = useQuery({
    queryKey: ["user-activity-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("canvass_activity_log")
        .select("activity_type, activity_data")
        .eq("user_id", user.id);
      if (error) throw error;

      const stats = {
        doors_knocked: 0,
        leads_generated: 0,
        photos_taken: 0,
        hours_logged: 0,
      };

      data.forEach((activity) => {
        if (activity.activity_type === "door_knock") stats.doors_knocked++;
        if (activity.activity_type === "lead_created") stats.leads_generated++;
        if (activity.activity_type === "photo_upload") stats.photos_taken++;
        const activityData = activity.activity_data as any;
        if (activityData?.hours) stats.hours_logged += activityData.hours;
      });

      return stats;
    },
  });

  const calculateProgress = (achievement: any) => {
    if (!userActivity || !achievement.criteria) return 0;
    
    const criteria = achievement.criteria;
    const targetValue = criteria.target_value || 100;
    let currentValue = 0;

    if (criteria.metric === "doors_knocked") currentValue = userActivity.doors_knocked;
    else if (criteria.metric === "leads_generated") currentValue = userActivity.leads_generated;
    else if (criteria.metric === "photos_taken") currentValue = userActivity.photos_taken;
    else if (criteria.metric === "hours_logged") currentValue = userActivity.hours_logged;

    return Math.min((currentValue / targetValue) * 100, 100);
  };

  const isUnlocked = (achievementId: string) => {
    return userAchievements?.some((ua) => ua.achievement_id === achievementId);
  };

  const { data: rewardsData } = useQuery({
    queryKey: ["achievement-rewards"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("achievement_rewards")
        .select("*")
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
  });

  const getReward = (achievementId: string) => {
    return rewardsData?.find((r) => r.achievement_id === achievementId);
  };

  if (achievementsLoading || userAchievementsLoading) {
    return <div className="text-center py-8">Loading achievements...</div>;
  }

  const groupedAchievements = achievements?.reduce((acc, achievement) => {
    if (!acc[achievement.tier]) acc[achievement.tier] = [];
    acc[achievement.tier].push(achievement);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Achievements</h2>
        <p className="text-muted-foreground">Track your progress and earn rewards</p>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unlocked">Unlocked</TabsTrigger>
          <TabsTrigger value="in-progress">In Progress</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          {Object.entries(groupedAchievements || {}).map(([tier, tierAchievements]) => {
            const Icon = tierIcons[tier as keyof typeof tierIcons];
            return (
              <div key={tier}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className={`h-6 w-6 ${tierColors[tier as keyof typeof tierColors]}`} />
                  <h3 className="text-xl font-semibold capitalize">{tier} Tier</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {tierAchievements.map((achievement) => {
                    const progress = calculateProgress(achievement);
                    const unlocked = isUnlocked(achievement.id);
                    const reward = getReward(achievement.id);

                    return (
                      <Card key={achievement.id} className={unlocked ? "border-primary" : ""}>
                        <CardHeader>
                          <div className="flex justify-between items-start">
                            <CardTitle className="text-lg">{achievement.name}</CardTitle>
                            <Badge variant={unlocked ? "default" : "secondary"}>
                              {achievement.reward_points} pts
                            </Badge>
                          </div>
                          <CardDescription>{achievement.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>Progress</span>
                              <span>{Math.round(progress)}%</span>
                            </div>
                            <Progress value={progress} />
                          </div>

                          {achievement.reward_type && achievement.reward_value > 0 && (
                            <div className="text-sm">
                              <span className="font-medium">Reward: </span>
                              {achievement.reward_type === "cash" && `$${achievement.reward_value}`}
                              {achievement.reward_type === "gift_card" && `$${achievement.reward_value} Gift Card`}
                              {achievement.reward_type === "physical" && achievement.reward_metadata?.item_name}
                              {achievement.reward_type === "points" && `${achievement.reward_value} Points`}
                            </div>
                          )}

                          {unlocked && reward && (
                            <ClaimPrizeButton 
                              rewardId={reward.id} 
                              rewardValue={reward.reward_value}
                              rewardStatus={reward.status}
                            />
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="unlocked" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {achievements
              ?.filter((a) => isUnlocked(a.id))
              .map((achievement) => {
                const reward = getReward(achievement.id);
                return (
                  <Card key={achievement.id} className="border-primary">
                    <CardHeader>
                      <CardTitle>{achievement.name}</CardTitle>
                      <CardDescription>{achievement.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {reward && (
                        <ClaimPrizeButton 
                          rewardId={reward.id}
                          rewardValue={reward.reward_value}
                          rewardStatus={reward.status}
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </TabsContent>

        <TabsContent value="in-progress" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {achievements
              ?.filter((a) => !isUnlocked(a.id) && calculateProgress(a) > 0)
              .map((achievement) => {
                const progress = calculateProgress(achievement);
                return (
                  <Card key={achievement.id}>
                    <CardHeader>
                      <CardTitle>{achievement.name}</CardTitle>
                      <CardDescription>{achievement.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Progress value={progress} />
                      <p className="text-sm text-muted-foreground mt-2">
                        {Math.round(progress)}% complete
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
