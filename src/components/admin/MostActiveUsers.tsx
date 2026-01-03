/**
 * Most Active Users
 * Ranked table of users by activity count
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Trophy, Activity } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MostActiveUsersProps {
  tenantId: string;
  timeRange: '7d' | '30d' | '90d';
}

export function MostActiveUsers({ tenantId, timeRange }: MostActiveUsersProps) {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = subDays(new Date(), days).toISOString();

  const { data: users, isLoading } = useQuery({
    queryKey: ['most-active-users', tenantId, timeRange],
    queryFn: async () => {
      if (!tenantId) return [];

      // Get activity counts by user
      const { data: activities } = await supabase
        .from('user_activity_log')
        .select('user_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate);

      // Aggregate by user
      const userActivity = new Map<string, { count: number; lastActive: string }>();
      activities?.forEach((a) => {
        const existing = userActivity.get(a.user_id);
        if (existing) {
          existing.count++;
          if (a.created_at > existing.lastActive) {
            existing.lastActive = a.created_at;
          }
        } else {
          userActivity.set(a.user_id, { count: 1, lastActive: a.created_at });
        }
      });

      // Get user profiles
      const userIds = Array.from(userActivity.keys());
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url, role')
        .in('id', userIds);

      // Combine and sort
      const combined = profiles?.map((profile) => ({
        ...profile,
        actionCount: userActivity.get(profile.id)?.count || 0,
        lastActive: userActivity.get(profile.id)?.lastActive || '',
      })) || [];

      return combined.sort((a, b) => b.actionCount - a.actionCount).slice(0, 10);
    },
    enabled: !!tenantId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Most Active Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-5 w-5 text-primary" />
          Most Active Users
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px]">
          {users && users.length > 0 ? (
            <div className="space-y-3">
              {users.map((user, index) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {/* Rank Badge */}
                  <div className="w-6 text-center">
                    {index === 0 ? (
                      <span className="text-lg">🥇</span>
                    ) : index === 1 ? (
                      <span className="text-lg">🥈</span>
                    ) : index === 2 ? (
                      <span className="text-lg">🥉</span>
                    ) : (
                      <span className="text-sm text-muted-foreground font-medium">
                        {index + 1}
                      </span>
                    )}
                  </div>

                  {/* Avatar */}
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="text-xs">
                      {user.first_name?.[0] || ''}
                      {user.last_name?.[0] || ''}
                    </AvatarFallback>
                  </Avatar>

                  {/* Name & Role */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {user.first_name} {user.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.lastActive && formatDistanceToNow(new Date(user.lastActive), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Activity Count */}
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    {user.actionCount}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No activity data available</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
