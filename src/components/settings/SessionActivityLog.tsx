import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { RefreshCw, Search, LogIn, LogOut, AlertTriangle, Shield, Download, User } from "lucide-react";

interface SessionActivity {
  id: string;
  user_id: string;
  email: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: string | null;
  location_info: string | null;
  success: boolean;
  error_message: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export const SessionActivityLog = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");

  const { data: activities, isLoading, refetch } = useQuery({
    queryKey: ['session-activity-log', eventTypeFilter],
    queryFn: async () => {
      let query = supabase
        .from('session_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (eventTypeFilter && eventTypeFilter !== 'all') {
        query = query.eq('event_type', eventTypeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as SessionActivity[];
    },
  });

  const getEventIcon = (eventType: string, success: boolean) => {
    if (!success) {
      return <AlertTriangle className="h-4 w-4 text-destructive" />;
    }
    switch (eventType) {
      case 'login':
      case 'login_success':
        return <LogIn className="h-4 w-4 text-green-500" />;
      case 'logout':
        return <LogOut className="h-4 w-4 text-muted-foreground" />;
      case 'session_refresh':
        return <RefreshCw className="h-4 w-4 text-blue-500" />;
      case 'password_reset':
        return <Shield className="h-4 w-4 text-amber-500" />;
      default:
        return <User className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEventBadgeVariant = (eventType: string, success: boolean): "default" | "destructive" | "secondary" | "outline" => {
    if (!success) return 'destructive';
    switch (eventType) {
      case 'login':
      case 'login_success':
        return 'default';
      case 'logout':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const filteredActivities = activities?.filter(activity => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      activity.email?.toLowerCase().includes(searchLower) ||
      activity.event_type.toLowerCase().includes(searchLower) ||
      activity.ip_address?.includes(searchQuery)
    );
  });

  const exportToCSV = () => {
    if (!filteredActivities?.length) return;
    
    const headers = ['Timestamp', 'Email', 'Event Type', 'Success', 'IP Address', 'Device Info', 'Error'];
    const rows = filteredActivities.map(a => [
      format(new Date(a.created_at), 'yyyy-MM-dd HH:mm:ss'),
      a.email || 'Unknown',
      a.event_type,
      a.success ? 'Yes' : 'No',
      a.ip_address || '',
      a.device_info || '',
      a.error_message || ''
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-activity-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Session Activity Log
            </CardTitle>
            <CardDescription>
              Track all user login, logout, and authentication events
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email or IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="login">Login</SelectItem>
              <SelectItem value="logout">Logout</SelectItem>
              <SelectItem value="session_refresh">Session Refresh</SelectItem>
              <SelectItem value="password_reset">Password Reset</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Activity List */}
        <ScrollArea className="h-[500px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredActivities?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No activity found matching your filters
            </div>
          ) : (
            <div className="space-y-2">
              {filteredActivities?.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="mt-0.5">
                    {getEventIcon(activity.event_type, activity.success)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {activity.email || 'Unknown User'}
                      </span>
                      <Badge variant={getEventBadgeVariant(activity.event_type, activity.success)} className="text-xs">
                        {activity.event_type.replace(/_/g, ' ')}
                      </Badge>
                      {!activity.success && (
                        <Badge variant="destructive" className="text-xs">
                          Failed
                        </Badge>
                      )}
                    </div>
                    {activity.error_message && (
                      <div className="text-xs text-destructive mt-1">
                        {activity.error_message}
                      </div>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{format(new Date(activity.created_at), 'MMM d, yyyy h:mm a')}</span>
                      {activity.ip_address && <span>IP: {activity.ip_address}</span>}
                      {activity.device_info && <span>{activity.device_info}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
