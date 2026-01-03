/**
 * User Login Statistics Component
 * Displays login frequency, activation status, and session history
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  LogIn, 
  Clock, 
  Calendar, 
  TrendingUp,
  CheckCircle,
  AlertCircle,
  CalendarDays
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UserLoginStatsProps {
  userId: string;
}

interface LoginStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  total: number;
  lastLogin: string | null;
  firstLogin: string | null;
  isActivated: boolean;
}

export const UserLoginStats: React.FC<UserLoginStatsProps> = ({ userId }) => {
  // Query for login statistics from session_activity_log
  const { data: stats, isLoading } = useQuery({
    queryKey: ['user-login-stats', userId],
    queryFn: async () => {
      // Get all login events for this user
      const { data: loginEvents, error } = await supabase
        .from('session_activity_log')
        .select('created_at, event_type')
        .eq('user_id', userId)
        .in('event_type', ['login_success', 'session_start', 'session_resumed'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const events = loginEvents || [];
      
      // Calculate stats
      const today = events.filter(e => new Date(e.created_at) >= todayStart).length;
      const thisWeek = events.filter(e => new Date(e.created_at) >= weekStart).length;
      const thisMonth = events.filter(e => new Date(e.created_at) >= monthStart).length;
      const total = events.length;
      
      // First and last login
      const lastLogin = events.length > 0 ? events[0].created_at : null;
      const firstLogin = events.length > 0 ? events[events.length - 1].created_at : null;
      const isActivated = total > 0;

      return {
        today,
        thisWeek,
        thisMonth,
        total,
        lastLogin,
        firstLogin,
        isActivated
      } as LoginStats;
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            Login Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const isNeverLoggedIn = !stats?.isActivated;

  return (
    <Card className={isNeverLoggedIn ? "border-destructive/50 bg-destructive/5" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            Login Statistics
          </CardTitle>
          <Badge 
            variant={stats?.isActivated ? "default" : "destructive"}
            className="flex items-center gap-1"
          >
            {stats?.isActivated ? (
              <>
                <CheckCircle className="h-3 w-3" />
                Activated
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3" />
                Never Logged In
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isNeverLoggedIn ? (
          <div className="text-center py-6">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive/60 mb-3" />
            <p className="text-sm font-medium text-destructive">
              This user has never logged into the system
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Consider resending the invitation email
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Login frequency stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-2xl font-bold text-primary">{stats?.today || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Today</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-2xl font-bold text-blue-600">{stats?.thisWeek || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">This Week</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-2xl font-bold text-green-600">{stats?.thisMonth || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">This Month</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-2xl font-bold text-amber-600">{stats?.total || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Total</div>
              </div>
            </div>

            {/* Last and first login */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Last Login</div>
                  <div className="text-xs text-muted-foreground">
                    {stats?.lastLogin 
                      ? formatDistanceToNow(new Date(stats.lastLogin), { addSuffix: true })
                      : 'Never'
                    }
                  </div>
                  {stats?.lastLogin && (
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(stats.lastLogin), "MMM d, yyyy 'at' h:mm a")}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">First Login</div>
                  <div className="text-xs text-muted-foreground">
                    {stats?.firstLogin 
                      ? format(new Date(stats.firstLogin), "MMM d, yyyy")
                      : 'Never'
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
