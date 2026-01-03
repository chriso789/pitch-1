/**
 * Admin Activity Dashboard
 * Organization-wide login and activity trends
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfDay, endOfDay, subHours } from 'date-fns';
import { ArrowLeft, Users, Activity, Clock, Shield, TrendingUp, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { OrgActivityOverview } from '@/components/admin/OrgActivityOverview';
import { OrgActivityChart } from '@/components/admin/OrgActivityChart';
import { OrgActivityHeatmap } from '@/components/admin/OrgActivityHeatmap';
import { MostActiveUsers } from '@/components/admin/MostActiveUsers';
import { PeakUsageTimes } from '@/components/admin/PeakUsageTimes';
import { RecentSecurityAlerts } from '@/components/admin/RecentSecurityAlerts';

export default function ActivityDashboardPage() {
  const { profile } = useUserProfile();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');

  const timeRangeLabel = {
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days',
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/settings">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Activity className="h-6 w-6 text-primary" />
                  Activity Dashboard
                </h1>
                <p className="text-muted-foreground text-sm">
                  Organization-wide login and activity monitoring
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Select value={timeRange} onValueChange={(v: '7d' | '30d' | '90d') => setTimeRange(v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Overview Stats */}
        <OrgActivityOverview tenantId={profile?.tenant_id || ''} timeRange={timeRange} />

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <OrgActivityChart tenantId={profile?.tenant_id || ''} timeRange={timeRange} />
          <OrgActivityHeatmap tenantId={profile?.tenant_id || ''} timeRange={timeRange} />
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <MostActiveUsers tenantId={profile?.tenant_id || ''} timeRange={timeRange} />
          <PeakUsageTimes tenantId={profile?.tenant_id || ''} timeRange={timeRange} />
          <RecentSecurityAlerts tenantId={profile?.tenant_id || ''} />
        </div>
      </main>
    </div>
  );
}
