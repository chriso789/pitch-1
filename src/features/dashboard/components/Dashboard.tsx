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
import { LeadForm } from "@/features/contacts/components/LeadForm";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
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
  const [showLeadForm, setShowLeadForm] = useState(false);
  const navigate = useNavigate();
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

  // Export handlers
  const handleExportCSV = () => {
    const csvData = [
      // Pipeline Summary
      { section: 'Pipeline Summary', status: 'Lead', count: leadsCount },
      { section: 'Pipeline Summary', status: 'Legal', count: 12 },
      { section: 'Pipeline Summary', status: 'Contingency', count: 8 },
      { section: 'Pipeline Summary', status: 'Project', count: 23 },
      { section: 'Pipeline Summary', status: 'Completed', count: 156 },
      { section: 'Pipeline Summary', status: 'Closed', count: 892 },
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
      value: "$1,247,890",
      change: "+12.5%",
      icon: DollarSign,
      color: "text-success"
    },
    {
      title: "Active Projects",
      value: "23",
      change: "+3",
      icon: Wrench,
      color: "text-primary"
    },
    {
      title: "Completed This Month",
      value: "8",
      change: "+2",
      icon: CheckCircle,
      color: "text-success"
    },
    {
      title: "Avg Profit Margin",
      value: "31.2%",
      change: "+1.8%",
      icon: TrendingUp,
      color: "text-success"
    }
  ];

  const dashboardPipelineData = [
    { status: "Lead", count: leadsCount, color: "bg-status-lead" },
    { status: "Legal", count: 12, color: "bg-status-legal" },
    { status: "Contingency", count: 8, color: "bg-status-contingency" },
    { status: "Project", count: 23, color: "bg-status-project" },
    { status: "Completed", count: 156, color: "bg-status-completed" },
    { status: "Closed", count: 892, color: "bg-status-closed" }
  ];

  const recentProjects = [
    {
      id: "P-2024-001",
      homeowner: "Johnson Residence",
      address: "123 Oak St, Austin, TX",
      type: "Shingle Replacement",
      value: "$18,450",
      status: "Project",
      profit: "32.1%"
    },
    {
      id: "P-2024-002", 
      homeowner: "Smith Property",
      address: "456 Pine Ave, Dallas, TX",
      type: "Metal Roof Install",
      value: "$32,800",
      status: "Legal",
      profit: "28.5%"
    },
    {
      id: "P-2024-003",
      homeowner: "Williams Home",
      address: "789 Elm Dr, Houston, TX", 
      type: "Tile Repair",
      value: "$8,920",
      status: "Contingency",
      profit: "35.2%"
    }
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

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card 
          className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-primary"
          onClick={() => setShowLeadForm(true)}
        >
          <CardContent className="p-6 text-center text-white">
            <Plus className="h-8 w-8 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">New Lead</h3>
            <p className="text-sm opacity-90">Add a new customer lead</p>
          </CardContent>
        </Card>
        
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
        </CardContent>
      </Card>

      {/* Lead Form Dialog */}
      <LeadForm 
        open={showLeadForm} 
        onOpenChange={setShowLeadForm}
        onLeadCreated={() => {
          // Refresh dashboard data if needed
          console.log('New lead created');
        }}
      />
    </div>
  );
};

export default Dashboard;