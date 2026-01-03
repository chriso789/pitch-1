/**
 * User Activity Heatmap Component
 * Visual representation of user activity patterns by day and hour
 */

import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Flame } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface UserActivityHeatmapProps {
  userId: string;
}

interface HeatmapCell {
  day: number;
  hour: number;
  count: number;
  intensity: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

const formatHour = (hour: number): string => {
  if (hour === 0 || hour === 12) return "12";
  if (hour < 12) return `${hour}`;
  return `${hour - 12}`;
};

const getHourLabel = (hour: number): string => {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${formatHour(hour)} ${suffix}`;
};

export const UserActivityHeatmap: React.FC<UserActivityHeatmapProps> = ({ userId }) => {
  const [timeRange, setTimeRange] = React.useState<"7" | "30" | "90">("30");

  const { data: activityData, isLoading } = useQuery({
    queryKey: ["user-activity-heatmap", userId, timeRange],
    queryFn: async () => {
      const daysAgo = parseInt(timeRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      const { data, error } = await supabase
        .from("user_activity_log")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const heatmapData = useMemo(() => {
    if (!activityData) return [];

    // Initialize counts for all day-hour combinations
    const counts: Record<string, number> = {};
    DAYS.forEach((_, dayIndex) => {
      HOURS.forEach((hour) => {
        counts[`${dayIndex}-${hour}`] = 0;
      });
    });

    // Count activities by day and hour
    activityData.forEach((activity) => {
      const date = new Date(activity.created_at);
      const day = date.getDay();
      const hour = date.getHours();
      if (hour >= 6 && hour <= 21) {
        counts[`${day}-${hour}`] = (counts[`${day}-${hour}`] || 0) + 1;
      }
    });

    // Find max count for intensity calculation
    const maxCount = Math.max(...Object.values(counts), 1);

    // Build heatmap cells
    const cells: HeatmapCell[] = [];
    DAYS.forEach((_, dayIndex) => {
      HOURS.forEach((hour) => {
        const count = counts[`${dayIndex}-${hour}`] || 0;
        cells.push({
          day: dayIndex,
          hour,
          count,
          intensity: count / maxCount,
        });
      });
    });

    return cells;
  }, [activityData]);

  const getIntensityColor = (intensity: number): string => {
    if (intensity === 0) return "bg-muted";
    if (intensity < 0.25) return "bg-primary/20";
    if (intensity < 0.5) return "bg-primary/40";
    if (intensity < 0.75) return "bg-primary/60";
    return "bg-primary";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            Activity Patterns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const totalActivity = activityData?.length || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-5 w-5 text-primary" />
            Activity Patterns
          </CardTitle>
          <Select value={timeRange} onValueChange={(v: "7" | "30" | "90") => setTimeRange(v)}>
            <SelectTrigger className="w-[130px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          {totalActivity} actions in the last {timeRange} days
        </p>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="overflow-x-auto">
            <div className="min-w-[400px]">
              {/* Header row with hours */}
              <div className="flex mb-1">
                <div className="w-10 flex-shrink-0" /> {/* Spacer for day labels */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="flex-1 text-center text-xs text-muted-foreground min-w-[24px]"
                  >
                    {hour % 3 === 0 ? getHourLabel(hour) : ""}
                  </div>
                ))}
              </div>

              {/* Rows for each day */}
              {DAYS.map((day, dayIndex) => (
                <div key={day} className="flex items-center mb-1">
                  <div className="w-10 flex-shrink-0 text-xs text-muted-foreground font-medium">
                    {day}
                  </div>
                  {HOURS.map((hour) => {
                    const cell = heatmapData.find(
                      (c) => c.day === dayIndex && c.hour === hour
                    );
                    const count = cell?.count || 0;
                    const intensity = cell?.intensity || 0;

                    return (
                      <Tooltip key={`${dayIndex}-${hour}`}>
                        <TooltipTrigger asChild>
                          <div
                            className={`flex-1 min-w-[24px] h-6 mx-0.5 rounded-sm transition-colors cursor-default ${getIntensityColor(
                              intensity
                            )}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-medium">
                            {day} {getHourLabel(hour)}
                          </p>
                          <p>{count} actions</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}

              {/* Legend */}
              <div className="flex items-center justify-end gap-2 mt-4 text-xs text-muted-foreground">
                <span>Less</span>
                <div className="flex gap-0.5">
                  <div className="w-4 h-4 rounded-sm bg-muted" />
                  <div className="w-4 h-4 rounded-sm bg-primary/20" />
                  <div className="w-4 h-4 rounded-sm bg-primary/40" />
                  <div className="w-4 h-4 rounded-sm bg-primary/60" />
                  <div className="w-4 h-4 rounded-sm bg-primary" />
                </div>
                <span>More</span>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
};
