/**
 * Security Alerts Component
 * Displays security-related alerts for user sessions (new IPs, unusual activity)
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertTriangle, Globe, MapPin, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SecurityAlertsProps {
  userId: string;
}

interface SecurityAlert {
  id: string;
  type: "new_ip" | "new_location" | "vpn_detected" | "unusual_time";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  timestamp: string;
  metadata: {
    ip_address?: string;
    location?: string;
    device?: string;
  };
}

export const SecurityAlerts: React.FC<SecurityAlertsProps> = ({ userId }) => {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["user-security-alerts", userId],
    queryFn: async () => {
      // Get all session logs for this user
      const { data: sessions, error } = await supabase
        .from("session_activity_log")
        .select("id, ip_address, location_info, device_info, user_agent, created_at, event_type")
        .eq("user_id", userId)
        .eq("event_type", "session_start")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Analyze sessions for security alerts
      const alertsList: SecurityAlert[] = [];
      const knownIPs = new Set<string>();
      const knownLocations = new Set<string>();

      // Process sessions from oldest to newest to track first occurrences
      const sortedSessions = [...(sessions || [])].reverse();

      sortedSessions.forEach((session, index) => {
        const ip = session.ip_address || "Unknown";
        const location = session.location_info
          ? typeof session.location_info === "object"
            ? (session.location_info as Record<string, unknown>).city || "Unknown"
            : "Unknown"
          : "Unknown";

        // Check for new IP (first occurrence after the initial session)
        if (index > 0 && !knownIPs.has(ip) && ip !== "Unknown") {
          alertsList.push({
            id: `new-ip-${session.id}`,
            type: "new_ip",
            severity: "warning",
            title: "New IP Address Detected",
            description: `First login from IP address ${ip}`,
            timestamp: session.created_at,
            metadata: {
              ip_address: ip,
              device: session.user_agent || undefined,
            },
          });
        }

        // Check for new location
        if (
          index > 0 &&
          !knownLocations.has(String(location)) &&
          location !== "Unknown"
        ) {
          alertsList.push({
            id: `new-location-${session.id}`,
            type: "new_location",
            severity: "info",
            title: "New Location Detected",
            description: `First login from ${location}`,
            timestamp: session.created_at,
            metadata: {
              location: String(location),
              ip_address: ip,
            },
          });
        }

        knownIPs.add(ip);
        if (location !== "Unknown") {
          knownLocations.add(String(location));
        }
      });

      // Return alerts sorted by most recent first
      return alertsList.reverse().slice(0, 10);
    },
    staleTime: 5 * 60 * 1000,
  });

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
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSeverityIcon = (severity: SecurityAlert["severity"]) => {
    switch (severity) {
      case "critical":
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Globe className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBadge = (severity: SecurityAlert["severity"]) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "warning":
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">
            Warning
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
            Info
          </Badge>
        );
    }
  };

  if (!alerts || alerts.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-primary" />
            Security Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle className="h-10 w-10 text-green-500 mb-2" />
            <p className="font-medium text-green-600">No Security Concerns</p>
            <p className="text-sm text-muted-foreground mt-1">
              All login activity appears normal
            </p>
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
          <Badge variant="outline">{alerts.length} alerts</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card"
              >
                <div className="mt-0.5">{getSeverityIcon(alert.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm truncate">{alert.title}</p>
                    {getSeverityBadge(alert.severity)}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {alert.description}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>
                      {formatDistanceToNow(new Date(alert.timestamp), {
                        addSuffix: true,
                      })}
                    </span>
                    {alert.metadata.ip_address && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {alert.metadata.ip_address}
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
  );
};
