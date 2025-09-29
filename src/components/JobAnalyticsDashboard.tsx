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
  lead_jobs: number;
  legal_jobs: number;
  contingency_jobs: number;
  ready_for_approval_jobs: number;
  production_jobs: number;
  final_payment_jobs: number;
  closed_jobs: number;
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
    lead_jobs: 0,
    legal_jobs: 0,
    contingency_jobs: 0,
    ready_for_approval_jobs: 0,
    production_jobs: 0,
    final_payment_jobs: 0,
    closed_jobs: 0,
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
      const leads = jobs.filter(j => j.status === 'lead').length;
      const legal = jobs.filter(j => j.status === 'legal').length;
      const contingency = jobs.filter(j => j.status === 'contingency').length;
      const readyForApproval = jobs.filter(j => j.status === 'ready_for_approval').length;
      const production = jobs.filter(j => j.status === 'production').length;
      const finalPayment = jobs.filter(j => j.status === 'final_payment').length;
      const closed = jobs.filter(j => j.status === 'closed').length;

      // Calculate average completion time
      const completedJobs = jobs.filter(j => j.status === 'closed' && j.updated_at);
      const avgDays = completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            const start = new Date(job.created_at);
            const end = new Date(job.updated_at);
            const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            return sum + days;
          }, 0) / completedJobs.length
        : 0;

      // Calculate completion rate
      const rate = total > 0 ? (closed / total) * 100 : 0;

      // Count by priority
      const high = jobs.filter(j => j.priority === 'high').length;
      const medium = jobs.filter(j => j.priority === 'medium').length;
      const low = jobs.filter(j => j.priority === 'low').length;

      setMetrics({
        total_jobs: total,
        lead_jobs: leads,
        legal_jobs: legal,
        contingency_jobs: contingency,
        ready_for_approval_jobs: readyForApproval,
        production_jobs: production,
        final_payment_jobs: finalPayment,
        closed_jobs: closed,
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
          title="Leads"
          value={metrics.lead_jobs}
          subtitle={`${Math.round((metrics.lead_jobs / metrics.total_jobs) * 100)}% of total`}
          icon={Users}
          color="bg-amber-100 text-amber-600"
        />
        
        <MetricCard
          title="Production"
          value={metrics.production_jobs}
          subtitle={`${Math.round((metrics.production_jobs / metrics.total_jobs) * 100)}% of total`}
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
        />
        
        <MetricCard
          title="Closed"
          value={metrics.closed_jobs}
          subtitle={`${metrics.completion_rate}% completion rate`}
          icon={CheckCircle}
          color="bg-gray-100 text-gray-600"
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Legal"
          value={metrics.legal_jobs}
          subtitle="In legal review"
          icon={AlertCircle}
          color="bg-blue-100 text-blue-600"
        />
        
        <MetricCard
          title="Contingency"
          value={metrics.contingency_jobs}
          subtitle="Contingency phase"
          icon={Clock}
          color="bg-purple-100 text-purple-600"
        />
        
        <MetricCard
          title="Ready For Approval"
          value={metrics.ready_for_approval_jobs}
          subtitle="Awaiting approval"
          icon={CheckCircle}
          color="bg-orange-100 text-orange-600"
        />
        
        <MetricCard
          title="Final Payment"
          value={metrics.final_payment_jobs}
          subtitle="Payment pending"
          icon={DollarSign}
          color="bg-teal-100 text-teal-600"
        />
      </div>
    </div>
  );
};
