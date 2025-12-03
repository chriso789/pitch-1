/**
 * Onboarding Analytics Dashboard
 * Shows completion rates, drop-off points, and time spent analysis
 */

import { useState, useEffect } from 'react';
import { 
  Users, TrendingUp, Clock, AlertTriangle, 
  RefreshCw, Play, CheckCircle2, XCircle
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList
} from 'recharts';
import { getOnboardingStats, fetchOnboardingAnalytics } from '@/hooks/useOnboardingAnalytics';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

const STEP_LABELS: Record<string, string> = {
  password: 'Set Password',
  profile: 'Your Profile',
  branding: 'Company Branding',
  smartdocs: 'Smart Docs',
  tour: 'Feature Tour',
  complete: 'Completed',
};

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(142 76% 36%)'];

export function OnboardingAnalyticsDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, activityData] = await Promise.all([
        getOnboardingStats(),
        fetchOnboardingAnalytics(),
      ]);
      setStats(statsData);
      setRecentActivity(activityData.slice(0, 20));
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Prepare funnel data
  const funnelData = stats?.steps?.map((step: any) => ({
    name: STEP_LABELS[step.stepId] || step.stepId,
    value: step.totalEntries,
    completions: step.completions,
    fill: COLORS[step.stepNumber % COLORS.length],
  })) || [];

  // Prepare time spent data
  const timeData = stats?.steps?.map((step: any) => ({
    name: STEP_LABELS[step.stepId] || step.stepId,
    avgTime: Math.round(step.avgTimeSpent),
  })) || [];

  // Prepare drop-off data
  const dropoffData = stats?.steps?.map((step: any) => ({
    name: STEP_LABELS[step.stepId] || step.stepId,
    dropoffRate: Math.round(step.dropoffRate),
  })) || [];

  // Find highest drop-off step
  const highestDropoff = stats?.steps?.reduce((max: any, step: any) => 
    step.dropoffRate > (max?.dropoffRate || 0) ? step : max
  , null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Onboarding Analytics</h3>
          <p className="text-sm text-muted-foreground">
            Track user progress and optimize the onboarding experience
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalUsers || 0}</p>
                <p className="text-sm text-muted-foreground">Total Started</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.completedUsers || 0}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {Math.round(stats?.overallCompletionRate || 0)}%
                </p>
                <p className="text-sm text-muted-foreground">Completion Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {highestDropoff ? STEP_LABELS[highestDropoff.stepId] : 'N/A'}
                </p>
                <p className="text-sm text-muted-foreground">Highest Drop-off</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="funnel">
        <TabsList>
          <TabsTrigger value="funnel">Conversion Funnel</TabsTrigger>
          <TabsTrigger value="time">Time Analysis</TabsTrigger>
          <TabsTrigger value="dropoff">Drop-off Points</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Onboarding Funnel</CardTitle>
              <CardDescription>
                User progression through each onboarding step
              </CardDescription>
            </CardHeader>
            <CardContent>
              {funnelData.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnelData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" name="Users Reached" />
                      <Bar dataKey="completions" fill="hsl(142 76% 36%)" name="Completed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No analytics data yet
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="time" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Average Time Per Step</CardTitle>
              <CardDescription>
                How long users spend on each onboarding step (seconds)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timeData.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="avgTime" fill="hsl(var(--chart-2))" name="Avg Time (sec)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No time data available
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dropoff" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Drop-off Analysis</CardTitle>
              <CardDescription>
                Percentage of users who abandoned at each step
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dropoffData.length > 0 ? (
                <div className="space-y-4">
                  {dropoffData.map((step: any, index: number) => (
                    <div key={step.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{step.name}</span>
                        <span className={step.dropoffRate > 20 ? 'text-destructive font-medium' : ''}>
                          {step.dropoffRate}% drop-off
                        </span>
                      </div>
                      <Progress 
                        value={step.dropoffRate} 
                        className={`h-2 ${step.dropoffRate > 20 ? '[&>div]:bg-destructive' : ''}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No drop-off data available
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Onboarding Activity</CardTitle>
              <CardDescription>
                Latest user interactions with the onboarding flow
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length > 0 ? (
                <div className="space-y-3">
                  {recentActivity.map((activity: any) => (
                    <div 
                      key={activity.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        {activity.completed ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : activity.dropped_off ? (
                          <XCircle className="h-5 w-5 text-destructive" />
                        ) : (
                          <Play className="h-5 w-5 text-primary" />
                        )}
                        <div>
                          <p className="font-medium">
                            {STEP_LABELS[activity.step_id] || activity.step_id}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {activity.time_spent ? `${activity.time_spent}s` : 'In progress'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={activity.completed ? 'default' : activity.dropped_off ? 'destructive' : 'secondary'}>
                          {activity.completed ? 'Completed' : activity.dropped_off ? 'Dropped' : 'Active'}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No recent activity
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Video Watch Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Video Tutorial Engagement
          </CardTitle>
          <CardDescription>
            How many users watch the tutorial videos at each step
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats?.steps?.map((step: any) => (
              <div key={step.stepId} className="text-center p-4 rounded-lg border bg-muted/30">
                <p className="text-2xl font-bold text-primary">
                  {Math.round(step.videoWatchRate)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {STEP_LABELS[step.stepId] || step.stepId}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
