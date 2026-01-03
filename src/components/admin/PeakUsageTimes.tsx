/**
 * Peak Usage Times
 * Bar chart showing activity by hour of day
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, getHours, format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';

interface PeakUsageTimesProps {
  tenantId: string;
  timeRange: '7d' | '30d' | '90d';
}

export function PeakUsageTimes({ tenantId, timeRange }: PeakUsageTimesProps) {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = subDays(new Date(), days).toISOString();

  const { data: hourlyData, isLoading } = useQuery({
    queryKey: ['peak-usage-times', tenantId, timeRange],
    queryFn: async () => {
      if (!tenantId) return [];

      const { data: activities } = await supabase
        .from('user_activity_log')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate)
        .limit(10000);

      // Aggregate by hour
      const hourCounts = Array(24).fill(0);
      activities?.forEach((a) => {
        const hour = getHours(new Date(a.created_at));
        hourCounts[hour]++;
      });

      const maxCount = Math.max(...hourCounts);

      // Format for chart (only show business hours for clarity)
      return hourCounts.slice(6, 22).map((count, i) => ({
        hour: format(new Date().setHours(i + 6, 0, 0, 0), 'ha'),
        count,
        isPeak: count === maxCount && maxCount > 0,
      }));
    },
    enabled: !!tenantId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Peak Usage Times
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const peakHour = hourlyData?.find(h => h.isPeak);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-5 w-5 text-primary" />
          Peak Usage Times
        </CardTitle>
        {peakHour && (
          <p className="text-sm text-muted-foreground">
            Most active: <span className="font-medium text-foreground">{peakHour.hour}</span>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hourlyData || []} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
              formatter={(value: number) => [value, 'Actions']}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {hourlyData?.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isPeak ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                  opacity={entry.isPeak ? 1 : 0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
