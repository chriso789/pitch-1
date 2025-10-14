import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Download, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface HealthReport {
  category: string;
  name: string;
  status: "OK" | "WARN" | "MISSING";
  detail: string;
}

interface HealthResponse {
  ok: boolean;
  summary: {
    total: number;
    ok: number;
    missing: number;
    warnings: number;
  };
  report: HealthReport[];
  timestamp: string;
}

export const SystemHealthCheck = () => {
  const { toast } = useToast();
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("supabase-health");
      
      if (error) throw error;
      
      setHealthData(data as HealthResponse);
      setLastChecked(new Date());
      
      if (!data.ok) {
        toast({
          title: "Health Check Issues Detected",
          description: `${data.summary.missing} missing components, ${data.summary.warnings} warnings`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Health check error:", error);
      toast({
        title: "Health Check Failed",
        description: error.message || "Failed to fetch health data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthData();
  }, []);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchHealthData();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const exportReport = () => {
    if (!healthData) return;
    
    const dataStr = JSON.stringify(healthData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `health-report-${new Date().toISOString()}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    toast({
      title: "Report Exported",
      description: "Health report downloaded successfully",
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "OK":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "WARN":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "MISSING":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      OK: "default",
      WARN: "secondary",
      MISSING: "destructive",
    };
    
    return (
      <Badge variant={variants[status] || "outline"} className="flex items-center gap-1">
        {getStatusIcon(status)}
        {status}
      </Badge>
    );
  };

  const groupedReports = healthData?.report.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, HealthReport[]>);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                System Health Monitor
                {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
              </CardTitle>
              <CardDescription>
                Real-time monitoring of database integrity, RLS policies, and system functions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <Clock className="h-4 w-4 mr-2" />
                {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchHealthData}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportReport}
                disabled={!healthData}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Summary Cards */}
          {healthData && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className={healthData.ok ? "border-success" : "border-destructive"}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Overall Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {healthData.ok ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    <span className="text-2xl font-bold">
                      {healthData.ok ? "Healthy" : "Issues"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">OK</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">
                    {healthData.summary.ok}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {((healthData.summary.ok / healthData.summary.total) * 100).toFixed(1)}% healthy
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Warnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">
                    {healthData.summary.warnings}
                  </div>
                  <p className="text-xs text-muted-foreground">Require attention</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Missing</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">
                    {healthData.summary.missing}
                  </div>
                  <p className="text-xs text-muted-foreground">Critical issues</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Last Checked */}
          {lastChecked && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Last checked: {lastChecked.toLocaleString()}
            </div>
          )}

          {/* Detailed Report */}
          {groupedReports && Object.entries(groupedReports).map(([category, items]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base capitalize">{category} Checks</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">{item.name}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.detail || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          {!healthData && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              Click "Refresh" to run a health check
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
