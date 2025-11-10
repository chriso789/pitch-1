import React, { useState, useEffect } from 'react';
import { GlobalLayout } from '@/shared/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStormCanvass } from '@/hooks/useStormCanvass';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CompetitionSelector } from '@/components/storm-canvass/CompetitionSelector';
import { CompetitionLeaderboard } from '@/components/storm-canvass/CompetitionLeaderboard';
import { PrizePoolDisplay } from '@/components/storm-canvass/PrizePoolDisplay';
import { AchievementShowcase } from '@/components/storm-canvass/AchievementShowcase';
import { RewardHistory } from '@/components/storm-canvass/RewardHistory';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function LeaderboardPage() {
  const [selectedTab, setSelectedTab] = useState<'competitions' | 'achievements' | 'rewards'>('competitions');
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stormCanvass = useStormCanvass();

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Fetch active competitions
  const fetchCompetitions = async (): Promise<any[]> => {
    const result: any = await (supabase as any)
      .from('canvass_competitions')
      .select('*')
      .eq('is_active', true)
      .order('start_date', { ascending: false });
    
    if (result.error) throw result.error;
    return result.data || [];
  };

  const { data: competitions = [], isLoading: competitionsLoading } = useQuery<any[]>({
    queryKey: ['active-competitions'],
    queryFn: fetchCompetitions,
  });

  // Auto-select first competition
  useEffect(() => {
    if (competitions.length > 0 && !selectedCompetitionId) {
      setSelectedCompetitionId(competitions[0].id);
    }
  }, [competitions, selectedCompetitionId]);

  // Fetch leaderboard
  const { data: leaderboard = [], isLoading: leaderboardLoading } = useQuery({
    queryKey: ['leaderboard', selectedCompetitionId],
    queryFn: async () => {
      if (!selectedCompetitionId) return [];
      const data = await stormCanvass.getCompetitionLeaderboard(selectedCompetitionId, 50);
      return data.map((entry: any) => ({
        rank: entry.rank,
        user_id: entry.user_id,
        score: entry.score,
        doors_knocked: entry.metrics?.doors_knocked || 0,
        leads_generated: entry.metrics?.leads_generated || 0,
        photos_uploaded: entry.metrics?.photos_uploaded || 0,
        rank_change: entry.metrics?.rank_change || 0,
        user: entry.user
      }));
    },
    enabled: !!selectedCompetitionId,
    refetchInterval: autoRefresh ? 30000 : false,
    refetchOnWindowFocus: true,
  });

  // Fetch user competitions
  const { data: userCompetitions = [] } = useQuery({
    queryKey: ['user-competitions', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return [];
      return await stormCanvass.getUserCompetitions(currentUserId);
    },
    enabled: !!currentUserId,
  });

  // Fetch achievements
  const { data: achievementsData } = useQuery({
    queryKey: ['user-achievements', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return { unlocked: [], all: [], totalPoints: 0 };
      const data = await stormCanvass.getUserAchievements(currentUserId);
      return {
        unlocked: data.unlocked.map((ua: any) => ({
          ...ua,
          claimed_at: ua.reward_claimed_at
        })),
        all: data.all.map((a: any) => ({
          ...a,
          icon: a.icon_url || '🏆',
          requirement_value: a.criteria?.requirement_value || 0
        })),
        totalPoints: data.totalPoints
      };
    },
    enabled: !!currentUserId,
  });

  // Fetch rewards
  const { data: rewardsData } = useQuery({
    queryKey: ['user-rewards', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return { all: [], pending: [], processing: [], sent: [], claimed: [], totalValue: 0 };
      return await stormCanvass.getRewardHistory(currentUserId);
    },
    enabled: !!currentUserId,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    queryClient.invalidateQueries({ queryKey: ['user-competitions'] });
    toast({
      title: 'Refreshed',
      description: 'Leaderboard data updated',
    });
  };

  const handleClaimReward = async (rewardId: string) => {
    toast({
      title: 'Claiming reward...',
      description: 'Processing your reward claim',
    });
    // TODO: Implement claim logic
  };

  const handleExportRewards = () => {
    toast({
      title: 'Exporting...',
      description: 'Downloading reward history',
    });
    // TODO: Implement export logic
  };

  const selectedCompetition = competitions.find(c => c.id === selectedCompetitionId);
  const userRank = leaderboard.find(entry => entry.user_id === currentUserId)?.rank;
  const enrolledCompetitionIds = userCompetitions.map(uc => uc.competition_id);

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Storm Canvass Leaderboard</h1>
          <p className="text-muted-foreground">Compete, achieve, and earn rewards</p>
        </div>

        <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="competitions">Active Competitions</TabsTrigger>
          <TabsTrigger value="achievements">My Achievements</TabsTrigger>
          <TabsTrigger value="rewards">Rewards</TabsTrigger>
        </TabsList>

        {/* TAB 1: COMPETITIONS */}
        <TabsContent value="competitions" className="space-y-6">
          {competitionsLoading ? (
            <Card>
              <CardContent className="p-12 text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Loading competitions...</p>
              </CardContent>
            </Card>
          ) : competitions.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active competitions at the moment. Check back soon!
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <CompetitionSelector
                        competitions={competitions}
                        selectedId={selectedCompetitionId}
                        onSelect={setSelectedCompetitionId}
                        userEnrolledIds={enrolledCompetitionIds}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleRefresh}
                      disabled={leaderboardLoading}
                    >
                      <RefreshCw className={leaderboardLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                    </Button>
                  </div>

                  <CompetitionLeaderboard
                    entries={leaderboard}
                    currentUserId={currentUserId}
                    autoRefresh={autoRefresh}
                    onRefresh={handleRefresh}
                  />
                </div>

                <div>
                  {selectedCompetition && (
                    <PrizePoolDisplay
                      prizePool={selectedCompetition.prize_pool as Record<string, number>}
                      endDate={selectedCompetition.end_date}
                      userRank={userRank}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* TAB 2: ACHIEVEMENTS */}
        <TabsContent value="achievements" className="space-y-6">
          {achievementsData && (
            <AchievementShowcase
              unlocked={achievementsData.unlocked}
              all={achievementsData.all}
              totalPoints={achievementsData.totalPoints}
              onClaim={handleClaimReward}
            />
          )}
        </TabsContent>

        {/* TAB 3: REWARDS */}
        <TabsContent value="rewards" className="space-y-6">
          {rewardsData && (
            <RewardHistory
              rewards={rewardsData}
              onClaim={handleClaimReward}
              onExport={handleExportRewards}
            />
          )}
        </TabsContent>
      </Tabs>
      </div>
    </GlobalLayout>
  );
}
