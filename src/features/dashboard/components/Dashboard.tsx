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
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";
import { useLocation } from "@/contexts/LocationContext";
import { DashboardAIAssistant } from "./DashboardAIAssistant";
import { cn } from "@/lib/utils";
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
  ChevronDown,
  HardHat,
  Home,
  Activity,
  Building2,
  MapPin
} from "lucide-react";
import { DateRange } from "react-day-picker";
import { subDays, format } from "date-fns";
import { exportToCSV } from "@/lib/export-utils";
import { toast } from "sonner";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { activeCompany } = useCompanySwitcher();
  const { currentLocationId, currentLocation } = useLocation();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 90),
    to: new Date()
  });

  // Fetch Job Action Items metrics - filtered by location
  const { data: unassignedLeads = 0 } = useQuery({
    queryKey: ['dashboard-unassigned-leads', dateRange, currentLocationId],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .is('assigned_to', null)
        .in('status', ['lead', 'estimate', 'negotiating']);
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
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
    queryKey: ['dashboard-jobs-approval', dateRange, currentLocationId],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ready_for_approval');
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
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
    queryKey: ['dashboard-jobs-progress', dateRange, currentLocationId],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .in('status', ['project', 'production', 'installation']);
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
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
    queryKey: ['dashboard-watch-list', currentLocationId],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('metadata, location_id')
        .not('metadata', 'is', null);
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
      const { data } = await query;
      const watchList = data?.filter(entry => {
        const metadata = entry.metadata as any;
        return metadata?.watch_list === true;
      }) || [];
      return watchList.length;
    }
  });

  const { data: leadsCount = 0 } = useQuery({
    queryKey: ['dashboard-leads-count', dateRange, currentLocationId],
    queryFn: async () => {
      let query = supabase
        .from('pipeline_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'lead');
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
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

  // Pipeline status counts - filtered by tenant, role, AND location
  const { data: pipelineStatusCounts = {}, isError: pipelineError } = useQuery({
    queryKey: ['dashboard-pipeline-counts', user?.id, user?.active_tenant_id || user?.tenant_id, currentLocationId],
    queryFn: async () => {
      if (!user) return {};
      
      // Use active_tenant_id from useCurrentUser (already fetched)
      const tenantId = user.active_tenant_id || user.tenant_id;
      if (!tenantId) {
        console.warn('[Dashboard] No tenant_id available for pipeline query');
        return {};
      }
      
      console.log('[Dashboard] Fetching pipeline counts for tenant:', tenantId, 'location:', currentLocationId, 'user:', user.id, 'role:', user.role);
      
      // Build query - NO date range filter for pipeline status (shows current state)
      let query = supabase
        .from('pipeline_entries')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false);
      
      // Filter by location if selected
      if (currentLocationId) {
        query = query.eq('location_id', currentLocationId);
      }
      
      // For non-admin roles, only show their assigned/created entries
      const adminRoles = ['master', 'corporate', 'office_admin'];
      if (!adminRoles.includes(user.role)) {
        query = query.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('[Dashboard] Pipeline query error:', error);
        throw error;
      }
      
      console.log('[Dashboard] Pipeline entries fetched:', data?.length || 0);
      
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
      
      console.log('[Dashboard] Pipeline counts:', counts);
      return counts;
    },
    enabled: !!user && !!(user.active_tenant_id || user.tenant_id),
    retry: 2
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
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex items-center justify-between w-full">
          <div>
          <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold gradient-primary bg-clip-text text-transparent">
                {activeCompany?.tenant_name || 'PITCH'} Dashboard
              </h1>
              {currentLocation && (
                <Badge variant="outline" className="text-xs md:text-sm">
                  <MapPin className="h-3 w-3 mr-1" />
                  {currentLocation.name}
                </Badge>
              )}
            </div>
            <p className="text-sm md:text-base text-muted-foreground">
              Welcome back! Here's your roofing business overview.
            </p>
          </div>
          {activeCompany?.logo_url && (
            <img 
              src={activeCompany.logo_url} 
              alt={activeCompany.tenant_name}
              className="h-12 w-auto object-contain rounded-md"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => setDateRange(range || { from: subDays(new Date(), 90), to: new Date() })}
            data-testid="dashboard-date-filter"
          />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Download className="h-4 w-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleExportCSV} data-testid="dashboard-export-data">
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="dashboard-print" className="h-9">
            <Printer className="h-4 w-4" />
          </Button>

          <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
        <ContactFormDialog
          trigger={
            <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-primary touch-manipulation active:scale-[0.98]">
              <CardContent className="p-4 md:p-6 text-center text-white">
                <Plus className="h-6 w-6 md:h-8 md:w-8 mx-auto mb-2" />
                <h3 className="font-semibold text-sm md:text-base mb-1">New Contact</h3>
                <p className="text-xs md:text-sm opacity-90">Add a new customer contact</p>
              </CardContent>
            </Card>
          }
          onContactCreated={() => {
            console.log('New contact created');
          }}
        />
        
        <Card 
          className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-secondary touch-manipulation active:scale-[0.98]"
          onClick={() => navigate('/estimates')}
        >
          <CardContent className="p-4 md:p-6 text-center text-white">
            <DollarSign className="h-6 w-6 md:h-8 md:w-8 mx-auto mb-2" />
            <h3 className="font-semibold text-sm md:text-base mb-1">Create Estimate</h3>
            <p className="text-xs md:text-sm opacity-90">Build a new roof estimate</p>
          </CardContent>
        </Card>
        
        <Card
          className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-success touch-manipulation active:scale-[0.98] sm:col-span-2 md:col-span-1"
          onClick={() => navigate('/production')}
        >
          <CardContent className="p-4 md:p-6 text-center text-white">
            <Wrench className="h-6 w-6 md:h-8 md:w-8 mx-auto mb-2" />
            <h3 className="font-semibold text-sm md:text-base mb-1">Schedule Work</h3>
            <p className="text-xs md:text-sm opacity-90">Manage project schedules</p>
          </CardContent>
        </Card>
      </div>


      {/* Pipeline Overview */}
      <Card className="shadow-soft border-0">
        <CardHeader className="pb-3 md:pb-6">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-4">
            {dashboardPipelineData.map((stage, index) => (
              <div key={index} className="text-center">
                <div className={`${stage.color} rounded-lg p-2 md:p-4 mb-1 md:mb-2`}>
                  <div className="text-xl md:text-3xl font-bold text-white">{stage.count}</div>
                </div>
                <div className="text-xs md:text-sm font-medium text-foreground truncate">{stage.status}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Progress Section */}
      <div className="space-y-3">
        <h2 className="text-xl md:text-2xl font-bold">Progress</h2>
        <div className="space-y-3">
          <h3 className="text-xs md:text-sm font-semibold text-muted-foreground tracking-wide">PROGRESS</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <MetricCard
              title="Unassigned Leads"
              count={unassignedLeads}
              icon={UserCircle}
              onClick={() => navigate('/client-list?rep=unassigned')}
            />
            <MetricCard
              title="Jobs for Approval"
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {metrics.map((metric, index) => (
          <Card key={index} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 p-3 md:p-6">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground truncate pr-2">
                {metric.title}
              </CardTitle>
              <metric.icon className={`h-3 w-3 md:h-4 md:w-4 flex-shrink-0 ${metric.color}`} />
            </CardHeader>
            <CardContent className="pt-0 p-3 md:p-6">
              <div className="text-lg md:text-2xl font-bold truncate">{metric.value}</div>
              <p className="text-xs text-success flex items-center gap-1">
                <TrendingUp className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{metric.change} from last month</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Projects */}
      <Card className="shadow-soft border-0">
        <CardHeader className="pb-3 md:pb-6">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Calendar className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            Recent Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {recentProjects.length === 0 ? (
            <div className="text-center py-6 md:py-8 text-muted-foreground">
              <HomeIcon className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm md:text-base">No projects yet. Create your first lead to get started!</p>
            </div>
          ) : (
            <div className="space-y-3 md:space-y-4">
              {recentProjects.map((project, index) => (
                <div 
                  key={index} 
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth cursor-pointer touch-manipulation active:bg-muted gap-2 sm:gap-4"
                  onClick={() => navigate(`/jobs/${project.id}`)}
                  data-testid="dashboard-project-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs md:text-sm text-muted-foreground">{project.id}</span>
                      <Badge variant="outline" className={cn("text-xs", getStatusColor(project.status))}>
                        {project.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-sm md:text-base mt-1 truncate">{project.homeowner}</h3>
                    <p className="text-xs md:text-sm text-muted-foreground truncate">{project.address}</p>
                    <p className="text-xs md:text-sm text-primary truncate">{project.type}</p>
                  </div>
                  <div className="text-left sm:text-right flex sm:flex-col gap-2 sm:gap-0 flex-shrink-0">
                    <div className="text-base md:text-lg font-bold">{project.value}</div>
                    <div className="text-xs md:text-sm text-success">
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