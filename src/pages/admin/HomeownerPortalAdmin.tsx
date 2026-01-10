/**
 * Homeowner Portal Admin Page
 * CRM-side management of portal users, permissions, and activity
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Activity,
  Circle,
  TrendingUp,
  Settings,
} from "lucide-react";
import { usePortalStats, usePortalUsers, PortalUser } from "@/hooks/usePortalAdmin";
import { PortalUsersList } from "@/components/admin/PortalUsersList";
import { PortalUserDetail } from "@/components/admin/PortalUserDetail";
import { PortalActivityLog } from "@/components/admin/PortalActivityLog";
import { PortalGlobalSettings } from "@/components/admin/PortalGlobalSettings";

export const HomeownerPortalAdmin: React.FC = () => {
  const { data: stats, isLoading: statsLoading } = usePortalStats();
  const [selectedUser, setSelectedUser] = useState<PortalUser | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("active");

  const handleSelectUser = (user: PortalUser) => {
    setSelectedUser(user);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Users
                </p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-3xl font-bold">{stats?.total_users || 0}</p>
                )}
              </div>
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Active Today
                </p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-3xl font-bold">{stats?.active_today || 0}</p>
                )}
              </div>
              <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Online Now
                </p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-3xl font-bold">{stats?.online_now || 0}</p>
                    {(stats?.online_now || 0) > 0 && (
                      <Circle className="h-3 w-3 fill-green-500 text-green-500 animate-pulse" />
                    )}
                  </div>
                )}
              </div>
              <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Circle className="h-6 w-6 text-green-500 fill-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Actions (7d)
                </p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-3xl font-bold">
                    {stats?.actions_this_week || 0}
                  </p>
                )}
              </div>
              <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Activity className="h-6 w-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Portal Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="active" className="flex items-center gap-2">
                Active Users
                {(stats?.active_today || 0) > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5">
                    {stats?.active_today}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="all">All Users</TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Activity Log
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active">
              <PortalUsersList
                onSelectUser={handleSelectUser}
                selectedUserId={selectedUser?.id}
                filter="active"
              />
            </TabsContent>

            <TabsContent value="all">
              <PortalUsersList
                onSelectUser={handleSelectUser}
                selectedUserId={selectedUser?.id}
                filter="all"
              />
            </TabsContent>

            <TabsContent value="activity">
              <PortalActivityLog showHeader={false} />
            </TabsContent>

            <TabsContent value="settings">
              <PortalGlobalSettings />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* User Detail Slide-out */}
      <PortalUserDetail
        user={selectedUser}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
};

export default HomeownerPortalAdmin;
