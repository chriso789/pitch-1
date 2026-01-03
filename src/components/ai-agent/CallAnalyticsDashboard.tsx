import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Phone, 
  TrendingUp, 
  Clock, 
  Users, 
  MessageSquare,
  BarChart3,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
  ThermometerSun,
  Snowflake,
  Calendar,
  RefreshCw
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { LiveCallTranscript } from './LiveCallTranscript';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';

interface CallMetrics {
  totalCalls: number;
  avgDuration: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  escalationRate: number;
  appointmentsBooked: number;
}

interface CallsByHour {
  hour: string;
  calls: number;
}

export function CallAnalyticsDashboard() {
  const { profile } = useUserProfile();
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('week');
  const [refreshKey, setRefreshKey] = useState(0);

  // Calculate date range
  const getDateRange = () => {
    const now = new Date();
    switch (dateRange) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case 'month':
        return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
    }
  };

  const { start, end } = getDateRange();

  // Fetch call transcripts for analytics
  const { data: callData, isLoading, refetch } = useQuery({
    queryKey: ['ai-call-analytics', profile?.tenant_id, dateRange, refreshKey],
    queryFn: async () => {
      if (!profile?.tenant_id) return null;

      const { data, error } = await supabase
        .from('ai_call_transcripts')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.tenant_id,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate metrics
  const metrics: CallMetrics = React.useMemo(() => {
    if (!callData || callData.length === 0) {
      return {
        totalCalls: 0,
        avgDuration: 0,
        hotLeads: 0,
        warmLeads: 0,
        coldLeads: 0,
        escalationRate: 0,
        appointmentsBooked: 0,
      };
    }

    const totalCalls = callData.length;
    const totalDuration = callData.reduce((sum, c) => sum + (c.call_duration_seconds || 0), 0);
    const avgDuration = totalDuration / totalCalls;
    
    const hotLeads = callData.filter(c => c.sentiment === 'hot').length;
    const warmLeads = callData.filter(c => c.sentiment === 'warm').length;
    const coldLeads = callData.filter(c => c.sentiment === 'cool').length;
    
    const escalated = callData.filter(c => c.escalated_to_human).length;
    const escalationRate = (escalated / totalCalls) * 100;

    // Count appointments from gathered data
    const appointmentsBooked = callData.filter(c => {
      const data = c.gathered_data as any;
      return data?.timeline?.toLowerCase().includes('schedule') || 
             data?.timeline?.toLowerCase().includes('appointment');
    }).length;

    return {
      totalCalls,
      avgDuration,
      hotLeads,
      warmLeads,
      coldLeads,
      escalationRate,
      appointmentsBooked,
    };
  }, [callData]);

  // Calls by hour data
  const callsByHour: CallsByHour[] = React.useMemo(() => {
    if (!callData) return [];

    const hourCounts: Record<number, number> = {};
    for (let i = 0; i < 24; i++) hourCounts[i] = 0;

    callData.forEach(call => {
      const hour = new Date(call.created_at).getHours();
      hourCounts[hour]++;
    });

    return Object.entries(hourCounts).map(([hour, calls]) => ({
      hour: `${hour.padStart(2, '0')}:00`,
      calls,
    }));
  }, [callData]);

  // Lead quality pie data
  const leadQualityData = [
    { name: 'Hot', value: metrics.hotLeads, color: '#ef4444' },
    { name: 'Warm', value: metrics.warmLeads, color: '#f97316' },
    { name: 'Cool', value: metrics.coldLeads, color: '#3b82f6' },
  ];

  // Daily calls trend
  const dailyCallsTrend = React.useMemo(() => {
    if (!callData) return [];

    const dayCounts: Record<string, number> = {};
    const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : 30;
    
    for (let i = 0; i < days; i++) {
      const date = format(subDays(new Date(), i), 'MMM dd');
      dayCounts[date] = 0;
    }

    callData.forEach(call => {
      const date = format(new Date(call.created_at), 'MMM dd');
      if (dayCounts[date] !== undefined) {
        dayCounts[date]++;
      }
    });

    return Object.entries(dayCounts)
      .map(([date, calls]) => ({ date, calls }))
      .reverse();
  }, [callData, dateRange]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Call Analytics</h2>
          <p className="text-muted-foreground">Monitor AI agent performance and lead quality</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => { refetch(); setRefreshKey(k => k + 1); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Total Calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics.totalCalls}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {dateRange === 'today' ? 'today' : `last ${dateRange === 'week' ? '7' : '30'} days`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg Duration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatDuration(metrics.avgDuration)}</div>
            <p className="text-xs text-muted-foreground mt-1">per call</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Flame className="h-4 w-4" />
              Hot Leads
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{metrics.hotLeads}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.totalCalls > 0 ? `${Math.round((metrics.hotLeads / metrics.totalCalls) * 100)}%` : '0%'} of calls
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Appointments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">{metrics.appointmentsBooked}</div>
            <p className="text-xs text-muted-foreground mt-1">scheduled</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Calls Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Calls Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyCallsTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Area 
                    type="monotone" 
                    dataKey="calls" 
                    stroke="hsl(var(--primary))" 
                    fill="hsl(var(--primary))" 
                    fillOpacity={0.2} 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Lead Quality Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lead Quality Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={leadQualityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {leadQualityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-4">
              {leadQualityData.map(item => (
                <div key={item.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm">{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Calls by Hour Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Peak Calling Hours</CardTitle>
          <CardDescription>Call volume distribution throughout the day</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={callsByHour}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="hour" className="text-xs" interval={2} />
                <YAxis className="text-xs" />
                <Tooltip />
                <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent Calls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent AI Calls</CardTitle>
          <CardDescription>Latest calls handled by the AI agent</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
            <div className="space-y-3">
              {callData?.slice(0, 10).map((call) => {
                const gatheredData = call.gathered_data as any;
                const leadScore = gatheredData?.calculated_lead_score || 0;
                
                return (
                  <div
                    key={call.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        call.sentiment === 'hot' && "bg-red-100 text-red-600",
                        call.sentiment === 'warm' && "bg-orange-100 text-orange-600",
                        call.sentiment === 'cool' && "bg-blue-100 text-blue-600"
                      )}>
                        {call.sentiment === 'hot' ? <Flame className="h-5 w-5" /> :
                         call.sentiment === 'warm' ? <ThermometerSun className="h-5 w-5" /> :
                         <Snowflake className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="font-medium">{gatheredData?.name || call.caller_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {gatheredData?.service_needed || 'General inquiry'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={leadScore >= 70 ? 'default' : 'secondary'}>
                        Score: {leadScore}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(call.created_at), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                );
              })}
              
              {(!callData || callData.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <Phone className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No calls in this period</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
