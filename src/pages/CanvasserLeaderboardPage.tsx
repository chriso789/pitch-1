import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Trophy, Flame, Target, Award, Crown, Star, Zap, Medal } from 'lucide-react';
import { LeaderboardPodium } from '@/components/storm-canvass/LeaderboardPodium';
import { CanvasserLevelBadge } from '@/components/storm-canvass/CanvasserLevelBadge';
import { StreakIndicator } from '@/components/storm-canvass/StreakIndicator';
import { WeeklyChallengeCard } from '@/components/storm-canvass/WeeklyChallengeCard';
import { CompetitionLeaderboard } from '@/components/storm-canvass/CompetitionLeaderboard';
import { AchievementBadgesGrid } from '@/components/storm-canvass/AchievementBadgesGrid';

export default function CanvasserLeaderboardPage() {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const tenantId = profile?.tenant_id;
  const [timeframe, setTimeframe] = useState<'today' | 'week' | 'month' | 'all'>('week');

  // Fetch leaderboard data
  const { data: leaderboardData, isLoading } = useQuery({
    queryKey: ['canvasser-leaderboard', tenantId, timeframe],
    queryFn: async () => {
      if (!tenantId) return [];

      // Get date range based on timeframe
      const now = new Date();
      let startDate: string;
      
      switch (timeframe) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
          break;
        case 'week':
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          startDate = weekAgo.toISOString();
          break;
        case 'month':
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          startDate = monthAgo.toISOString();
          break;
        default:
          startDate = new Date(0).toISOString();
      }

      // Get activity stats grouped by user
      const { data: activities } = await supabase
        .from('canvass_activity_log')
        .select('user_id, activity_type, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate) as any;

      // Get user profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url')
        .eq('tenant_id', tenantId);

      // Calculate scores per user
      const userScores: Record<string, {
        doors_knocked: number;
        leads_generated: number;
        photos_uploaded: number;
        deals_closed: number;
        score: number;
      }> = {};

      (activities || []).forEach((activity: any) => {
        if (!userScores[activity.user_id]) {
          userScores[activity.user_id] = {
            doors_knocked: 0,
            leads_generated: 0,
            photos_uploaded: 0,
            deals_closed: 0,
            score: 0,
          };
        }

        const stats = userScores[activity.user_id];
        switch (activity.activity_type) {
          case 'door_knock':
            stats.doors_knocked++;
            stats.score += 10; // 10 XP per door
            break;
          case 'lead_generated':
            stats.leads_generated++;
            stats.score += 50; // 50 XP per lead
            break;
          case 'photo_uploaded':
            stats.photos_uploaded++;
            stats.score += 5; // 5 XP per photo
            break;
          case 'deal_closed':
            stats.deals_closed++;
            stats.score += 500; // 500 XP per deal
            break;
        }
      });

      // Build leaderboard entries
      const entries = Object.entries(userScores)
        .map(([userId, stats]) => {
          const profile = (profiles || []).find((p: any) => p.id === userId);
          return {
            user_id: userId,
            ...stats,
            rank: 0,
            rank_change: 0,
            user: profile ? {
              id: profile.id,
              first_name: profile.first_name || 'Unknown',
              last_name: profile.last_name || 'User',
              avatar_url: profile.avatar_url,
            } : undefined,
          };
        })
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({
          ...entry,
          rank: index + 1,
        }));

      return entries;
    },
    enabled: !!tenantId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch current user's stats
  const { data: myStats } = useQuery({
    queryKey: ['my-canvasser-stats', tenantId, user?.id],
    queryFn: async () => {
      if (!tenantId || !user?.id) return null;

      // Get total activity counts
      const { data: activities } = await supabase
        .from('canvass_activity_log')
        .select('activity_type')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id) as any;

      let totalXp = 0;
      let doorsKnocked = 0;
      let leadsGenerated = 0;
      let photosUploaded = 0;
      let dealsClose = 0;

      (activities || []).forEach((a: any) => {
        switch (a.activity_type) {
          case 'door_knock':
            doorsKnocked++;
            totalXp += 10;
            break;
          case 'lead_generated':
            leadsGenerated++;
            totalXp += 50;
            break;
          case 'photo_uploaded':
            photosUploaded++;
            totalXp += 5;
            break;
          case 'deal_closed':
            dealsClose++;
            totalXp += 500;
            break;
        }
      });

      // Calculate level from XP
      const level = Math.floor(totalXp / 500) + 1;
      const xpForNextLevel = level * 500;
      const xpProgress = ((totalXp % 500) / 500) * 100;

      // Get streak (consecutive days with activity)
      const { data: recentDays } = await supabase
        .from('canvass_activity_log')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }) as any;

      const activeDays = new Set(
        (recentDays || []).map((d: any) => 
          new Date(d.created_at).toDateString()
        )
      );

      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() - i);
        if (activeDays.has(checkDate.toDateString())) {
          streak++;
        } else if (i > 0) {
          break;
        }
      }

      return {
        totalXp,
        level,
        xpForNextLevel,
        xpProgress,
        streak,
        doorsKnocked,
        leadsGenerated,
        photosUploaded,
        dealsClose,
      };
    },
    enabled: !!tenantId && !!user?.id,
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Trophy className="h-8 w-8 text-yellow-500" />
            Canvasser Leaderboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Compete with your team and earn rewards
          </p>
        </div>
        <Badge variant="secondary" className="animate-pulse text-sm">
          <Flame className="h-4 w-4 mr-1 text-orange-500" />
          Live
        </Badge>
      </div>

      {/* My Stats Banner */}
      {myStats && (
        <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <CanvasserLevelBadge level={myStats.level} xpProgress={myStats.xpProgress} />
                <div>
                  <p className="text-sm text-muted-foreground">Your Level</p>
                  <p className="text-2xl font-bold">Level {myStats.level}</p>
                  <p className="text-xs text-muted-foreground">
                    {myStats.totalXp.toLocaleString()} / {myStats.xpForNextLevel.toLocaleString()} XP
                  </p>
                </div>
              </div>
              
              <StreakIndicator streak={myStats.streak} />

              <div className="grid grid-cols-4 gap-6 text-center">
                <div>
                  <p className="text-2xl font-bold">{myStats.doorsKnocked}</p>
                  <p className="text-xs text-muted-foreground">Doors</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{myStats.leadsGenerated}</p>
                  <p className="text-xs text-muted-foreground">Leads</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{myStats.photosUploaded}</p>
                  <p className="text-xs text-muted-foreground">Photos</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{myStats.dealsClose}</p>
                  <p className="text-xs text-muted-foreground">Deals</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Leaderboard */}
        <div className="lg:col-span-2 space-y-6">
          {/* Podium for Top 3 */}
          {leaderboardData && leaderboardData.length >= 3 && (
            <LeaderboardPodium topThree={leaderboardData.slice(0, 3)} />
          )}

          {/* Full Leaderboard */}
          <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as any)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">This Week</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>

            <TabsContent value={timeframe} className="mt-4">
              <CompetitionLeaderboard
                entries={leaderboardData || []}
                currentUserId={user?.id || ''}
                autoRefresh={true}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Weekly Challenge */}
          <WeeklyChallengeCard />

          {/* Achievements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                Recent Achievements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AchievementBadgesGrid />
            </CardContent>
          </Card>

          {/* Scoring Guide */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                Scoring Guide
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span>Door Knocked</span>
                <Badge variant="secondary">+10 XP</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Lead Generated</span>
                <Badge variant="secondary">+50 XP</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Photo Uploaded</span>
                <Badge variant="secondary">+5 XP</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Deal Closed</span>
                <Badge className="bg-green-500">+500 XP</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
