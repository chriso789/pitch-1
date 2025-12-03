import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Activity, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Clock,
  Zap,
  Server
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface FunctionHealth {
  name: string;
  status: 'healthy' | 'slow' | 'failed';
  response_time_ms: number;
  error?: string;
  checked_at: string;
}

interface HealthCheckResult {
  success: boolean;
  summary: {
    total: number;
    healthy: number;
    slow: number;
    failed: number;
    avg_response_time_ms: number;
  };
  functions: FunctionHealth[];
  checked_at: string;
}

interface HistoryEntry {
  timestamp: string;
  [key: string]: number | string;
}

const FUNCTION_DESCRIPTIONS: Record<string, string> = {
  'verify-website': 'Validates company websites during setup',
  'google-maps-proxy': 'Handles all Google Maps API requests',
  'google-address-validation': 'Address autocomplete & validation',
  'supabase-health': 'Database connectivity check',
  'analyze-roof-aerial': 'AI-powered roof measurements',
  'generate-measurement-visualization': 'Mapbox satellite image generation',
  'crm-ai-agent': 'Dashboard AI assistant',
};

export const EdgeFunctionHealthDashboard: React.FC = () => {
  const [healthData, setHealthData] = useState<HealthCheckResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const { toast } = useToast();

  const runHealthCheck = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('edge-health-check', {
        body: {},
      });

      if (error) throw error;

      const result = data as HealthCheckResult;
      setHealthData(result);
      setLastChecked(new Date());

      // Add to history (keep last 10 entries)
      const historyEntry: HistoryEntry = {
        timestamp: new Date().toLocaleTimeString(),
      };
      result.functions.forEach(fn => {
        historyEntry[fn.name] = fn.response_time_ms;
      });

      setHistory(prev => [...prev.slice(-9), historyEntry]);

      // Show toast for any failures
      if (result.summary.failed > 0) {
        const failedFunctions = result.functions
          .filter(f => f.status === 'failed')
          .map(f => f.name)
          .join(', ');
        toast({
          title: "Health Check Warning",
          description: `Failed functions: ${failedFunctions}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Health check error:', err);
      toast({
        title: "Health Check Failed",
        description: err instanceof Error ? err.message : "Unable to run health check",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(runHealthCheck, 30000); // Every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, runHealthCheck]);

  // Initial load
  useEffect(() => {
    runHealthCheck();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'slow':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Activity className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500/20 text-green-700 border-green-500/30">Healthy</Badge>;
      case 'slow':
        return <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">Slow</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getResponseTimeColor = (ms: number) => {
    if (ms < 500) return 'text-green-600';
    if (ms < 2000) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatFunctionName = (name: string) => {
    return name.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            Edge Function Health Monitor
          </h2>
          <p className="text-muted-foreground">
            Real-time status of critical backend services
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <Label htmlFor="auto-refresh" className="text-sm">
              Auto-refresh (30s)
            </Label>
          </div>
          <Button onClick={runHealthCheck} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Run Health Check
          </Button>
        </div>
      </div>

      {/* Last checked timestamp */}
      {lastChecked && (
        <p className="text-sm text-muted-foreground flex items-center gap-1">
          <Clock className="h-4 w-4" />
          Last checked: {lastChecked.toLocaleString()}
        </p>
      )}

      {/* Summary Cards */}
      {healthData && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{healthData.summary.total}</div>
              <p className="text-sm text-muted-foreground">Total Functions</p>
            </CardContent>
          </Card>
          <Card className="border-green-500/30">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{healthData.summary.healthy}</div>
              <p className="text-sm text-muted-foreground">Healthy</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/30">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-600">{healthData.summary.slow}</div>
              <p className="text-sm text-muted-foreground">Slow</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/30">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">{healthData.summary.failed}</div>
              <p className="text-sm text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold flex items-center gap-1">
                <Zap className="h-5 w-5" />
                {healthData.summary.avg_response_time_ms}ms
              </div>
              <p className="text-sm text-muted-foreground">Avg Response</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Function Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {healthData?.functions.map((fn) => (
          <Card key={fn.name} className={
            fn.status === 'failed' ? 'border-red-500/50 bg-red-500/5' :
            fn.status === 'slow' ? 'border-yellow-500/50 bg-yellow-500/5' :
            'border-green-500/30'
          }>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                {getStatusIcon(fn.status)}
                {getStatusBadge(fn.status)}
              </div>
              <CardTitle className="text-base mt-2">{formatFunctionName(fn.name)}</CardTitle>
              <CardDescription className="text-xs">
                {FUNCTION_DESCRIPTIONS[fn.name] || fn.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Response Time</span>
                  <span className={`font-mono font-bold ${getResponseTimeColor(fn.response_time_ms)}`}>
                    {fn.response_time_ms}ms
                  </span>
                </div>
                {fn.error && (
                  <div className="text-xs text-red-600 bg-red-500/10 rounded px-2 py-1">
                    {fn.error}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Response Time History Chart */}
      {history.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Response Time History</CardTitle>
            <CardDescription>Last {history.length} health checks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="timestamp" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    label={{ 
                      value: 'ms', 
                      angle: -90, 
                      position: 'insideLeft',
                      fill: 'hsl(var(--muted-foreground))'
                    }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  {healthData?.functions.map((fn, index) => (
                    <Line
                      key={fn.name}
                      type="monotone"
                      dataKey={fn.name}
                      name={formatFunctionName(fn.name)}
                      stroke={`hsl(${(index * 50) % 360}, 70%, 50%)`}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && !healthData && (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
            <p className="text-muted-foreground">Running health checks...</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
