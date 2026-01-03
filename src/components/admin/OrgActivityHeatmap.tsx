/**
 * Organization Activity Heatmap
 * Aggregate of all users' activity patterns by day/hour
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, getDay, getHours } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Grid3X3 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface OrgActivityHeatmapProps {
  tenantId: string;
  timeRange: '7d' | '30d' | '90d';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = ['6a', '8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p'];
const HOUR_VALUES = [6, 8, 10, 12, 14, 16, 18, 20, 22];

export function OrgActivityHeatmap({ tenantId, timeRange }: OrgActivityHeatmapProps) {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = subDays(new Date(), days).toISOString();

  const { data: heatmapData, isLoading } = useQuery({
    queryKey: ['org-activity-heatmap', tenantId, timeRange],
    queryFn: async () => {
      if (!tenantId) return null;

      const { data: activities } = await supabase
        .from('user_activity_log')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate)
        .limit(10000);

      // Initialize grid
      const grid: number[][] = Array(7).fill(null).map(() => Array(HOUR_VALUES.length).fill(0));
      let maxCount = 1;

      activities?.forEach((activity) => {
        const date = new Date(activity.created_at);
        const dayOfWeek = getDay(date);
        const hour = getHours(date);
        
        // Find the closest hour bucket
        const hourIndex = HOUR_VALUES.findIndex((h, i) => {
          const nextH = HOUR_VALUES[i + 1] || 24;
          return hour >= h && hour < nextH;
        });
        
        if (hourIndex !== -1) {
          grid[dayOfWeek][hourIndex]++;
          maxCount = Math.max(maxCount, grid[dayOfWeek][hourIndex]);
        }
      });

      return { grid, maxCount };
    },
    enabled: !!tenantId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Activity Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const getIntensityColor = (count: number, maxCount: number): string => {
    if (count === 0) return 'bg-muted';
    const intensity = count / maxCount;
    if (intensity > 0.75) return 'bg-green-500';
    if (intensity > 0.5) return 'bg-green-400';
    if (intensity > 0.25) return 'bg-green-300';
    return 'bg-green-200';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3X3 className="h-5 w-5 text-primary" />
          Activity Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[300px]">
            {/* Hour labels */}
            <div className="flex ml-10 mb-1">
              {HOURS.map((hour) => (
                <div key={hour} className="flex-1 text-center text-xs text-muted-foreground">
                  {hour}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            <TooltipProvider>
              {DAYS.map((day, dayIndex) => (
                <div key={day} className="flex items-center mb-1">
                  <div className="w-10 text-xs text-muted-foreground text-right pr-2">
                    {day}
                  </div>
                  <div className="flex flex-1 gap-1">
                    {HOUR_VALUES.map((_, hourIndex) => {
                      const count = heatmapData?.grid[dayIndex][hourIndex] || 0;
                      return (
                        <Tooltip key={hourIndex}>
                          <TooltipTrigger asChild>
                            <div
                              className={`flex-1 h-6 rounded-sm cursor-pointer transition-opacity hover:opacity-80 ${getIntensityColor(
                                count,
                                heatmapData?.maxCount || 1
                              )}`}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-medium">{day} {HOURS[hourIndex]}</p>
                            <p className="text-sm text-muted-foreground">{count} actions</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              ))}
            </TooltipProvider>

            {/* Legend */}
            <div className="flex items-center justify-end mt-4 gap-2 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="flex gap-1">
                <div className="w-4 h-4 rounded-sm bg-muted" />
                <div className="w-4 h-4 rounded-sm bg-green-200" />
                <div className="w-4 h-4 rounded-sm bg-green-300" />
                <div className="w-4 h-4 rounded-sm bg-green-400" />
                <div className="w-4 h-4 rounded-sm bg-green-500" />
              </div>
              <span>More</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
