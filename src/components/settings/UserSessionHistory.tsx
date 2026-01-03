/**
 * User Session History Component
 * Displays all sessions with device info, duration, and activity counts
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Monitor, 
  Smartphone, 
  Clock,
  ChevronDown,
  Globe,
  Activity
} from "lucide-react";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UserSessionHistoryProps {
  userId: string;
  limit?: number;
}

interface SessionData {
  id: string;
  created_at: string;
  event_type: string;
  device_info: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

interface ProcessedSession {
  session_id: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  device: string;
  browser: string;
  ipAddress: string | null;
  activityCount: number;
}

export const UserSessionHistory: React.FC<UserSessionHistoryProps> = ({ 
  userId, 
  limit = 20 
}) => {
  const [displayLimit, setDisplayLimit] = useState(limit);

  // Query session activity logs
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['user-session-history', userId, displayLimit],
    queryFn: async () => {
      // Get session events - session_activity_log doesn't have session_id, each row is a session event
      const { data: sessionEvents, error } = await supabase
        .from('session_activity_log')
        .select('id, created_at, event_type, device_info, ip_address, user_agent')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(displayLimit);

      if (error) throw error;

      // Get activity counts per session from user_activity_log
      const { data: activityCounts, error: activityError } = await supabase
        .from('user_activity_log')
        .select('session_id')
        .eq('user_id', userId);

      if (activityError) throw activityError;

      // Count activities per session
      const activityBySession: Record<string, number> = {};
      activityCounts?.forEach(item => {
        if (item.session_id) {
          activityBySession[item.session_id] = (activityBySession[item.session_id] || 0) + 1;
        }
      });

      // Process each login event as a session
      const processedSessions: ProcessedSession[] = (sessionEvents || []).map(event => {
        const userAgent = event.user_agent || '';
        
        let device = 'Desktop';
        let browser = 'Unknown';
        
        if (userAgent) {
          // Simple device detection
          if (/Mobile|Android|iPhone|iPad/i.test(userAgent)) {
            device = 'Mobile';
          }
          
          // Simple browser detection
          if (userAgent.includes('Chrome')) browser = 'Chrome';
          else if (userAgent.includes('Firefox')) browser = 'Firefox';
          else if (userAgent.includes('Safari')) browser = 'Safari';
          else if (userAgent.includes('Edge')) browser = 'Edge';
        }

        return {
          session_id: event.id,
          startTime: event.created_at,
          endTime: null,
          duration: null,
          device,
          browser,
          ipAddress: event.ip_address || null,
          activityCount: activityBySession[event.id] || 0
        };
      });

      return processedSessions.slice(0, displayLimit);
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Session History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const DeviceIcon = ({ device }: { device: string }) => {
    return device === 'Mobile' 
      ? <Smartphone className="h-4 w-4" />
      : <Monitor className="h-4 w-4" />;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Session History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!sessions || sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No session history found
          </p>
        ) : (
          <>
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {sessions.map((session, idx) => (
                  <div 
                    key={session.session_id} 
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-muted">
                        <DeviceIcon device={session.device} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {session.browser} on {session.device}
                          </span>
                          {idx === 0 && (
                            <Badge variant="secondary" className="text-xs">Latest</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(session.startTime), { addSuffix: true })}
                          {' • '}
                          {format(new Date(session.startTime), "MMM d, h:mm a")}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-right">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Activity className="h-3 w-3" />
                        {session.activityCount} actions
                      </div>
                      {session.duration !== null && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {session.duration < 60 
                            ? `${session.duration}m`
                            : `${Math.floor(session.duration / 60)}h ${session.duration % 60}m`
                          }
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            {sessions.length >= displayLimit && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-4"
                onClick={() => setDisplayLimit(prev => prev + 20)}
              >
                <ChevronDown className="h-4 w-4 mr-1" />
                Load More
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
