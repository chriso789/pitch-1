/**
 * Organization Activity Chart
 * Line chart showing login trends over time
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format, startOfDay, eachDayOfInterval } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp } from 'lucide-react';

interface OrgActivityChartProps {
  tenantId: string;
  timeRange: '7d' | '30d' | '90d';
}

export function OrgActivityChart({ tenantId, timeRange }: OrgActivityChartProps) {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = startOfDay(subDays(new Date(), days));

  const { data: chartData, isLoading } = useQuery({
    queryKey: ['org-activity-chart', tenantId, timeRange],
    queryFn: async (): Promise<{ date: string; fullDate: string; logins: number; actions: number }[]> => {
      if (!tenantId) return [];

      // Get login events with type casting to avoid deep type instantiation
      const { data: loginEvents } = await (supabase as any)
        .from('session_activity_log')
        .select('created_at, event_type')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      // Filter for login events
      const filteredLoginEvents = loginEvents?.filter((e: any) => 
        e.event_type === 'login_success' || e.event_type === 'session_start'
      ) || [];

      // Get activity events
      const { data: activityEvents } = await (supabase as any)
        .from('user_activity_log')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      // Create date buckets
      const dateInterval = eachDayOfInterval({
        start: startDate,
        end: new Date(),
      });

      const loginsByDate = new Map<string, number>();
      const activityByDate = new Map<string, number>();

      filteredLoginEvents.forEach((event: any) => {
        const date = format(new Date(event.created_at), 'yyyy-MM-dd');
        loginsByDate.set(date, (loginsByDate.get(date) || 0) + 1);
      });

      activityEvents?.forEach((event: any) => {
        if (event.created_at) {
          const date = format(new Date(event.created_at), 'yyyy-MM-dd');
          activityByDate.set(date, (activityByDate.get(date) || 0) + 1);
        }
      });

      return dateInterval.map((date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return {
          date: format(date, days <= 7 ? 'EEE' : 'MMM d'),
          fullDate: dateStr,
          logins: loginsByDate.get(dateStr) || 0,
          actions: Math.min((activityByDate.get(dateStr) || 0), 500),
        };
      });
    },
    enabled: !!tenantId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Activity Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Activity Trends
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData || []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="logins"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              name="Logins"
            />
            <Line
              type="monotone"
              dataKey="actions"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              name="Actions"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
