/**
 * User Session History Component
 * Displays session history with IP addresses, locations, and security flags
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Monitor,
  Smartphone,
  Globe,
  Clock,
  MapPin,
  Shield,
  AlertTriangle,
  ChevronDown,
  Wifi,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface UserSessionHistoryProps {
  userId: string;
  limit?: number;
}

interface SessionData {
  id: string;
  event_type: string;
  ip_address: string | null;
  location_info: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    isp?: string;
    is_vpn?: boolean;
    is_proxy?: boolean;
  } | null;
  user_agent: string | null;
  device_info: {
    device_type?: string;
    browser?: string;
    os?: string;
  } | null;
  created_at: string;
}

interface ProcessedSession {
  id: string;
  device: string;
  browser: string;
  os: string;
  ipAddress: string;
  location: string | null;
  locationDetails: {
    city?: string;
    region?: string;
    country?: string;
    isp?: string;
    isVpn?: boolean;
    isProxy?: boolean;
  };
  timestamp: string;
  isNew: boolean;
  activityCount: number;
}

const DeviceIcon: React.FC<{ device: string }> = ({ device }) => {
  if (device.toLowerCase().includes("mobile") || device.toLowerCase().includes("phone")) {
    return <Smartphone className="h-4 w-4" />;
  }
  return <Monitor className="h-4 w-4" />;
};

export const UserSessionHistory: React.FC<UserSessionHistoryProps> = ({
  userId,
  limit = 10,
}) => {
  const [displayLimit, setDisplayLimit] = useState(limit);
  const [knownIPs, setKnownIPs] = useState<Set<string>>(new Set());

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["user-session-history", userId, displayLimit],
    queryFn: async () => {
      // Get session events
      const { data: sessionEvents, error } = await supabase
        .from("session_activity_log")
        .select("id, event_type, ip_address, location_info, user_agent, device_info, created_at")
        .eq("user_id", userId)
        .in("event_type", ["session_start", "login_success"])
        .order("created_at", { ascending: false })
        .limit(displayLimit);

      if (error) throw error;

      // Get activity counts per session
      const { data: activityData } = await supabase
        .from("user_activity_log")
        .select("session_id")
        .eq("user_id", userId);

      const activityCounts = new Map<string, number>();
      activityData?.forEach((activity) => {
        if (activity.session_id) {
          activityCounts.set(
            activity.session_id,
            (activityCounts.get(activity.session_id) || 0) + 1
          );
        }
      });

      // Track known IPs to flag new ones
      const allIPs = new Set<string>();
      const ipFirstSeen = new Map<string, string>();
      
      // Process from oldest to newest to identify first occurrences
      const sortedByOldest = [...(sessionEvents || [])].reverse();
      sortedByOldest.forEach((session) => {
        const ip = session.ip_address || "Unknown";
        if (ip !== "Unknown" && !ipFirstSeen.has(ip)) {
          ipFirstSeen.set(ip, session.id);
        }
        allIPs.add(ip);
      });

      // Process sessions
      const processed: ProcessedSession[] = (sessionEvents || []).map((rawSession) => {
        // Parse location_info and device_info from string if needed
        let locationInfo: SessionData["location_info"] = null;
        let deviceInfo: SessionData["device_info"] = null;
        
        if (rawSession.location_info) {
          if (typeof rawSession.location_info === "string") {
            try {
              locationInfo = JSON.parse(rawSession.location_info);
            } catch {
              locationInfo = null;
            }
          } else {
            locationInfo = rawSession.location_info as SessionData["location_info"];
          }
        }
        
        if (rawSession.device_info) {
          if (typeof rawSession.device_info === "string") {
            try {
              deviceInfo = JSON.parse(rawSession.device_info);
            } catch {
              deviceInfo = null;
            }
          } else {
            deviceInfo = rawSession.device_info as SessionData["device_info"];
          }
        }

        // Parse device info
        let device = "Desktop";
        let browser = "Unknown Browser";
        let os = "Unknown OS";

        if (deviceInfo) {
          device = deviceInfo.device_type || "Desktop";
          browser = deviceInfo.browser || "Unknown Browser";
          os = deviceInfo.os || "Unknown OS";
        } else if (rawSession.user_agent) {
          // Basic user agent parsing
          const ua = rawSession.user_agent.toLowerCase();
          if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
            device = "Mobile";
          } else if (ua.includes("tablet") || ua.includes("ipad")) {
            device = "Tablet";
          }
          
          if (ua.includes("chrome")) browser = "Chrome";
          else if (ua.includes("firefox")) browser = "Firefox";
          else if (ua.includes("safari")) browser = "Safari";
          else if (ua.includes("edge")) browser = "Edge";
          
          if (ua.includes("windows")) os = "Windows";
          else if (ua.includes("mac")) os = "macOS";
          else if (ua.includes("linux")) os = "Linux";
          else if (ua.includes("android")) os = "Android";
          else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
        }

        const ip = rawSession.ip_address || "Unknown";
        
        // Build location string
        let locationStr: string | null = null;
        if (locationInfo?.city && locationInfo?.country) {
          locationStr = `${locationInfo.city}, ${locationInfo.region || locationInfo.country}`;
        } else if (locationInfo?.country) {
          locationStr = locationInfo.country;
        }

        // Check if this IP is new (first time seen)
        const isNewIP = ip !== "Unknown" && ipFirstSeen.get(ip) === rawSession.id && allIPs.size > 1;

        return {
          id: rawSession.id,
          device,
          browser,
          os,
          ipAddress: ip,
          location: locationStr,
          locationDetails: {
            city: locationInfo?.city,
            region: locationInfo?.region,
            country: locationInfo?.country,
            isp: locationInfo?.isp,
            isVpn: locationInfo?.is_vpn,
            isProxy: locationInfo?.is_proxy,
          },
          timestamp: rawSession.created_at,
          isNew: isNewIP,
          activityCount: activityCounts.get(rawSession.id) || 0,
        };
      });

      return processed;
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Session History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                <Skeleton className="h-8 w-8 rounded" />
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

  if (!sessions || sessions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-5 w-5 text-primary" />
            Session History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="font-medium">No session history found</p>
            <p className="text-sm">Sessions will appear after the user logs in</p>
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
            <Globe className="h-5 w-5 text-primary" />
            Session History
          </CardTitle>
          <Badge variant="outline">{sessions.length} sessions</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[350px]">
          <div className="space-y-3 pr-4">
            {sessions.map((session, index) => (
              <div
                key={session.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  session.isNew ? "border-yellow-500/50 bg-yellow-500/5" : "bg-card"
                }`}
              >
                {/* Device Icon */}
                <div className="flex-shrink-0 p-2 rounded-md bg-muted">
                  <DeviceIcon device={session.device} />
                </div>

                {/* Session Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {session.browser} on {session.device}
                    </span>
                    {index === 0 && (
                      <Badge className="text-xs" variant="secondary">
                        Latest
                      </Badge>
                    )}
                    {session.isNew && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge className="text-xs gap-1 bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">
                              <AlertTriangle className="h-3 w-3" />
                              New IP
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            First time this IP was used to login
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {session.locationDetails.isVpn && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs gap-1">
                              <Shield className="h-3 w-3" />
                              VPN
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Connected via VPN or hosting provider
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>

                  {/* Time */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDistanceToNow(new Date(session.timestamp), { addSuffix: true })}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span>{format(new Date(session.timestamp), "MMM d, h:mm a")}</span>
                  </div>

                  {/* Location & IP */}
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    {session.location && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {session.location}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-mono text-muted-foreground">
                      <Wifi className="h-3 w-3" />
                      {session.ipAddress}
                    </span>
                  </div>

                  {/* ISP Info */}
                  {session.locationDetails.isp && (
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      ISP: {session.locationDetails.isp}
                    </div>
                  )}
                </div>

                {/* Activity Count */}
                {session.activityCount > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs">
                          {session.activityCount} actions
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Number of tracked actions in this session
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {sessions.length >= displayLimit && (
          <Button
            variant="ghost"
            className="w-full mt-3"
            onClick={() => setDisplayLimit((prev) => prev + 10)}
          >
            <ChevronDown className="h-4 w-4 mr-2" />
            Load More
          </Button>
        )}
      </CardContent>
    </Card>
  );
};