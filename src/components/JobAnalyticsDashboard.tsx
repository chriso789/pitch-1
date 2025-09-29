import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  DollarSign,
  Users,
  Calendar,
  BarChart3
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface JobMetrics {
  total_jobs: number;
  pending_jobs: number;
  in_progress_jobs: number;
  completed_jobs: number;
  on_hold_jobs: number;
  cancelled_jobs: number;
  avg_completion_days: number;
  completion_rate: number;
  jobs_by_priority: {
    high: number;
    medium: number;
    low: number;
  };
}

export const JobAnalyticsDashboard = () => {
  const [metrics, setMetrics] = useState<JobMetrics>({
    total_jobs: 0,
    pending_jobs: 0,
    in_progress_jobs: 0,
    completed_jobs: 0,
    on_hold_jobs: 0,
    cancelled_jobs: 0,
    avg_completion_days: 0,
    completion_rate: 0,
    jobs_by_priority: { high: 0, medium: 0, low: 0 }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*');

      if (error) throw error;

      if (!jobs) {
        setLoading(false);
        return;
      }

      // Calculate metrics
      const total = jobs.length;
      const pending = jobs.filter(j => j.status === 'pending').length;
      const inProgress = jobs.filter(j => j.status === 'in_progress').length;
      const completed = jobs.filter(j => j.status === 'completed').length;
      const onHold = jobs.filter(j => j.status === 'on_hold').length;
      const cancelled = jobs.filter(j => j.status === 'cancelled').length;

      // Calculate average completion time
      const completedJobs = jobs.filter(j => j.status === 'completed' && j.updated_at);
      const avgDays = completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            const start = new Date(job.created_at);
            const end = new Date(job.updated_at);
            const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            return sum + days;
          }, 0) / completedJobs.length
        : 0;

      // Calculate completion rate
      const rate = total > 0 ? (completed / total) * 100 : 0;

      // Count by priority
      const high = jobs.filter(j => j.priority === 'high').length;
      const medium = jobs.filter(j => j.priority === 'medium').length;
      const low = jobs.filter(j => j.priority === 'low').length;

      setMetrics({
        total_jobs: total,
        pending_jobs: pending,
        in_progress_jobs: inProgress,
        completed_jobs: completed,
        on_hold_jobs: onHold,
        cancelled_jobs: cancelled,
        avg_completion_days: Math.round(avgDays),
        completion_rate: Math.round(rate),
        jobs_by_priority: { high, medium, low }
      });
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const MetricCard = ({ title, value, subtitle, icon: Icon, color }: any) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <h3 className="text-2xl font-bold mt-2">{value}</h3>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`rounded-full p-3 ${color}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Job Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Loading analytics...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Job Analytics</h2>
        <Badge variant="outline" className="text-sm">
          <Calendar className="h-3 w-3 mr-1" />
          Last 30 days
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Jobs"
          value={metrics.total_jobs}
          icon={BarChart3}
          color="bg-blue-100 text-blue-600"
        />
        
        <MetricCard
          title="Pending"
          value={metrics.pending_jobs}
          subtitle={`${Math.round((metrics.pending_jobs / metrics.total_jobs) * 100)}% of total`}
          icon={Clock}
          color="bg-yellow-100 text-yellow-600"
        />
        
        <MetricCard
          title="In Progress"
          value={metrics.in_progress_jobs}
          subtitle={`${Math.round((metrics.in_progress_jobs / metrics.total_jobs) * 100)}% of total`}
          icon={TrendingUp}
          color="bg-blue-100 text-blue-600"
        />
        
        <MetricCard
          title="Completed"
          value={metrics.completed_jobs}
          subtitle={`${metrics.completion_rate}% completion rate`}
          icon={CheckCircle}
          color="bg-green-100 text-green-600"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Completion Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="rounded-full p-3 bg-purple-100 text-purple-600">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-3xl font-bold">{metrics.avg_completion_days}</h3>
                <p className="text-sm text-muted-foreground">days on average</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Priority Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="w-16">High</Badge>
                  <span className="text-sm text-muted-foreground">
                    {metrics.jobs_by_priority.high} jobs
                  </span>
                </div>
                <span className="font-semibold">
                  {Math.round((metrics.jobs_by_priority.high / metrics.total_jobs) * 100)}%
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="w-16">Medium</Badge>
                  <span className="text-sm text-muted-foreground">
                    {metrics.jobs_by_priority.medium} jobs
                  </span>
                </div>
                <span className="font-semibold">
                  {Math.round((metrics.jobs_by_priority.medium / metrics.total_jobs) * 100)}%
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="w-16">Low</Badge>
                  <span className="text-sm text-muted-foreground">
                    {metrics.jobs_by_priority.low} jobs
                  </span>
                </div>
                <span className="font-semibold">
                  {Math.round((metrics.jobs_by_priority.low / metrics.total_jobs) * 100)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          title="On Hold"
          value={metrics.on_hold_jobs}
          subtitle="Requires attention"
          icon={AlertCircle}
          color="bg-orange-100 text-orange-600"
        />
        
        <MetricCard
          title="Cancelled"
          value={metrics.cancelled_jobs}
          subtitle={`${Math.round((metrics.cancelled_jobs / metrics.total_jobs) * 100)}% of total`}
          icon={AlertCircle}
          color="bg-red-100 text-red-600"
        />
      </div>
    </div>
  );
};
