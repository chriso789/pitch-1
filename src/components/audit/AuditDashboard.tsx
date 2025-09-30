import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  TrendingUp, Users, AlertTriangle, Activity, Shield, MapPin 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from 'date-fns';

export const AuditDashboard = () => {
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalChanges: 0,
    activeUsers: 0,
    suspiciousActivity: 0
  });

  useEffect(() => {
    fetchAuditData();
  }, []);

  const fetchAuditData = async () => {
    try {
      // Fetch recent activity
      const { data: activity } = await supabase
        .from('audit_log')
        .select(`
          *,
          changed_by_profile:profiles!audit_log_changed_by_fkey(
            first_name,
            last_name
          )
        `)
        .order('changed_at', { ascending: false })
        .limit(20);

      setRecentActivity(activity || []);

      // Calculate stats
      const { count: totalChanges } = await supabase
        .from('audit_log')
        .select('*', { count: 'exact', head: true })
        .gte('changed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const { data: uniqueUsers } = await supabase
        .from('audit_log')
        .select('changed_by')
        .gte('changed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const activeUsers = new Set(uniqueUsers?.map(u => u.changed_by)).size;

      // Detect suspicious activity (multiple deletes, unusual locations, etc.)
      const { count: suspiciousActivity } = await supabase
        .from('audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('action', 'DELETE')
        .gte('changed_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

      setStats({
        totalChanges: totalChanges || 0,
        activeUsers,
        suspiciousActivity: suspiciousActivity || 0
      });

    } catch (error) {
      console.error('Error fetching audit data:', error);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'INSERT': return 'bg-success text-success-foreground';
      case 'UPDATE': return 'bg-warning text-warning-foreground';
      case 'DELETE': return 'bg-destructive text-destructive-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Changes (24h)</p>
                <p className="text-3xl font-bold">{stats.totalChanges}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Users</p>
                <p className="text-3xl font-bold">{stats.activeUsers}</p>
              </div>
              <Users className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Suspicious Activity</p>
                <p className="text-3xl font-bold">{stats.suspiciousActivity}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Real-time Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-3">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 p-3 border rounded-lg">
                  <Badge className={getActionColor(entry.action)}>
                    {entry.action}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">
                        {entry.changed_by_profile 
                          ? `${entry.changed_by_profile.first_name} ${entry.changed_by_profile.last_name}`
                          : 'Unknown User'
                        }
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.changed_at), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {entry.action} on <strong>{entry.table_name}</strong>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                      {entry.ip_address && (
                        <span className="font-mono">{entry.ip_address}</span>
                      )}
                      {entry.location_data?.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {entry.location_data.address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};