import { useState, useEffect } from "react";
import { BackButton } from "./BackButton";
import { FilterBar } from "./FilterBar";
import ProjectDetails from "./ProjectDetails";
import Leaderboard from "./Leaderboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
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
  Eye,
  User,
  FileText,
  AlertCircle
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";

interface ProjectData {
  id: string;
  name: string;
  projectNumber: string;
  homeowner: string;
  address: string;
  type: string;
  value: number;
  status: string;
  profit: number;
  profitPercent: number;
  salesRep: string;
  createdAt: Date;
}

interface EnhancedDashboardProps {
  onBack?: () => void;
}

const EnhancedDashboard = ({ onBack }: EnhancedDashboardProps) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<ProjectData[]>([]);
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    activeProjects: 0,
    completedThisMonth: 0,
    avgProfitMargin: 0
  });
  const [pipelineStats, setPipelineStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch projects with related data
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates(*),
          project_costs(*)
        `)
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;

      // Transform project data
      const transformedProjects: ProjectData[] = projectsData.map((project: any) => {
        const contact = project.pipeline_entries?.contacts;
        const estimate = project.estimates?.[0];
        const costs = project.project_costs || [];
        
        const totalCosts = costs.reduce((sum: number, cost: any) => sum + Number(cost.total_cost), 0);
        const contractValue = estimate ? Number(estimate.selling_price) : 0;
        const profit = contractValue - totalCosts;
        const profitPercent = contractValue > 0 ? (profit / contractValue) * 100 : 0;

        return {
          id: project.id,
          name: project.name,
          projectNumber: project.project_number || 'N/A',
          homeowner: contact ? `${contact.first_name} ${contact.last_name}` : 'Unknown',
          address: contact ? `${contact.address_street}, ${contact.address_city}` : 'Unknown',
          type: project.description || 'Roofing Project',
          value: contractValue,
          status: project.status,
          profit,
          profitPercent,
          salesRep: 'Unknown', // This would come from user data
          createdAt: new Date(project.created_at)
        };
      });

      setProjects(transformedProjects);
      setFilteredProjects(transformedProjects);

      // Calculate metrics
      const totalRevenue = transformedProjects.reduce((sum, p) => sum + p.value, 0);
      const activeProjects = transformedProjects.filter(p => p.status === 'active').length;
      const thisMonth = new Date();
      thisMonth.setMonth(thisMonth.getMonth());
      const completedThisMonth = transformedProjects.filter(p => 
        p.status === 'completed' && 
        p.createdAt.getMonth() === thisMonth.getMonth()
      ).length;
      const avgProfitMargin = transformedProjects.length > 0 
        ? transformedProjects.reduce((sum, p) => sum + p.profitPercent, 0) / transformedProjects.length 
        : 0;

      setMetrics({
        totalRevenue,
        activeProjects,
        completedThisMonth,
        avgProfitMargin
      });

      // Fetch pipeline statistics
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select('status')
        .order('created_at', { ascending: false });

      if (!pipelineError && pipelineData) {
        const statusCounts = pipelineData.reduce((acc: any, entry: any) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        }, {});

        const pipelineStats = [
          { 
            status: "Lead", 
            key: "lead",
            count: statusCounts.lead || 0, 
            color: "bg-status-lead", 
            icon: User,
            expanded: false 
          },
          { 
            status: "Legal", 
            key: "legal",
            count: statusCounts.legal || 0, 
            color: "bg-status-legal", 
            icon: FileText,
            expanded: false 
          },
          { 
            status: "Contingency", 
            key: "contingency_signed",
            count: statusCounts.contingency_signed || 0, 
            color: "bg-status-contingency", 
            icon: AlertCircle,
            expanded: false 
          },
          { 
            status: "Project", 
            key: "project",
            count: statusCounts.project || 0, 
            color: "bg-status-project", 
            icon: HomeIcon,
            expanded: false 
          },
          { 
            status: "Completed", 
            key: "completed",
            count: statusCounts.completed || 0, 
            color: "bg-status-completed", 
            icon: CheckCircle,
            expanded: false 
          },
          { 
            status: "Closed", 
            key: "closed",
            count: statusCounts.closed || 0, 
            color: "bg-status-closed", 
            icon: Clock,
            expanded: false 
          }
        ];

        setPipelineStats(pipelineStats);
      }

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (search: string) => {
    const filtered = projects.filter(project =>
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      project.homeowner.toLowerCase().includes(search.toLowerCase()) ||
      project.address.toLowerCase().includes(search.toLowerCase())
    );
    setFilteredProjects(filtered);
  };

  const handleFilter = (filters: any[]) => {
    let filtered = [...projects];
    
    filters.forEach(filter => {
      switch (filter.key) {
        case 'salesRep':
          filtered = filtered.filter(p => p.salesRep === filter.value);
          break;
        case 'status':
          filtered = filtered.filter(p => p.status === filter.value);
          break;
        case 'costRange':
          // Implementation for cost range filtering
          break;
      }
    });
    
    setFilteredProjects(filtered);
  };

  const handleSort = (sort: { field: string; direction: 'asc' | 'desc' }) => {
    const sorted = [...filteredProjects].sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sort.field) {
        case 'value':
          aValue = a.value;
          bValue = b.value;
          break;
        case 'createdAt':
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        case 'homeowner':
          aValue = a.homeowner;
          bValue = b.homeowner;
          break;
        default:
          return 0;
      }
      
      if (sort.direction === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
    
    setFilteredProjects(sorted);
  };

  // If viewing project details, show that component
  if (selectedProjectId) {
    return (
      <ProjectDetails
        projectId={selectedProjectId}
        onBack={() => setSelectedProjectId(null)}
      />
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    const colors = {
      "active": "bg-status-project text-white",
      "completed": "bg-status-completed text-white",
      "on-hold": "bg-status-contingency text-white",
      "cancelled": "bg-status-closed text-white"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  if (loading) {
    return <div className="p-6">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      {onBack && <BackButton onClick={onBack} />}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            PITCH Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your roofing business overview.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" className="h-8 w-8 rounded-full p-0 gradient-primary">
            <Users className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Calendar
          </Button>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">
              Last updated: {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(metrics.totalRevenue)}</div>
            <p className="text-xs text-success flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Real-time calculation
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Projects
            </CardTitle>
            <Wrench className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeProjects}</div>
            <p className="text-xs text-success flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Live tracking
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed This Month
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.completedThisMonth}</div>
            <p className="text-xs text-success flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Month to date
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Profit Margin
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.avgProfitMargin.toFixed(1)}%</div>
            <p className="text-xs text-success flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Calculated real-time
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Overview */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Sales Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            {pipelineStats.map((stage, index) => (
              <button
                key={index}
                onClick={() => {
                  // Toggle expanded state for this stage
                  const updatedStats = pipelineStats.map((s, i) => 
                    i === index ? { ...s, expanded: !s.expanded } : s
                  );
                  setPipelineStats(updatedStats);
                }}
                className="text-center p-4 rounded-lg border border-border hover:shadow-soft transition-smooth bg-card"
              >
                <div className={`w-12 h-12 rounded-full ${stage.color} flex items-center justify-center mx-auto mb-3 shadow-soft`}>
                  <stage.icon className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl font-bold mb-1">{stage.count}</div>
                <p className="text-sm font-medium text-muted-foreground">{stage.status}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stage.count === 1 ? 'lead' : 'leads'}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Projects with Filters */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Recent Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            searchPlaceholder="Search projects..."
            filterOptions={[
              {
                key: 'salesRep',
                label: 'Sales Rep',
                options: [
                  { value: 'john-doe', label: 'John Doe' },
                  { value: 'jane-smith', label: 'Jane Smith' }
                ]
              },
              {
                key: 'status',
                label: 'Status',
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'on-hold', label: 'On Hold' }
                ]
              },
              {
                key: 'costRange',
                label: 'Cost Range',
                options: [
                  { value: '0-10000', label: '$0 - $10K' },
                  { value: '10000-25000', label: '$10K - $25K' },
                  { value: '25000+', label: '$25K+' }
                ]
              }
            ]}
            sortOptions={[
              { value: 'value', label: 'Project Value' },
              { value: 'createdAt', label: 'Date Created' },
              { value: 'homeowner', label: 'Customer Name' }
            ]}
            onSearchChange={handleSearch}
            onFilterChange={handleFilter}
            onSortChange={handleSort}
          />

          <div className="space-y-3">
            {filteredProjects.map((project) => (
              <div key={project.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-muted-foreground">#{project.projectNumber}</span>
                    <Badge variant="outline" className={getStatusColor(project.status)}>
                      {project.status}
                    </Badge>
                  </div>
                  <h3 className="font-semibold mt-1">{project.homeowner}</h3>
                  <p className="text-sm text-muted-foreground">{project.address}</p>
                  <p className="text-sm text-primary">{project.type}</p>
                </div>
                <div className="text-right mr-4">
                  <div className="text-lg font-bold">{formatCurrency(project.value)}</div>
                  <div className={`text-sm ${project.profitPercent >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {project.profitPercent.toFixed(1)}% profit
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setSelectedProjectId(project.id)}
                  className="flex items-center gap-2"
                >
                  <Eye className="h-4 w-4" />
                  View Details
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sales Leaderboard */}
      <Leaderboard />
    </div>
  );
};

export default EnhancedDashboard;