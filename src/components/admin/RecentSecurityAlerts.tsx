/**
 * Recent Security Alerts
 * List of security-related events for the organization
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, AlertTriangle, MapPin, Wifi, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';

interface RecentSecurityAlertsProps {
  tenantId: string;
}

interface SecurityAlert {
  id: string;
  type: 'new_ip' | 'new_location' | 'vpn_detected' | 'failed_login';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  timestamp: string;
  userId: string;
  userName: string;
  metadata?: {
    ip?: string;
    location?: string;
  };
}

export function RecentSecurityAlerts({ tenantId }: RecentSecurityAlertsProps) {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['recent-security-alerts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      const startDate = subDays(new Date(), 7).toISOString();

      // Get recent sessions with location info
      const { data: sessions } = await supabase
        .from('session_activity_log')
        .select(`
          id,
          user_id,
          ip_address,
          location_info,
          created_at,
          event_type
        `)
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(100);

      // Get user profiles
      const userIds = [...new Set(sessions?.map(s => s.user_id) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      // Track IPs and locations per user to detect new ones
      const userIPs = new Map<string, Set<string>>();
      const userLocations = new Map<string, Set<string>>();

      const alertsList: SecurityAlert[] = [];

      // Process sessions from oldest to newest
      const sortedSessions = [...(sessions || [])].reverse();
      
      sortedSessions.forEach((session) => {
        const userId = session.user_id;
        const ip = session.ip_address || '';
        
        let locationInfo: any = null;
        if (session.location_info) {
          if (typeof session.location_info === 'string') {
            try {
              locationInfo = JSON.parse(session.location_info);
            } catch {}
          } else {
            locationInfo = session.location_info;
          }
        }
        
        const location = locationInfo?.country || '';
        const profile = profileMap.get(userId);
        const userName = profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown User';

        // Initialize tracking
        if (!userIPs.has(userId)) userIPs.set(userId, new Set());
        if (!userLocations.has(userId)) userLocations.set(userId, new Set());

        const knownIPs = userIPs.get(userId)!;
        const knownLocations = userLocations.get(userId)!;

        // Check for new IP
        if (ip && !knownIPs.has(ip) && knownIPs.size > 0) {
          alertsList.push({
            id: `${session.id}-ip`,
            type: 'new_ip',
            severity: 'warning',
            title: 'New IP Address Detected',
            description: `${userName} logged in from a new IP address`,
            timestamp: session.created_at,
            userId,
            userName,
            metadata: {
              ip,
              location: locationInfo?.city ? `${locationInfo.city}, ${locationInfo.country}` : undefined,
            },
          });
        }

        // Check for new country
        if (location && !knownLocations.has(location) && knownLocations.size > 0) {
          alertsList.push({
            id: `${session.id}-location`,
            type: 'new_location',
            severity: 'critical',
            title: 'Login from New Country',
            description: `${userName} logged in from ${location}`,
            timestamp: session.created_at,
            userId,
            userName,
            metadata: {
              location: locationInfo?.city ? `${locationInfo.city}, ${locationInfo.country}` : location,
            },
          });
        }

        // Check for VPN
        if (locationInfo?.is_vpn || locationInfo?.is_proxy) {
          alertsList.push({
            id: `${session.id}-vpn`,
            type: 'vpn_detected',
            severity: 'info',
            title: 'VPN/Proxy Detected',
            description: `${userName} connected via VPN or proxy`,
            timestamp: session.created_at,
            userId,
            userName,
            metadata: { ip },
          });
        }

        // Update known IPs and locations
        if (ip) knownIPs.add(ip);
        if (location) knownLocations.add(location);
      });

      // Return most recent alerts first
      return alertsList.reverse().slice(0, 20);
    },
    enabled: !!tenantId,
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500 text-white';
      case 'warning': return 'bg-yellow-500 text-black';
      default: return 'bg-blue-500 text-white';
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'new_ip': return <Wifi className="h-4 w-4" />;
      case 'new_location': return <MapPin className="h-4 w-4" />;
      case 'vpn_detected': return <Shield className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                <Skeleton className="h-6 w-6 rounded" />
                <div className="flex-1 space-y-2">
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
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-primary" />
            Security Alerts
          </CardTitle>
          {alerts && alerts.length > 0 && (
            <Badge variant="outline">{alerts.length} alerts</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px]">
          {alerts && alerts.length > 0 ? (
            <div className="space-y-2 pr-4">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    alert.severity === 'critical' ? 'border-red-500/50 bg-red-500/5' :
                    alert.severity === 'warning' ? 'border-yellow-500/50 bg-yellow-500/5' :
                    'border-border'
                  }`}
                >
                  <div className={`p-1.5 rounded ${getSeverityColor(alert.severity)}`}>
                    {getAlertIcon(alert.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{alert.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {alert.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}</span>
                      {alert.metadata?.ip && (
                        <>
                          <span>•</span>
                          <span className="font-mono">{alert.metadata.ip}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-10 w-10 mx-auto mb-2 opacity-50 text-green-500" />
              <p className="font-medium">No Security Alerts</p>
              <p className="text-sm">All login activity looks normal</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
