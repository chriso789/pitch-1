/**
 * Organization Activity Overview
 * Shows key stats: logins, active users, avg session duration, peak hours
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, startOfDay } from 'date-fns';
import { Users, LogIn, Clock, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface OrgActivityOverviewProps {
  tenantId: string;
  timeRange: '7d' | '30d' | '90d';
}

export function OrgActivityOverview({ tenantId, timeRange }: OrgActivityOverviewProps) {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = startOfDay(subDays(new Date(), days)).toISOString();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['org-activity-overview', tenantId, timeRange],
    queryFn: async () => {
      if (!tenantId) return null;

      // Get login counts
      const { data: loginData } = await (supabase as any)
        .from('session_activity_log')
        .select('id, event_type')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate);
      const totalLogins = loginData?.filter((e: any) => 
        e.event_type === 'login_success' || e.event_type === 'session_start'
      ).length || 0;

      // Get unique active users
      const { data: activeUsersData } = await (supabase as any)
        .from('session_activity_log')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate);
      const uniqueUsers = new Set(activeUsersData?.map((u: any) => u.user_id) || []);

      // Get total actions
      const { data: actionsData } = await (supabase as any)
        .from('user_activity_log')
        .select('id')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate);
      const totalActions = actionsData?.length || 0;

      // Get today's logins
      const today = startOfDay(new Date()).toISOString();
      const { data: todayLoginData } = await (supabase as any)
        .from('session_activity_log')
        .select('id, event_type')
        .eq('tenant_id', tenantId)
        .gte('created_at', today);
      const todayLogins = todayLoginData?.filter((e: any) => 
        e.event_type === 'login_success' || e.event_type === 'session_start'
      ).length || 0;

      return {
        totalLogins,
        uniqueUsers: uniqueUsers.size,
        totalActions,
        todayLogins,
        avgActionsPerUser: uniqueUsers.size > 0 ? Math.round(totalActions / uniqueUsers.size) : 0,
      };
    },
    enabled: !!tenantId,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Logins',
      value: stats?.totalLogins || 0,
      icon: LogIn,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      description: `${stats?.todayLogins || 0} today`,
    },
    {
      title: 'Active Users',
      value: stats?.uniqueUsers || 0,
      icon: Users,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      description: `in last ${days} days`,
    },
    {
      title: 'Total Actions',
      value: stats?.totalActions || 0,
      icon: TrendingUp,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
      description: 'page views, clicks, etc.',
    },
    {
      title: 'Avg Actions/User',
      value: stats?.avgActionsPerUser || 0,
      icon: Clock,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
      description: 'per active user',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat, index) => (
        <Card key={index}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.title}</p>
                <p className="text-3xl font-bold mt-1">{stat.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </div>
              <div className={`p-3 rounded-full ${stat.bgColor}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
