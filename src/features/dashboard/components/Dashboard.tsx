import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ContactFormDialog from "@/components/ContactFormDialog";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DashboardAIAssistant } from "./DashboardAIAssistant";
import { 
  DollarSign, 
  TrendingUp, 
  Users, 
  Calendar,
  HomeIcon,
  Wrench,
  CheckCircle,
  Clock,
  AlertTriangle,
  Plus,
  UserCircle,
  FileCheck,
  Eye,
  Download,
  Printer,
  ChevronDown
} from "lucide-react";
import { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";
import { exportToCSV } from "@/lib/export-utils";
import { toast } from "sonner";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date()
  });

  // Fetch Job Action Items metrics
  const { data: unassignedLeads = 0 } = useQuery({
    queryKey: ['dashboard-unassigned-leads', dateRange],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .is('assigned_to', null)
        .in('status', ['lead', 'estimate', 'negotiating']);
      
      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      
      const { count } = await query;
      return count || 0;
    }
  });

  const { data: jobsForApproval = 0 } = useQuery({
    queryKey: ['dashboard-jobs-approval', dateRange],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ready_for_approval');
      
      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      
      const { count } = await query;
      return count || 0;
    }
  });

  const { data: jobsInProgress = 0 } = useQuery({
    queryKey: ['dashboard-jobs-progress', dateRange],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .in('status', ['project', 'production', 'installation']);
      
      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      
      const { count } = await query;
      return count || 0;
    }
  });

  const { data: watchListCount = 0 } = useQuery({
    queryKey: ['dashboard-watch-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .not('metadata', 'is', null);
      const watchList = data?.filter(entry => {
        const metadata = entry.metadata as any;
        return metadata?.watch_list === true;
      }) || [];
      return watchList.length;
    }
  });

  const { data: leadsCount = 0 } = useQuery({
    queryKey: ['dashboard-leads-count', dateRange],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'lead');
      
      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      
      const { count } = await query;
      return count || 0;
    }
  });

  // Pipeline status counts - filtered by tenant and role (no date filter)
  const { data: pipelineStatusCounts = {} } = useQuery({
    queryKey: ['dashboard-pipeline-counts', user?.id, user?.tenant_id],
    queryFn: async () => {
      if (!user) return {};
      
      // Get user's active tenant
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', user.id)
        .single();
      
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return {};
      
      // Build query - NO date range filter for pipeline status (shows current state)
      let query = supabase
        .from('pipeline_entries')
        .select('status')
        .eq('tenant_id', tenantId);
      
      // For non-admin roles, only show their assigned/created entries
      const adminRoles = ['master', 'corporate', 'office_admin'];
      if (!adminRoles.includes(user.role)) {
        query = query.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
      }
      
      const { data } = await query;
      
      const counts: Record<string, number> = {
        lead: 0,
        legal_review: 0,
        contingency_signed: 0,
        project: 0,
        completed: 0,
        closed: 0
      };
      
      data?.forEach(entry => {
        const status = entry.status;
        if (status in counts) {
          counts[status]++;
        }
      });
      
      return counts;
    },
    enabled: !!user
  });

  // Revenue and active projects
  const { data: revenueData } = useQuery({
    queryKey: ['dashboard-revenue', dateRange],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select('budget_data')
        .eq('status', 'active');
      
      const totalRevenue = projects?.reduce((sum, p) => {
        const budgetTotal = (p.budget_data as any)?.total || 0;
        return sum + budgetTotal;
      }, 0) || 0;
      
      return { total: totalRevenue, change: 0 };
    }
  });

  const { data: activeProjects = 0 } = useQuery({
    queryKey: ['dashboard-active-projects'],
    queryFn: async () => {
      const { count } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      return count || 0;
    }
  });

  const { data: completedThisMonth = 0 } = useQuery({
    queryKey: ['dashboard-completed-month'],
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0,0,0,0);
      
      const { count } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('actual_completion_date', startOfMonth.toISOString());
      return count || 0;
    }
  });

  const { data: profitMargin } = useQuery({
    queryKey: ['dashboard-profit-margin'],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select('budget_data')
        .in('status', ['active', 'completed']);
      
      const margins = projects?.map(p => {
        const budget = (p.budget_data as any) || {};
        const total = budget.total || 0;
        const cost = budget.total_cost || 0;
        return total > 0 ? ((total - cost) / total) * 100 : 0;
      }).filter(m => m > 0) || [];
      
      const avgMargin = margins.length > 0 
        ? margins.reduce((a, b) => a + b, 0) / margins.length 
        : 0;
      
      return { value: avgMargin, change: 0 };
    }
  });

  // Recent projects
  const { data: recentProjects = [] } = useQuery({
    queryKey: ['dashboard-recent-projects'],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select(`
          id,
          project_number,
          name,
          status,
          budget_data,
          pipeline_entry_id,
          pipeline_entries!inner (
            id,
            contact_id,
            contacts (
              first_name,
              last_name,
              address_street,
              address_city,
              address_state
            )
          )
        `)
        .order('created_at', { ascending: false })
        .limit(5);
      
      return projects?.map(project => {
        const contact = (project.pipeline_entries as any)?.contacts;
        const budget = (project.budget_data as any) || {};
        const total = budget.total || 0;
        const cost = budget.total_cost || 0;
        const profit = total > 0 ? ((total - cost) / total) * 100 : 0;
        
        return {
          id: project.project_number || project.id,
          homeowner: contact 
            ? `${contact.first_name} ${contact.last_name}` 
            : project.name || 'Unknown',
          address: contact 
            ? `${contact.address_street}, ${contact.address_city}, ${contact.address_state}` 
            : 'Address not available',
          type: budget.roof_type || 'Roofing Project',
          value: total > 0 ? `$${total.toLocaleString()}` : '$0',
          status: project.status === 'active' ? 'Project' : project.status,
          profit: profit > 0 ? `${profit.toFixed(1)}%` : '0%'
        };
      }) || [];
    }
  });

  // Export handlers
  const handleExportCSV = () => {
    const csvData = [
      // Pipeline Summary
      { section: 'Pipeline Summary', status: 'Lead', count: (pipelineStatusCounts as any).lead || 0 },
      { section: 'Pipeline Summary', status: 'Legal', count: (pipelineStatusCounts as any).legal_review || 0 },
      { section: 'Pipeline Summary', status: 'Contingency', count: (pipelineStatusCounts as any).contingency_signed || 0 },
      { section: 'Pipeline Summary', status: 'Project', count: (pipelineStatusCounts as any).project || 0 },
      { section: 'Pipeline Summary', status: 'Completed', count: (pipelineStatusCounts as any).completed || 0 },
      { section: 'Pipeline Summary', status: 'Closed', count: (pipelineStatusCounts as any).closed || 0 },
      {},
      // Progress Metrics
      { section: 'Progress', metric: 'Unassigned Leads', value: unassignedLeads },
      { section: 'Progress', metric: 'Jobs for Approval', value: jobsForApproval },
      { section: 'Progress', metric: 'Jobs in Progress', value: jobsInProgress },
      { section: 'Progress', metric: 'Watch List', value: watchListCount },
      {},
      // Recent Projects
      ...recentProjects.map(p => ({
        section: 'Recent Projects',
        id: p.id,
        homeowner: p.homeowner,
        address: p.address,
        type: p.type,
        value: p.value,
        status: p.status,
        profit: p.profit
      }))
    ];

    const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
    const metadata = [
      `Dashboard Export - Generated: ${format(new Date(), 'PPpp')}`,
      `Date Range: ${format(dateRange.from || new Date(), 'PP')} - ${format(dateRange.to || new Date(), 'PP')}`,
      ''
    ];

    exportToCSV(csvData, `dashboard_export_${timestamp}.csv`, metadata);
    toast.success('Dashboard data exported to CSV');
  };

  const handlePrint = () => {
    window.print();
    toast.success('Opening print dialog');
  };

  const metrics = [
    {
      title: "Total Revenue",
      value: revenueData?.total ? `$${revenueData.total.toLocaleString()}` : "$0",
      change: revenueData?.change ? `+${revenueData.change.toFixed(1)}%` : "0%",
      icon: DollarSign,
      color: "text-success"
    },
    {
      title: "Active Projects",
      value: String(activeProjects),
      change: "+0",
      icon: Wrench,
      color: "text-primary"
    },
    {
      title: "Completed This Month",
      value: String(completedThisMonth),
      change: "+0",
      icon: CheckCircle,
      color: "text-success"
    },
    {
      title: "Avg Profit Margin",
      value: profitMargin?.value ? `${profitMargin.value.toFixed(1)}%` : "0%",
      change: profitMargin?.change ? `+${profitMargin.change.toFixed(1)}%` : "0%",
      icon: TrendingUp,
      color: "text-success"
    }
  ];

  const dashboardPipelineData = [
    { status: "Lead", count: (pipelineStatusCounts as any).lead || 0, color: "bg-status-lead" },
    { status: "Legal", count: (pipelineStatusCounts as any).legal_review || 0, color: "bg-status-legal" },
    { status: "Contingency", count: (pipelineStatusCounts as any).contingency_signed || 0, color: "bg-status-contingency" },
    { status: "Project", count: (pipelineStatusCounts as any).project || 0, color: "bg-status-project" },
    { status: "Completed", count: (pipelineStatusCounts as any).completed || 0, color: "bg-status-completed" },
    { status: "Closed", count: (pipelineStatusCounts as any).closed || 0, color: "bg-status-closed" }
  ];

  const getStatusColor = (status: string) => {
    const colors = {
      "Lead": "bg-status-lead text-foreground",
      "Legal": "bg-status-legal text-status-legal-foreground",
      "Contingency": "bg-status-contingency text-status-contingency-foreground", 
      "Project": "bg-status-project text-status-project-foreground",
      "Completed": "bg-status-completed text-status-completed-foreground",
      "Closed": "bg-status-closed text-status-closed-foreground"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            PITCH Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your roofing business overview.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => setDateRange(range || { from: subDays(new Date(), 30), to: new Date() })}
            data-testid="dashboard-date-filter"
          />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleExportCSV} data-testid="dashboard-export-data">
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="dashboard-print">
            <Printer className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">
              {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Floating AI Assistant */}
      <DashboardAIAssistant />

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ContactFormDialog
          trigger={
            <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-primary">
              <CardContent className="p-6 text-center text-white">
                <Plus className="h-8 w-8 mx-auto mb-2" />
                <h3 className="font-semibold mb-1">New Contact</h3>
                <p className="text-sm opacity-90">Add a new customer contact</p>
              </CardContent>
            </Card>
          }
          onContactCreated={() => {
            console.log('New contact created');
          }}
        />
        
        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-secondary">
          <CardContent className="p-6 text-center text-white">
            <DollarSign className="h-8 w-8 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">Create Estimate</h3>
            <p className="text-sm opacity-90">Build a new roof estimate</p>
          </CardContent>
        </Card>
        
        <Card 
          className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-success"
          onClick={() => navigate('/production')}
        >
          <CardContent className="p-6 text-center text-white">
            <Wrench className="h-8 w-8 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">Schedule Work</h3>
            <p className="text-sm opacity-90">Manage project schedules</p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Overview */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {dashboardPipelineData.map((stage, index) => (
              <div key={index} className="text-center">
                <div className={`${stage.color} rounded-lg p-4 mb-2`}>
                  <div className="text-3xl font-bold text-white">{stage.count}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{stage.status}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Progress Section */}
      <div className="space-y-3">
        <h2 className="text-2xl font-bold">Progress</h2>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground tracking-wide">PROGRESS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Unassigned Leads"
              count={unassignedLeads}
              icon={UserCircle}
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Jobs Submitted for Approval"
              count={jobsForApproval}
              icon={FileCheck}
              variant="warning"
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Jobs in Progress"
              count={jobsInProgress}
              icon={Wrench}
              onClick={() => navigate('/pipeline')}
            />
            <MetricCard
              title="Watch List"
              count={watchListCount}
              icon={Eye}
              onClick={() => navigate('/pipeline')}
            />
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, index) => (
          <Card key={index} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.title}
              </CardTitle>
              <metric.icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-success flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {metric.change} from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Projects */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Recent Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <HomeIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No projects yet. Create your first lead to get started!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentProjects.map((project, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth cursor-pointer"
                  onClick={() => navigate(`/jobs/${project.id}`)}
                  data-testid="dashboard-project-card"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-muted-foreground">{project.id}</span>
                      <Badge variant="outline" className={getStatusColor(project.status)}>
                        {project.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold mt-1">{project.homeowner}</h3>
                    <p className="text-sm text-muted-foreground">{project.address}</p>
                    <p className="text-sm text-primary">{project.type}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{project.value}</div>
                    <div className="text-sm text-success">
                      {project.profit} profit
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};

export default Dashboard;