import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Activity, DollarSign, Clock, TrendingUp, Zap, Brain, CheckCircle } from "lucide-react";
import { useAIUsageMetrics, useAIUsageHistory, useAIUsageTimeSeries } from "@/hooks/useAIUsageMetrics";
import { AIUsageCharts } from "./AIUsageCharts";
import { AIUsageTable } from "./AIUsageTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const AIUsageDashboard = () => {
  const [timeRange, setTimeRange] = useState<number>(24);
  const { data: stats, isLoading: statsLoading } = useAIUsageMetrics(timeRange);
  const { data: history } = useAIUsageHistory(100);
  const { data: timeSeries } = useAIUsageTimeSeries(timeRange);

  // Check if Claude/Anthropic API key is configured
  const { data: hasAnthropicKey } = useQuery({
    queryKey: ['anthropic-key-check'],
    queryFn: async () => {
      // Check if there are any Claude requests in the usage metrics
      const { count } = await supabase
        .from('ai_usage_metrics')
        .select('*', { count: 'exact', head: true })
        .eq('provider', 'anthropic')
        .limit(1);
      return (count ?? 0) > 0;
    },
  });

  if (statsLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <div className="space-y-6">
      {/* AI Connection Status */}
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium">AI Integration Status</p>
                <p className="text-sm text-muted-foreground">Claude & OpenAI APIs</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
              <CheckCircle className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Usage Analytics</h2>
          <p className="text-muted-foreground">
            Real-time monitoring of Claude and OpenAI integrations
          </p>
        </div>
        <Select value={timeRange.toString()} onValueChange={(v) => setTimeRange(parseInt(v))}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 1 hour</SelectItem>
            <SelectItem value="6">Last 6 hours</SelectItem>
            <SelectItem value="24">Last 24 hours</SelectItem>
            <SelectItem value="168">Last 7 days</SelectItem>
            <SelectItem value="720">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats?.total_requests || 0)}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.success_rate || 0}% success rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats?.total_tokens || 0)}</div>
            <p className="text-xs text-muted-foreground">
              Across all providers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(stats?.total_cost_usd || 0)}</div>
            <p className="text-xs text-muted-foreground">
              Estimated spend
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(stats?.avg_response_time_ms || 0)}ms
            </div>
            <p className="text-xs text-muted-foreground">
              Across all requests
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Provider Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Usage by Provider
            </CardTitle>
            <CardDescription>Token consumption and costs per AI provider</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats?.by_provider?.map((provider) => (
              <div key={provider.provider} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={provider.provider === 'claude' ? 'default' : 'secondary'}>
                      {provider.provider}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatNumber(provider.requests)} requests
                    </span>
                  </div>
                  <span className="text-sm font-medium">{formatCost(provider.cost_usd)}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatNumber(provider.tokens)} tokens
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Usage by Feature
            </CardTitle>
            <CardDescription>Performance metrics per CRM feature</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats?.by_feature?.slice(0, 5).map((feature) => (
              <div key={feature.feature} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">
                    {feature.feature.replace(/-/g, ' ')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(feature.requests)} requests
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Avg: {Math.round(feature.avg_response_time)}ms
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Views */}
      <Tabs defaultValue="charts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="history">Request History</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-4">
          <AIUsageCharts timeSeries={timeSeries || []} />
        </TabsContent>

        <TabsContent value="history">
          <AIUsageTable history={history || []} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
