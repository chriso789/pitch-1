import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Download, Search, User, MousePointer, FileText, Database, Keyboard, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';

interface ActivityLog {
  id: string;
  user_id: string;
  action_type: string;
  action_category: string;
  action_details: any;
  page_url: string;
  session_id: string;
  ip_address: string;
  created_at: string;
  user_name?: string;
}

interface UserStats {
  user_id: string;
  user_name: string;
  total_actions: number;
  keystroke_batches: number;
  page_views: number;
  last_active: string;
}

export const ActivityDashboard = () => {
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState('7d');
  const { toast } = useToast();

  useEffect(() => {
    fetchActivities();
    fetchUserStats();
  }, [selectedType, dateRange]);

  const getDateFilter = () => {
    const now = new Date();
    switch (dateRange) {
      case '1d': return new Date(now.setDate(now.getDate() - 1)).toISOString();
      case '7d': return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case '30d': return new Date(now.setDate(now.getDate() - 30)).toISOString();
      default: return new Date(now.setDate(now.getDate() - 7)).toISOString();
    }
  };

  const fetchActivities = async () => {
    try {
      // Use any to bypass type checking for new table
      let query = (supabase as any)
        .from('user_activity_log')
        .select('*')
        .gte('created_at', getDateFilter())
        .order('created_at', { ascending: false })
        .limit(500);

      if (selectedType !== 'all') {
        query = query.eq('action_type', selectedType);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch user names
      const userIds = [...new Set((data || []).map((a: any) => a.user_id))] as string[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']) || []);

      setActivities((data || []).map((a: any) => ({
        ...a,
        user_name: profileMap.get(a.user_id) || 'Unknown User'
      })));
    } catch (error: any) {
      toast({
        title: "Error Loading Activity",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchUserStats = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('user_activity_log')
        .select('user_id, action_type, created_at')
        .gte('created_at', getDateFilter());

      if (error) throw error;

      // Aggregate stats per user
      const statsMap = new Map<string, { 
        total: number; 
        keystrokes: number; 
        pageViews: number; 
        lastActive: string;
      }>();

      (data || []).forEach((log: any) => {
        const current = statsMap.get(log.user_id) || { 
          total: 0, keystrokes: 0, pageViews: 0, lastActive: log.created_at 
        };
        current.total++;
        if (log.action_type === 'keystroke_batch') current.keystrokes++;
        if (log.action_type === 'page_view') current.pageViews++;
        if (log.created_at > current.lastActive) current.lastActive = log.created_at;
        statsMap.set(log.user_id, current);
      });

      // Fetch user names
      const userIds = [...statsMap.keys()];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']) || []);

      const stats: UserStats[] = Array.from(statsMap.entries()).map(([userId, s]) => ({
        user_id: userId,
        user_name: profileMap.get(userId) || 'Unknown User',
        total_actions: s.total,
        keystroke_batches: s.keystrokes,
        page_views: s.pageViews,
        last_active: s.lastActive,
      }));

      setUserStats(stats.sort((a, b) => b.total_actions - a.total_actions));
    } catch (error: any) {
      console.error('Error fetching user stats:', error);
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'page_view': return <Eye className="h-4 w-4 text-blue-500" />;
      case 'button_click': return <MousePointer className="h-4 w-4 text-green-500" />;
      case 'form_submit': return <FileText className="h-4 w-4 text-purple-500" />;
      case 'data_change': return <Database className="h-4 w-4 text-orange-500" />;
      case 'keystroke_batch': return <Keyboard className="h-4 w-4 text-gray-500" />;
      default: return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'User', 'Action Type', 'Category', 'Page', 'Details', 'IP Address'];
    const rows = activities.map(a => [
      a.created_at,
      a.user_name,
      a.action_type,
      a.action_category,
      a.page_url,
      JSON.stringify(a.action_details),
      a.ip_address
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: "Export Complete", description: "Activity log downloaded" });
  };

  const filteredActivities = activities.filter(a => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      a.user_name?.toLowerCase().includes(searchLower) ||
      a.action_type.toLowerCase().includes(searchLower) ||
      a.page_url?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Activity Monitoring</h3>
          <p className="text-sm text-muted-foreground">
            Track user actions and system activity across the platform
          </p>
        </div>
        <Button variant="outline" onClick={exportToCSV}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by user, action, page..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="w-[150px]">
              <Label className="text-xs text-muted-foreground">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[150px]">
              <Label className="text-xs text-muted-foreground">Action Type</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="page_view">Page Views</SelectItem>
                  <SelectItem value="button_click">Clicks</SelectItem>
                  <SelectItem value="form_submit">Form Submits</SelectItem>
                  <SelectItem value="data_change">Data Changes</SelectItem>
                  <SelectItem value="keystroke_batch">Keystrokes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="activity" className="space-y-4">
        <TabsList>
          <TabsTrigger value="activity">
            <Activity className="h-4 w-4 mr-2" />
            Activity Feed
          </TabsTrigger>
          <TabsTrigger value="users">
            <User className="h-4 w-4 mr-2" />
            User Stats
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Activity</CardTitle>
                <Badge variant="secondary">{filteredActivities.length} events</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {filteredActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      {getActionIcon(activity.action_type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{activity.user_name}</span>
                          <Badge variant="outline" className="text-xs">
                            {activity.action_type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {activity.page_url || 'No page'}
                          {activity.action_details?.keystroke_count && (
                            <span className="ml-2">
                              ({activity.action_details.keystroke_count} keystrokes)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  ))}
                  {filteredActivities.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No activity found for the selected filters
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {userStats.map((user) => (
              <Card key={user.user_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{user.user_name}</CardTitle>
                      <CardDescription className="text-xs">
                        Last active {formatDistanceToNow(new Date(user.last_active), { addSuffix: true })}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-2xl font-bold">{user.total_actions}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{user.page_views}</p>
                      <p className="text-xs text-muted-foreground">Views</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{user.keystroke_batches}</p>
                      <p className="text-xs text-muted-foreground">Sessions</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {userStats.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No user activity data available
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Disclosure Notice */}
      <Card className="bg-muted/30">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span>
              Activity monitoring is enabled for security and compliance purposes. 
              Users are notified of activity tracking in the application footer.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
