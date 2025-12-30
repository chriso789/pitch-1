import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Eye, 
  MousePointerClick, 
  Keyboard, 
  Database, 
  Search, 
  LogIn, 
  LogOut,
  ChevronDown,
  Filter
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

interface UserActivityTimelineProps {
  userId: string;
  limit?: number;
}

interface ActivityEvent {
  id: string;
  action_type: string;
  action_category: string;
  action_details: Record<string, any>;
  page_url: string;
  created_at: string;
  session_id: string;
}

const getActivityIcon = (actionType: string) => {
  switch (actionType) {
    case 'page_view':
      return Eye;
    case 'button_click':
      return MousePointerClick;
    case 'keystroke_batch':
      return Keyboard;
    case 'data_change':
      return Database;
    case 'search':
      return Search;
    case 'login_success':
      return LogIn;
    case 'logout':
      return LogOut;
    default:
      return Eye;
  }
};

const getActivityColor = (actionType: string) => {
  switch (actionType) {
    case 'page_view':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'button_click':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    case 'keystroke_batch':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'data_change':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'search':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const formatActivityDetails = (event: ActivityEvent): string => {
  const details = event.action_details || {};
  
  switch (event.action_type) {
    case 'page_view':
      return details.page_name || event.page_url || 'Unknown page';
    case 'button_click':
      return details.element_id || 'Button clicked';
    case 'keystroke_batch':
      return `${details.keystroke_count || 0} keystrokes`;
    case 'data_change':
      return `${details.operation || 'Modified'} ${details.table || 'record'}`;
    case 'search':
      return `Searched (${details.results_count || 0} results)`;
    default:
      return event.action_type.replace(/_/g, ' ');
  }
};

export const UserActivityTimeline: React.FC<UserActivityTimelineProps> = ({
  userId,
  limit = 50
}) => {
  const [filter, setFilter] = useState<string>("all");
  const [displayLimit, setDisplayLimit] = useState(limit);

  const { data: activities, isLoading } = useQuery({
    queryKey: ['user-activity-timeline', userId, displayLimit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_activity_log')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(displayLimit);

      if (error) throw error;
      return data as ActivityEvent[];
    }
  });

  const filteredActivities = activities?.filter(activity => 
    filter === 'all' || activity.action_type === filter
  ) || [];

  const actionTypes = [...new Set(activities?.map(a => a.action_type) || [])];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
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
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Activity Timeline</CardTitle>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[140px] h-8">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Activity</SelectItem>
              {actionTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filteredActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No activity recorded yet
          </p>
        ) : (
          <>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {filteredActivities.map((event, idx) => {
                  const Icon = getActivityIcon(event.action_type);
                  const colorClass = getActivityColor(event.action_type);
                  
                  return (
                    <div key={event.id} className="flex items-start gap-3">
                      <div className={`p-2 rounded-full ${colorClass}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {formatActivityDetails(event)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                          </span>
                          {event.page_url && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              • {event.page_url}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            
            {activities && activities.length >= displayLimit && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-4"
                onClick={() => setDisplayLimit(prev => prev + 50)}
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
