import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  TrendingUp, 
  Users, 
  Calendar,
  HomeIcon,
  Wrench,
  CheckCircle,
  Clock,
  AlertTriangle
} from "lucide-react";

const Dashboard = () => {
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
    { status: "Lead", count: 45, color: "bg-status-lead" },
    { status: "Legal Review", count: 12, color: "bg-status-legal" },
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
      status: "Legal Review",
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
      "Legal Review": "bg-status-legal text-status-legal-foreground",
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            PITCH Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your roofing business overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleTimeString()}
          </span>
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

      {/* Pipeline Overview */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HomeIcon className="h-5 w-5 text-primary" />
            Pipeline Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {dashboardPipelineData.map((stage, index) => (
              <div key={index} className="text-center">
                <div className={`w-16 h-16 rounded-full ${stage.color} flex items-center justify-center mx-auto mb-2 shadow-soft`}>
                  <span className="text-2xl font-bold text-white">{stage.count}</span>
                </div>
                <p className="text-sm font-medium">{stage.status}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

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
              <div key={index} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth">
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

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-primary">
          <CardContent className="p-6 text-center text-white">
            <Users className="h-8 w-8 mx-auto mb-2" />
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
        
        <Card className="shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer gradient-success">
          <CardContent className="p-6 text-center text-white">
            <Wrench className="h-8 w-8 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">Schedule Work</h3>
            <p className="text-sm opacity-90">Manage project schedules</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;