import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  DollarSign,
  Users,
  Calendar,
  BarChart3,
  RefreshCw,
  Download,
  ChevronDown,
  Mail
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";
import { exportToCSV, exportDashboardToPDF, formatDateRangeForExport } from "@/lib/export-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date()
  });
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: '',
    subject: `Job Analytics Report - ${format(new Date(), 'PP')}`,
    message: 'Please find the attached job analytics report.'
  });

  useEffect(() => {
    fetchMetrics(dateRange);
  }, [dateRange]);

  const fetchMetrics = async (range?: DateRange, force?: boolean) => {
    if (force) setIsRefreshing(true);
    else setLoading(true);
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
      toast.error('Failed to fetch analytics data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    await fetchMetrics(dateRange, true);
    toast.success('Analytics refreshed');
  };

  const handleExportCSV = () => {
    const csvData = [
      // Summary section
      { section: 'Summary', metric: 'Total Jobs', value: metrics.total_jobs },
      { section: 'Summary', metric: 'Leads', value: metrics.lead_jobs },
      { section: 'Summary', metric: 'Legal', value: metrics.legal_jobs },
      { section: 'Summary', metric: 'Contingency', value: metrics.contingency_jobs },
      { section: 'Summary', metric: 'Ready for Approval', value: metrics.ready_for_approval_jobs },
      { section: 'Summary', metric: 'Production', value: metrics.production_jobs },
      { section: 'Summary', metric: 'Final Payment', value: metrics.final_payment_jobs },
      { section: 'Summary', metric: 'Closed', value: metrics.closed_jobs },
      {},
      // Performance metrics
      { section: 'Performance', metric: 'Avg Completion Days', value: metrics.avg_completion_days },
      { section: 'Performance', metric: 'Completion Rate', value: `${metrics.completion_rate}%` },
      {},
      // Priority distribution
      { section: 'Priority', level: 'High', count: metrics.jobs_by_priority.high },
      { section: 'Priority', level: 'Medium', count: metrics.jobs_by_priority.medium },
      { section: 'Priority', level: 'Low', count: metrics.jobs_by_priority.low },
    ];

    const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
    const metadata = [
      `Job Analytics Export - Generated: ${format(new Date(), 'PPpp')}`,
      `Date Range: ${formatDateRangeForExport(dateRange.from, dateRange.to)}`,
      ''
    ];

    exportToCSV(csvData, `job_analytics_${timestamp}.csv`, metadata);
    toast.success('Analytics data exported to CSV');
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);
      const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
      const filename = `job_analytics_${timestamp}.pdf`;

      await exportDashboardToPDF('job-analytics-container', filename, {
        title: 'Job Analytics Report',
        dateRange: formatDateRangeForExport(dateRange.from, dateRange.to),
        companyName: 'PITCH Roofing'
      });

      toast.success('PDF report generated');
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const handleEmailReport = async () => {
    try {
      // Generate PDF first
      const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
      const filename = `job_analytics_${timestamp}.pdf`;
      const pdfBlob = await exportDashboardToPDF('job-analytics-container', filename, {
        title: 'Job Analytics Report',
        dateRange: formatDateRangeForExport(dateRange.from, dateRange.to),
        companyName: 'PITCH Roofing'
      });

      // Upload to Supabase Storage
      const filePath = `analytics/${timestamp}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(filePath, pdfBlob);

      if (uploadError) throw uploadError;

      // Get signed URL
      const { data: urlData } = await supabase.storage
        .from('reports')
        .createSignedUrl(filePath, 604800); // 7 days

      if (!urlData) throw new Error('Failed to create signed URL');

      // Send email
      const { error: emailError } = await supabase.functions.invoke('send-email', {
        body: {
          to: [emailForm.to],
          subject: emailForm.subject,
          body: `${emailForm.message}\n\nView Report: ${urlData.signedUrl}`
        }
      });

      if (emailError) throw emailError;

      toast.success('Report emailed successfully');
      setEmailDialogOpen(false);
      setEmailForm({
        to: '',
        subject: `Job Analytics Report - ${format(new Date(), 'PP')}`,
        message: 'Please find the attached job analytics report.'
      });
    } catch (error) {
      console.error('Email report error:', error);
      toast.error('Failed to email report');
    }
  };

  const MetricCard = ({ title, value, subtitle, icon: Icon, color, onClick }: any) => (
    <Card 
      className={cn(
        "relative overflow-hidden",
        onClick && "cursor-pointer hover:shadow-md transition-shadow"
      )}
      onClick={onClick}
      data-testid={`job-analytics-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
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
    <div id="job-analytics-container" className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">Job Analytics</h2>
        
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => setDateRange(range || { from: subDays(new Date(), 30), to: new Date() })}
            data-testid="job-analytics-date-filter"
          />

          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            data-testid="job-analytics-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isExporting}>
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleExportCSV} data-testid="job-analytics-export-csv">
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF} data-testid="job-analytics-export-pdf">
                <Download className="h-4 w-4 mr-2" />
                Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setEmailDialogOpen(true)}
            data-testid="job-analytics-email-report"
          >
            <Mail className="h-4 w-4 mr-2" />
            Email Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Jobs"
          value={metrics.total_jobs}
          icon={BarChart3}
          color="bg-blue-100 text-blue-600"
          onClick={() => navigate(`/job-analytics/drilldown?metric=total&from=${dateRange.from?.toISOString()}&to=${dateRange.to?.toISOString()}`)}
        />
        
        <MetricCard
          title="Leads"
          value={metrics.lead_jobs}
          subtitle={`${metrics.total_jobs > 0 ? Math.round((metrics.lead_jobs / metrics.total_jobs) * 100) : 0}% of total`}
          icon={Users}
          color="bg-amber-100 text-amber-600"
          onClick={() => navigate(`/job-analytics/drilldown?metric=leads&from=${dateRange.from?.toISOString()}&to=${dateRange.to?.toISOString()}`)}
        />
        
        <MetricCard
          title="Production"
          value={metrics.production_jobs}
          subtitle={`${metrics.total_jobs > 0 ? Math.round((metrics.production_jobs / metrics.total_jobs) * 100) : 0}% of total`}
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
          onClick={() => navigate(`/job-analytics/drilldown?metric=production&from=${dateRange.from?.toISOString()}&to=${dateRange.to?.toISOString()}`)}
        />
        
        <MetricCard
          title="Closed"
          value={metrics.closed_jobs}
          subtitle={`${metrics.completion_rate}% completion rate`}
          icon={CheckCircle}
          color="bg-gray-100 text-gray-600"
          onClick={() => navigate(`/job-analytics/drilldown?metric=closed&from=${dateRange.from?.toISOString()}&to=${dateRange.to?.toISOString()}`)}
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

      {/* Email Report Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Analytics Report</DialogTitle>
            <DialogDescription>
              Send the job analytics report as a PDF attachment
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email-to">To</Label>
              <Input
                id="email-to"
                type="email"
                placeholder="recipient@example.com"
                value={emailForm.to}
                onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email-message">Message</Label>
              <Textarea
                id="email-message"
                rows={4}
                value={emailForm.message}
                onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEmailReport} disabled={!emailForm.to}>
              <Mail className="h-4 w-4 mr-2" />
              Send Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
