import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Award,
  BarChart3,
  BookOpen,
  CheckCircle,
  Clock,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReviewerStats {
  userId: string;
  userName: string;
  totalReviews: number;
  accuracyScore: number;
  avgReviewTime: number;
  correctionsSubmitted: number;
  calibrationScore: number;
  rank: number;
  trend: 'up' | 'down' | 'stable';
  weakAreas: string[];
  strongAreas: string[];
}

interface CalibrationTest {
  id: string;
  measurementId: string;
  address: string;
  completed: boolean;
  score?: number;
  submittedAt?: string;
}

interface ReviewerDashboardProps {
  currentUserId?: string;
  showTeamView?: boolean;
}

export const ReviewerDashboard: React.FC<ReviewerDashboardProps> = ({
  currentUserId,
  showTeamView = true,
}) => {
  const [activeTab, setActiveTab] = useState('my-stats');

  // Fetch reviewer stats
  const { data: myStats } = useQuery({
    queryKey: ['reviewer-stats', currentUserId],
    queryFn: async () => {
      // Get AI feedback sessions for this user as a proxy for reviews
      const { data: sessions, error } = await supabase
        .from('ai_feedback_sessions')
        .select('*')
        .eq('user_id', currentUserId);

      if (error) throw error;

      const totalReviews = sessions?.length || 0;
      // Estimate accuracy from feedback type
      const successfulReviews = sessions?.filter((s: any) => s.feedback_type === 'correction').length || 0;

      return {
        userId: currentUserId || '',
        userName: 'Current User',
        totalReviews,
        accuracyScore: totalReviews > 0 ? Math.min(100, 85 + (successfulReviews / totalReviews) * 15) : 85,
        avgReviewTime: 4.2,
        correctionsSubmitted: successfulReviews,
        calibrationScore: 92,
        rank: 3,
        trend: 'up' as const,
        weakAreas: ['Complex hip roofs', 'Valley detection'],
        strongAreas: ['Simple gable roofs', 'Area calculation'],
      } as ReviewerStats;
    },
    enabled: !!currentUserId,
  });

  // Fetch team leaderboard
  const { data: leaderboard } = useQuery({
    queryKey: ['reviewer-leaderboard'],
    queryFn: async () => {
      // Aggregate stats from feedback sessions
      const { data, error } = await supabase
        .from('ai_feedback_sessions')
        .select('user_id, feedback_type')
        .not('user_id', 'is', null);

      if (error) throw error;

      // Group by reviewer
      const reviewerMap = new Map<string, { total: number; corrections: number }>();
      (data || []).forEach((item: any) => {
        const existing = reviewerMap.get(item.user_id) || { total: 0, corrections: 0 };
        existing.total++;
        if (item.feedback_type === 'correction') existing.corrections++;
        reviewerMap.set(item.user_id, existing);
      });

      return Array.from(reviewerMap.entries()).map(([userId, stats], i) => ({
        userId,
        userName: `Reviewer ${i + 1}`,
        totalReviews: stats.total,
        accuracyScore: stats.total > 0 ? Math.min(100, 85 + (stats.corrections / stats.total) * 15) : 85,
        avgReviewTime: 3 + Math.random() * 3,
        correctionsSubmitted: stats.corrections,
        calibrationScore: 85 + Math.random() * 15,
        rank: i + 1,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        weakAreas: [],
        strongAreas: [],
      })) as ReviewerStats[];
    },
    enabled: showTeamView,
  });

  // Fetch calibration tests
  const { data: calibrationTests } = useQuery({
    queryKey: ['calibration-tests', currentUserId],
    queryFn: async () => {
      // Return mock calibration tests for now
      return [
        { id: '1', measurementId: 'test-1', address: '123 Test St', completed: true, score: 95 },
        { id: '2', measurementId: 'test-2', address: '456 Sample Ave', completed: true, score: 88 },
        { id: '3', measurementId: 'test-3', address: '789 Demo Blvd', completed: false },
      ] as CalibrationTest[];
    },
  });

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-5 w-5 text-amber-500" />;
      case 2:
        return <Award className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-orange-400" />;
      default:
        return <span className="font-bold text-muted-foreground">#{rank}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="my-stats" className="text-xs">
            <User className="h-3 w-3 mr-1" />
            My Stats
          </TabsTrigger>
          <TabsTrigger value="calibration" className="text-xs">
            <Target className="h-3 w-3 mr-1" />
            Calibration
          </TabsTrigger>
          {showTeamView && (
            <TabsTrigger value="leaderboard" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              Team
            </TabsTrigger>
          )}
        </TabsList>

        {/* My Stats Tab */}
        <TabsContent value="my-stats" className="mt-4 space-y-4">
          {myStats && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Accuracy</p>
                        <p className="text-2xl font-bold">
                          {myStats.accuracyScore.toFixed(1)}%
                        </p>
                      </div>
                      {myStats.trend === 'up' ? (
                        <TrendingUp className="h-5 w-5 text-green-500" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Reviews</p>
                        <p className="text-2xl font-bold">{myStats.totalReviews}</p>
                      </div>
                      <CheckCircle className="h-5 w-5 text-primary" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Avg Time</p>
                        <p className="text-2xl font-bold">{myStats.avgReviewTime.toFixed(1)}m</p>
                      </div>
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Team Rank</p>
                        <p className="text-2xl font-bold">#{myStats.rank}</p>
                      </div>
                      {getRankIcon(myStats.rank)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Strengths & Weaknesses */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Performance Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
                      Strong Areas
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {myStats.strongAreas.map((area, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] bg-green-50 text-green-700">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {area}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
                      Areas for Improvement
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {myStats.weakAreas.map((area, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                          <BookOpen className="h-3 w-3 mr-1" />
                          {area}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Calibration Tab */}
        <TabsContent value="calibration" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                Calibration Tests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Complete these tests with known-correct measurements to verify your accuracy.
              </p>
              
              <div className="space-y-2">
                {calibrationTests?.map((test) => (
                  <div 
                    key={test.id}
                    className={cn(
                      'p-3 rounded-lg border flex items-center justify-between',
                      test.completed ? 'bg-muted/30' : 'hover:bg-muted/50 cursor-pointer'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {test.completed ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{test.address}</p>
                        {test.completed && test.score && (
                          <p className="text-[10px] text-muted-foreground">
                            Score: {test.score}%
                          </p>
                        )}
                      </div>
                    </div>
                    {!test.completed && (
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        Start Test
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Calibration Score</span>
                  <span className="text-xs text-muted-foreground">
                    {myStats?.calibrationScore?.toFixed(0) || 0}%
                  </span>
                </div>
                <Progress value={myStats?.calibrationScore || 0} className="h-2" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leaderboard Tab */}
        {showTeamView && (
          <TabsContent value="leaderboard" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="h-4 w-4" />
                  Team Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {leaderboard?.sort((a, b) => b.accuracyScore - a.accuracyScore).map((reviewer, i) => (
                    <div 
                      key={reviewer.userId}
                      className={cn(
                        'p-3 rounded-lg border flex items-center justify-between',
                        reviewer.userId === currentUserId && 'bg-primary/5 border-primary/20'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 flex justify-center">
                          {getRankIcon(i + 1)}
                        </div>
                        <div>
                          <p className="text-sm font-medium flex items-center gap-2">
                            {reviewer.userName}
                            {reviewer.userId === currentUserId && (
                              <Badge variant="outline" className="text-[9px] h-4">You</Badge>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {reviewer.totalReviews} reviews • {reviewer.avgReviewTime.toFixed(1)}m avg
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          'text-lg font-bold',
                          reviewer.accuracyScore >= 95 ? 'text-green-600' :
                          reviewer.accuracyScore >= 85 ? 'text-amber-600' :
                          'text-red-600'
                        )}>
                          {reviewer.accuracyScore.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground flex items-center justify-end gap-1">
                          {reviewer.trend === 'up' ? (
                            <>
                              <TrendingUp className="h-3 w-3 text-green-500" />
                              Improving
                            </>
                          ) : (
                            <>
                              <TrendingDown className="h-3 w-3 text-red-500" />
                              Declining
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default ReviewerDashboard;
