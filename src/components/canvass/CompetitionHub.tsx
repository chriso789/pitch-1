import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Calendar, Users, DollarSign, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import ClaimPrizeButton from "@/components/stripe/ClaimPrizeButton";

export function CompetitionHub() {
  const queryClient = useQueryClient();
  const [selectedCompetition, setSelectedCompetition] = useState<string | null>(null);

  const { data: competitions, isLoading: competitionsLoading } = useQuery({
    queryKey: ["competitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvass_competitions")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userParticipation } = useQuery({
    queryKey: ["user-competitions"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("competition_participants")
        .select("*, competition:canvass_competitions(*)")
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["leaderboard", selectedCompetition],
    queryFn: async () => {
      if (!selectedCompetition) return null;

      const { data, error } = await supabase
        .from("competition_leaderboards")
        .select("*")
        .eq("competition_id", selectedCompetition)
        .eq("is_final", false)
        .order("rank", { ascending: true })
        .limit(10);
      if (error) throw error;
      
      // Get user profiles separately
      const userIds = data.map((d: any) => d.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", userIds);
      
      return data.map((entry: any) => ({
        ...entry,
        user: profiles?.find((p: any) => p.id === entry.user_id)
      }));
    },
    enabled: !!selectedCompetition,
  });

  const enrollMutation = useMutation({
    mutationFn: async (competitionId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("competition_participants").insert({
        competition_id: competitionId,
        user_id: user.id,
        tenant_id: user.user_metadata.tenant_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-competitions"] });
      toast.success("Successfully enrolled in competition!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to enroll in competition");
    },
  });

  const isEnrolled = (competitionId: string) => {
    return userParticipation?.some((p) => p.competition_id === competitionId);
  };

  const getStatusBadge = (competition: any) => {
    const now = new Date();
    const start = new Date(competition.start_date);
    const end = new Date(competition.end_date);

    if (competition.status === "completed") return <Badge variant="secondary">Completed</Badge>;
    if (now < start) return <Badge variant="outline">Upcoming</Badge>;
    if (now >= start && now <= end) return <Badge variant="default">Active</Badge>;
    return <Badge variant="destructive">Ended</Badge>;
  };

  const formatPrizePool = (prizePool: any) => {
    if (!prizePool || typeof prizePool !== "object") return "TBD";
    const prizes = Object.values(prizePool).filter((v) => typeof v === "number");
    const total = prizes.reduce((sum: number, val: any) => sum + val, 0);
    return `$${total.toLocaleString()}`;
  };

  if (competitionsLoading) {
    return <div className="text-center py-8">Loading competitions...</div>;
  }

  const activeCompetitions = competitions?.filter(
    (c) => c.status === "active"
  );
  const upcomingCompetitions = competitions?.filter((c) => c.status === "draft");
  const completedCompetitions = competitions?.filter((c) => c.status === "completed");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Competition Hub</h2>
        <p className="text-muted-foreground">Compete with your team and win prizes</p>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active">Active ({activeCompetitions?.length || 0})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcomingCompetitions?.length || 0})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedCompetitions?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-6">
          {activeCompetitions?.map((competition) => {
            const enrolled = isEnrolled(competition.id);
            const participation = userParticipation?.find((p) => p.competition_id === competition.id);

            return (
              <Card key={competition.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-2xl">{competition.name}</CardTitle>
                      <CardDescription>{competition.description}</CardDescription>
                    </div>
                    {getStatusBadge(competition)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <p className="font-medium">Duration</p>
                        <p className="text-muted-foreground">
                          {new Date(competition.start_date).toLocaleDateString()} -{" "}
                          {new Date(competition.end_date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <p className="font-medium">Prize Pool</p>
                        <p className="text-muted-foreground">{formatPrizePool(competition.prize_pool)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <p className="font-medium">Type</p>
                        <p className="text-muted-foreground capitalize">{competition.competition_type}</p>
                      </div>
                    </div>
                    {enrolled && participation && (
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <div className="text-sm">
                          <p className="font-medium">Your Rank</p>
                          <p className="text-muted-foreground">#{participation.current_rank || "N/A"}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!enrolled && (
                      <Button
                        onClick={() => enrollMutation.mutate(competition.id)}
                        disabled={enrollMutation.isPending}
                      >
                        Enroll Now
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => setSelectedCompetition(competition.id)}
                    >
                      <Trophy className="h-4 w-4 mr-2" />
                      View Leaderboard
                    </Button>
                  </div>

                  {selectedCompetition === competition.id && leaderboard && (
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-4">Live Leaderboard</h4>
                      <div className="space-y-2">
                        {leaderboard.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex justify-between items-center p-2 rounded bg-muted/50"
                          >
                            <div className="flex items-center gap-3">
                              <Badge variant={entry.rank <= 3 ? "default" : "outline"}>
                                #{entry.rank}
                              </Badge>
                              <span>
                                {entry.user?.first_name} {entry.user?.last_name}
                              </span>
                            </div>
                            <span className="font-semibold">{entry.score.toLocaleString()} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-4">
          {upcomingCompetitions?.map((competition) => (
            <Card key={competition.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>{competition.name}</CardTitle>
                  {getStatusBadge(competition)}
                </div>
                <CardDescription>{competition.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Starts: {new Date(competition.start_date).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          {completedCompetitions?.map((competition) => (
            <Card key={competition.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>{competition.name}</CardTitle>
                  {getStatusBadge(competition)}
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => setSelectedCompetition(competition.id)}
                >
                  View Final Results
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
