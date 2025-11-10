import { useState, useEffect } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PerformanceCharts } from "@/components/storm-canvass/PerformanceCharts";
import { ActivityFeed } from "@/components/storm-canvass/ActivityFeed";
import { Button } from "@/components/ui/button";
import { useStormCanvass } from "@/hooks/useStormCanvass";
import { DoorOpen, UserPlus, TrendingUp, Camera, RefreshCw, Map, FileText } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

type DateRangePreset = 'today' | 'week' | 'month' | 'last30';

export default function CanvasserDashboard() {
  const navigate = useNavigate();
  const { getActivities, getDetailedStats, loading } = useStormCanvass();
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('today');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm:ss"),
    end: format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm:ss")
  });
  const [stats, setStats] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const updateDateRange = (preset: DateRangePreset) => {
    setDateRangePreset(preset);
    let start: Date, end: Date;

    switch (preset) {
      case 'today':
        start = startOfDay(new Date());
        end = endOfDay(new Date());
        break;
      case 'week':
        start = startOfWeek(new Date());
        end = endOfWeek(new Date());
        break;
      case 'month':
        start = startOfMonth(new Date());
        end = endOfMonth(new Date());
        break;
      case 'last30':
        start = startOfDay(subDays(new Date(), 30));
        end = endOfDay(new Date());
        break;
    }

    setDateRange({
      start: format(start, "yyyy-MM-dd'T'HH:mm:ss"),
      end: format(end, "yyyy-MM-dd'T'HH:mm:ss")
    });
  };

  const loadDashboardData = async () => {
    try {
      const [detailedStats, activityData] = await Promise.all([
        getDetailedStats(undefined, dateRange),
        getActivities({ startDate: dateRange.start, endDate: dateRange.end })
      ]);
      
      setStats(detailedStats);
      setActivities(activityData.slice(0, 50)); // Limit to 50 most recent
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast.error('Failed to load dashboard data');
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [dateRange]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadDashboardData();
    }, 30000);

    return () => clearInterval(interval);
  }, [dateRange]);

  const getConversionVariant = (rate: string) => {
    const rateNum = parseFloat(rate);
    if (rateNum < 10) return 'danger';
    if (rateNum < 15) return 'warning';
    return 'default';
  };

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Canvasser Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Track your performance and activity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-2">
              <Button
                variant={dateRangePreset === 'today' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateDateRange('today')}
              >
                Today
              </Button>
              <Button
                variant={dateRangePreset === 'week' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateDateRange('week')}
              >
                This Week
              </Button>
              <Button
                variant={dateRangePreset === 'month' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateDateRange('month')}
              >
                This Month
              </Button>
              <Button
                variant={dateRangePreset === 'last30' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateDateRange('last30')}
              >
                Last 30 Days
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDashboardData}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Last Updated */}
        <p className="text-xs text-muted-foreground">
          Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>

        {/* Performance Stats Cards */}
        {loading && !stats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Doors Knocked"
              count={stats.doorsKnocked}
              icon={DoorOpen}
              variant="default"
            />
            <MetricCard
              title="Leads Generated"
              count={stats.leadsGenerated}
              icon={UserPlus}
              variant="default"
            />
            <MetricCard
              title="Conversion Rate"
              count={parseFloat(stats.conversionRate)}
              icon={TrendingUp}
              variant={getConversionVariant(stats.conversionRate)}
            />
            <MetricCard
              title="Photos Uploaded"
              count={stats.photosUploaded}
              icon={Camera}
              variant="default"
            />
          </div>
        ) : null}

        {/* Additional Metrics */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-4 text-center">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats.avgDoorsPerDay}</p>
              <p className="text-sm text-muted-foreground">Avg Doors/Day</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats.activeDays}</p>
              <p className="text-sm text-muted-foreground">Active Days</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats.bestDayDoors}</p>
              <p className="text-sm text-muted-foreground">Best Day</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium text-foreground">{stats.bestDayDate}</p>
              <p className="text-sm text-muted-foreground">Best Day Date</p>
            </div>
          </div>
        )}

        {/* Performance Charts */}
        {loading && !stats ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[400px]" />
            <Skeleton className="h-[400px]" />
          </div>
        ) : stats ? (
          <PerformanceCharts
            dailyActivityData={stats.dailyActivityData}
            dispositionBreakdown={stats.dispositionBreakdown}
          />
        ) : null}

        {/* Activity Feed */}
        {loading && activities.length === 0 ? (
          <Skeleton className="h-[600px]" />
        ) : (
          <ActivityFeed activities={activities} />
        )}

        {/* Quick Actions */}
        <div className="fixed bottom-6 right-6 flex flex-col gap-2">
          <Button
            size="lg"
            onClick={() => navigate('/storm-canvass/map')}
            className="shadow-lg"
          >
            <Map className="h-4 w-4 mr-2" />
            View Map
          </Button>
        </div>
      </div>
    </GlobalLayout>
  );
}

function formatDistanceToNow(date: Date, options: { addSuffix: boolean }) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return options.addSuffix ? `${seconds} seconds ago` : `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return options.addSuffix ? `${minutes} minutes ago` : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return options.addSuffix ? `${hours} hours ago` : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return options.addSuffix ? `${days} days ago` : `${days} days`;
}
