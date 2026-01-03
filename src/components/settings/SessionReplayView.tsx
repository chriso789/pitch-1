/**
 * Session Replay View
 * Shows detailed timeline of all pages and actions in a user session
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Eye,
  MousePointer,
  FileText,
  ArrowRight,
  Clock,
  Globe,
  ChevronRight,
  Keyboard,
} from 'lucide-react';
import { SessionBreadcrumbs } from './SessionBreadcrumbs';

interface SessionReplayViewProps {
  sessionId: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ActivityEvent {
  id: string;
  action_type: string;
  page_url: string | null;
  action_details: any;
  action_category: string | null;
  created_at: string;
}

const getActivityIcon = (type: string) => {
  switch (type) {
    case 'page_view': return <Eye className="h-4 w-4" />;
    case 'button_click': return <MousePointer className="h-4 w-4" />;
    case 'keystroke_batch': return <Keyboard className="h-4 w-4" />;
    case 'data_change': return <FileText className="h-4 w-4" />;
    default: return <Globe className="h-4 w-4" />;
  }
};

const getActivityLabel = (type: string) => {
  switch (type) {
    case 'page_view': return 'Page View';
    case 'button_click': return 'Click';
    case 'keystroke_batch': return 'Typing';
    case 'data_change': return 'Data Change';
    default: return type;
  }
};

const getActivityColor = (type: string) => {
  switch (type) {
    case 'page_view': return 'bg-blue-500/10 text-blue-500';
    case 'button_click': return 'bg-green-500/10 text-green-500';
    case 'keystroke_batch': return 'bg-purple-500/10 text-purple-500';
    case 'data_change': return 'bg-orange-500/10 text-orange-500';
    default: return 'bg-muted text-muted-foreground';
  }
};

export function SessionReplayView({
  sessionId,
  userId,
  open,
  onOpenChange,
}: SessionReplayViewProps) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ['session-replay', sessionId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_activity_log')
        .select('id, action_type, page_url, action_details, action_category, created_at')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as ActivityEvent[];
    },
    enabled: open && !!sessionId,
  });

  // Extract unique page paths for breadcrumbs
  const pagePaths = activities
    ?.filter(a => a.action_type === 'page_view' && a.page_url)
    .map(a => a.page_url!)
    .filter((path, index, self) => self.indexOf(path) === index) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Session Replay
          </DialogTitle>
        </DialogHeader>

        {/* Page Flow Breadcrumbs */}
        {pagePaths.length > 0 && (
          <SessionBreadcrumbs paths={pagePaths} />
        )}

        {/* Activity Timeline */}
        <ScrollArea className="flex-1 mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                  <Skeleton className="h-8 w-8 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-border" />

              <div className="space-y-3 pr-4">
                {activities.map((activity, index) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 relative"
                  >
                    {/* Icon */}
                    <div className={`z-10 p-2 rounded-full border bg-background ${getActivityColor(activity.action_type)}`}>
                      {getActivityIcon(activity.action_type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 bg-card rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {getActivityLabel(activity.action_type)}
                          </Badge>
                          {activity.page_url && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {activity.page_url}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(activity.created_at), 'h:mm:ss a')}
                        </span>
                      </div>

                      {/* Details based on activity type */}
                      {activity.action_type === 'button_click' && activity.action_details?.element_text && (
                        <p className="text-sm mt-1 text-muted-foreground">
                          Clicked: <span className="font-medium text-foreground">"{activity.action_details.element_text}"</span>
                          {activity.action_details?.element_id && (
                            <span className="text-xs font-mono ml-2">#{activity.action_details.element_id}</span>
                          )}
                        </p>
                      )}

                      {activity.action_type === 'keystroke_batch' && activity.action_details && (
                        <p className="text-sm mt-1 text-muted-foreground">
                          Typed {activity.action_details.keystroke_count || 0} characters
                        </p>
                      )}

                      {activity.action_type === 'data_change' && activity.action_details && (
                        <p className="text-sm mt-1 text-muted-foreground">
                          Changed: {activity.action_details.table || 'record'}
                          {activity.action_details.action && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {activity.action_details.action}
                            </Badge>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Eye className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No activity recorded for this session</p>
            </div>
          )}
        </ScrollArea>

        {/* Footer with stats */}
        {activities && activities.length > 0 && (
          <div className="flex items-center justify-between pt-4 border-t text-sm text-muted-foreground">
            <span>{activities.length} events recorded</span>
            <span>
              Duration: {activities.length > 1 
                ? formatDistanceToNow(new Date(activities[0].created_at), { includeSeconds: true })
                  .replace(' ago', '')
                : '< 1 min'}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}