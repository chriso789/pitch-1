import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Server,
  Database,
  Zap,
  Clock,
  TrendingUp,
  Shield,
  Eye,
  RotateCcw,
  Download
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface SystemCrash {
  id: string;
  error_type: string;
  error_message: string;
  component: string;
  severity: string;
  resolved: boolean;
  auto_recovered: boolean;
  created_at: string;
}

interface HealthCheck {
  id: string;
  service_name: string;
  status: string;
  response_time_ms: number;
  checked_at: string;
}

interface SystemMetric {
  metric_name: string;
  metric_value: number;
  recorded_at: string;
}

export function MonitoringDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [crashes, setCrashes] = useState<SystemCrash[]>([]);
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadMonitoringData();
    const interval = setInterval(loadMonitoringData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadMonitoringData = async () => {
    try {
      // Load crashes
      const { data: crashData } = await supabase
        .from("system_crashes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (crashData) setCrashes(crashData);

      // Load health checks
      const { data: healthData } = await supabase
        .from("health_checks")
        .select("*")
        .order("checked_at", { ascending: false })
        .limit(100);

      if (healthData) setHealthChecks(healthData);

      // Load metrics
      const { data: metricData } = await supabase
        .from("system_metrics")
        .select("*")
        .order("recorded_at", { ascending: false })
        .limit(200);

      if (metricData) setMetrics(metricData);
    } catch (error) {
      console.error("Error loading monitoring data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadMonitoringData();
    setIsRefreshing(false);
    toast({
      title: "Data Refreshed",
      description: "Monitoring data has been updated"
    });
  };

  const resolveCrash = async (crashId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("system_crashes")
        .update({ 
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id
        })
        .eq("id", crashId);

      if (error) throw error;

      toast({
        title: "Crash Resolved",
        description: "The crash has been marked as resolved"
      });
      loadMonitoringData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  // Calculate stats
  const totalCrashes = crashes.length;
  const unresolvedCrashes = crashes.filter(c => !c.resolved).length;
  const autoRecovered = crashes.filter(c => c.auto_recovered).length;
  const criticalCrashes = crashes.filter(c => c.severity === "critical" && !c.resolved).length;

  // Get latest health status for each service
  const latestHealthByService = healthChecks.reduce((acc, check) => {
    if (!acc[check.service_name] || new Date(check.checked_at) > new Date(acc[check.service_name].checked_at)) {
      acc[check.service_name] = check;
    }
    return acc;
  }, {} as Record<string, HealthCheck>);

  const services = Object.values(latestHealthByService);
  const healthyServices = services.filter(s => s.status === "healthy").length;
  const degradedServices = services.filter(s => s.status === "degraded").length;
  const downServices = services.filter(s => s.status === "down").length;

  // Prepare chart data
  const chartData = metrics
    .filter(m => m.metric_name === "response_time")
    .slice(0, 20)
    .reverse()
    .map(m => ({
      time: format(new Date(m.recorded_at), "HH:mm"),
      value: m.metric_value
    }));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "degraded": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "down": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "high": return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "medium": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Monitoring</h1>
          <p className="text-muted-foreground">Real-time system health and crash recovery</p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">System Health</p>
                <p className="text-2xl font-bold">
                  {downServices > 0 ? "Critical" : degradedServices > 0 ? "Degraded" : "Healthy"}
                </p>
              </div>
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                downServices > 0 ? "bg-red-500/10" : degradedServices > 0 ? "bg-yellow-500/10" : "bg-green-500/10"
              }`}>
                <Activity className={`h-6 w-6 ${
                  downServices > 0 ? "text-red-500" : degradedServices > 0 ? "text-yellow-500" : "text-green-500"
                }`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Services</p>
                <p className="text-2xl font-bold">{healthyServices}/{services.length}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Server className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Unresolved Crashes</p>
                <p className="text-2xl font-bold">{unresolvedCrashes}</p>
              </div>
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                criticalCrashes > 0 ? "bg-red-500/10" : "bg-muted"
              }`}>
                <AlertTriangle className={`h-6 w-6 ${
                  criticalCrashes > 0 ? "text-red-500" : "text-muted-foreground"
                }`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Auto-Recovered</p>
                <p className="text-2xl font-bold">{autoRecovered}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <RotateCcw className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="crashes">Crashes</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Service Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Service Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {services.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No services monitored</p>
                ) : (
                  services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(service.status)}
                        <span className="font-medium">{service.service_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {service.response_time_ms}ms
                        </span>
                        <Badge variant="outline" className={
                          service.status === "healthy" ? "bg-green-500/10 text-green-500" :
                          service.status === "degraded" ? "bg-yellow-500/10 text-yellow-500" :
                          "bg-red-500/10 text-red-500"
                        }>
                          {service.status}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Recent Crashes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Crashes</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {crashes.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No crashes recorded</p>
                  ) : (
                    <div className="space-y-3">
                      {crashes.slice(0, 10).map((crash) => (
                        <div key={crash.id} className="p-3 border rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className={getSeverityColor(crash.severity)}>
                                  {crash.severity}
                                </Badge>
                                {crash.auto_recovered && (
                                  <Badge variant="outline" className="bg-green-500/10 text-green-500">
                                    Auto-Recovered
                                  </Badge>
                                )}
                              </div>
                              <p className="font-medium truncate">{crash.error_type}</p>
                              <p className="text-sm text-muted-foreground truncate">
                                {crash.error_message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {crash.component} • {format(new Date(crash.created_at), "MMM d, h:mm a")}
                              </p>
                            </div>
                            {!crash.resolved && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => resolveCrash(crash.id)}
                              >
                                Resolve
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Performance Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Response Time Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="time" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip />
                    <Line 
                      type="monotone" 
                      dataKey="value" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No metric data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>All Services</CardTitle>
              <CardDescription>Health status of all monitored services</CardDescription>
            </CardHeader>
            <CardContent>
              {services.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No services are being monitored</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        {getStatusIcon(service.status)}
                        <div>
                          <p className="font-medium">{service.service_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Last checked: {format(new Date(service.checked_at), "MMM d, h:mm:ss a")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium">{service.response_time_ms}ms</p>
                          <p className="text-xs text-muted-foreground">Response Time</p>
                        </div>
                        <Badge variant="outline" className={
                          service.status === "healthy" ? "bg-green-500/10 text-green-500" :
                          service.status === "degraded" ? "bg-yellow-500/10 text-yellow-500" :
                          "bg-red-500/10 text-red-500"
                        }>
                          {service.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crashes" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Crash History</CardTitle>
              <CardDescription>All recorded system crashes and errors</CardDescription>
            </CardHeader>
            <CardContent>
              {crashes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No crashes recorded - system is stable!</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {crashes.map((crash) => (
                      <div key={crash.id} className="p-4 border rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={getSeverityColor(crash.severity)}>
                              {crash.severity}
                            </Badge>
                            {crash.resolved && (
                              <Badge variant="outline" className="bg-green-500/10 text-green-500">
                                Resolved
                              </Badge>
                            )}
                            {crash.auto_recovered && (
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-500">
                                Auto-Recovered
                              </Badge>
                            )}
                          </div>
                          {!crash.resolved && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => resolveCrash(crash.id)}
                            >
                              Mark Resolved
                            </Button>
                          )}
                        </div>
                        <p className="font-medium">{crash.error_type}</p>
                        <p className="text-sm text-muted-foreground mt-1">{crash.error_message}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>Component: {crash.component || "Unknown"}</span>
                          <span>{format(new Date(crash.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>System Metrics</CardTitle>
              <CardDescription>Performance and usage metrics</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No metrics recorded yet</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {metrics.slice(0, 100).map((metric, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Zap className="h-4 w-4 text-primary" />
                          <span className="font-medium">{metric.metric_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono">{metric.metric_value}</span>
                          <span className="text-sm text-muted-foreground">
                            {format(new Date(metric.recorded_at), "h:mm:ss a")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default MonitoringDashboard;
