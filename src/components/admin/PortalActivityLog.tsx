/**
 * Portal Activity Log Component
 * Full audit trail of homeowner portal activity
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Activity,
  LogIn,
  LogOut,
  Eye,
  Download,
  MessageSquare,
  CheckCircle,
  Bot,
  Smartphone,
  Monitor,
  Tablet,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { usePortalActivity, PortalActivity } from "@/hooks/usePortalAdmin";

interface PortalActivityLogProps {
  contactId?: string;
  limit?: number;
  showHeader?: boolean;
}

const ACTION_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  login: { icon: LogIn, color: "bg-green-500/10 text-green-600", label: "Login" },
  logout: { icon: LogOut, color: "bg-gray-500/10 text-gray-600", label: "Logout" },
  view_overview: { icon: Eye, color: "bg-blue-500/10 text-blue-600", label: "Viewed Overview" },
  view_photos: { icon: Eye, color: "bg-purple-500/10 text-purple-600", label: "Viewed Photos" },
  view_documents: { icon: Eye, color: "bg-orange-500/10 text-orange-600", label: "Viewed Documents" },
  view_payments: { icon: Eye, color: "bg-cyan-500/10 text-cyan-600", label: "Viewed Payments" },
  view_messages: { icon: Eye, color: "bg-pink-500/10 text-pink-600", label: "Viewed Messages" },
  send_message: { icon: MessageSquare, color: "bg-primary/10 text-primary", label: "Sent Message" },
  download_document: { icon: Download, color: "bg-amber-500/10 text-amber-600", label: "Downloaded Document" },
  approve_change_order: { icon: CheckCircle, color: "bg-emerald-500/10 text-emerald-600", label: "Approved Change Order" },
  ai_chat: { icon: Bot, color: "bg-violet-500/10 text-violet-600", label: "Used AI Chat" },
};

const DEVICE_ICONS: Record<string, React.ElementType> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
};

export const PortalActivityLog: React.FC<PortalActivityLogProps> = ({
  contactId,
  limit = 100,
  showHeader = true,
}) => {
  const { data: activities, isLoading } = usePortalActivity(contactId, limit);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const filteredActivities = React.useMemo(() => {
    if (!activities) return [];

    let filtered = activities;

    // Apply action filter
    if (actionFilter !== "all") {
      filtered = filtered.filter(a => a.action_type === actionFilter);
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a =>
          a.contact_name.toLowerCase().includes(query) ||
          a.project_name?.toLowerCase().includes(query) ||
          a.action_type.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [activities, actionFilter, searchQuery]);

  const uniqueActionTypes = React.useMemo(() => {
    if (!activities) return [];
    return [...new Set(activities.map(a => a.action_type))];
  }, [activities]);

  const getActionConfig = (actionType: string) => {
    return ACTION_CONFIG[actionType] || {
      icon: Activity,
      color: "bg-muted text-muted-foreground",
      label: actionType.replace(/_/g, " "),
    };
  };

  if (isLoading) {
    return (
      <Card>
        {showHeader && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Activity Log
            </CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Activity Log
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by user or project..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActionTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {getActionConfig(type).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Activity Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                {!contactId && <TableHead>User</TableHead>}
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Device</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredActivities.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={contactId ? 4 : 5}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No activity found
                  </TableCell>
                </TableRow>
              ) : (
                filteredActivities.map(activity => {
                  const config = getActionConfig(activity.action_type);
                  const ActionIcon = config.icon;
                  const DeviceIcon = activity.device_type
                    ? DEVICE_ICONS[activity.device_type] || Monitor
                    : Monitor;

                  return (
                    <TableRow key={activity.id}>
                      <TableCell className="whitespace-nowrap">
                        <div>
                          <p className="text-sm">
                            {formatDistanceToNow(new Date(activity.created_at), {
                              addSuffix: true,
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(activity.created_at), "h:mm a")}
                          </p>
                        </div>
                      </TableCell>
                      {!contactId && (
                        <TableCell>
                          <div>
                            <p className="font-medium">{activity.contact_name}</p>
                            {activity.project_name && (
                              <p className="text-sm text-muted-foreground">
                                {activity.project_name}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge className={config.color} variant="outline">
                          <ActionIcon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {activity.action_details?.page && (
                          <span className="text-sm text-muted-foreground">
                            {activity.action_details.page}
                          </span>
                        )}
                        {activity.action_details?.document_name && (
                          <span className="text-sm text-muted-foreground">
                            {activity.action_details.document_name}
                          </span>
                        )}
                        {activity.action_details?.message_preview && (
                          <span className="text-sm text-muted-foreground">
                            "{activity.action_details.message_preview.substring(0, 30)}..."
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DeviceIcon className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Results info */}
        <p className="text-sm text-muted-foreground">
          Showing {filteredActivities.length} of {activities?.length || 0} activities
        </p>
      </CardContent>
    </Card>
  );
};
