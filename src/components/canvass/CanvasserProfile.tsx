import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, DollarSign, Target, Zap, MapPin, Calendar } from "lucide-react";

export function CanvasserProfile() {
  const { data: profile } = useQuery({
    queryKey: ["canvasser-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: achievements } = useQuery({
    queryKey: ["user-achievements-count"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { count, error } = await supabase
        .from("user_achievements")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: earnings } = useQuery({
    queryKey: ["user-earnings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("achievement_rewards")
        .select("reward_value, status")
        .eq("user_id", user.id);
      if (error) throw error;

      const total = data.reduce((sum, reward) => sum + (Number(reward.reward_value) || 0), 0);
      const claimed = data.filter((r) => r.status === "delivered" || r.status === "claimed").length;

      return { total, claimed, pending: data.length - claimed };
    },
  });

  const { data: activityStats } = useQuery({
    queryKey: ["activity-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("canvass_activity_log")
        .select("activity_type, created_at, verified")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const stats = {
        totalActivities: data.length,
        verifiedActivities: data.filter((a) => a.verified).length,
        lastActivity: data[0]?.created_at,
        thisWeek: data.filter((a) => {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return new Date(a.created_at) > weekAgo;
        }).length,
      };

      return stats;
    },
  });

  const { data: competitions } = useQuery({
    queryKey: ["user-competitions-count"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("competition_participants")
        .select("*, competition:canvass_competitions(status)")
        .eq("user_id", user.id);
      if (error) throw error;

      return {
        total: data.length,
        active: data.filter((p) => p.competition?.status === "active").length,
        completed: data.filter((p) => p.competition?.status === "completed").length,
      };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">
          {profile?.first_name} {profile?.last_name}
        </h2>
        <p className="text-muted-foreground">Canvasser Profile</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${earnings?.total.toFixed(2) || "0.00"}</div>
            <p className="text-xs text-muted-foreground">
              {earnings?.claimed || 0} claimed, {earnings?.pending || 0} pending
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Achievements</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{achievements || 0}</div>
            <p className="text-xs text-muted-foreground">Badges earned</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activities</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activityStats?.totalActivities || 0}</div>
            <p className="text-xs text-muted-foreground">
              {activityStats?.verifiedActivities || 0} verified
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Competitions</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{competitions?.active || 0}</div>
            <p className="text-xs text-muted-foreground">
              Active ({competitions?.total || 0} total)
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Your canvassing activity this week</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">This Week</p>
              <p className="text-sm text-muted-foreground">
                {activityStats?.thisWeek || 0} activities logged
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">GPS Verification</p>
              <p className="text-sm text-muted-foreground">
                {activityStats?.verifiedActivities || 0} / {activityStats?.totalActivities || 0}{" "}
                verified
              </p>
            </div>
          </div>
          {activityStats?.lastActivity && (
            <div className="flex items-center gap-4">
              <Zap className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Last Activity</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(activityStats.lastActivity).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
