import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Activity, 
  Search, 
  Filter, 
  Eye, 
  MousePointerClick, 
  Keyboard, 
  Database,
  LogIn,
  MapPin,
  Smartphone,
  Clock,
  CheckCircle,
  AlertCircle,
  Building2,
  ChevronRight
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProfileStatusBadge } from "./ProfileStatusBadge";
import { UserActivityTimeline } from "./UserActivityTimeline";
import { ActivitySparkline } from "./ActivitySparkline";
import { useAvailableCompanies } from "@/hooks/useAvailableCompanies";

interface UserActivitySummary {
  user_id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string;
  photo_url: string | null;
  avatar_url: string | null;
  phone: string | null;
  title: string | null;
  is_active: boolean;
  created_at: string;
  password_set_at: string | null;
  company_name: string | null;
  has_photo: boolean;
  has_phone: boolean;
  has_title: boolean;
  login_count: number;
  first_login_at: string | null;
  last_session_activity: string | null;
  total_sessions: number;
  page_view_count: number;
  click_count: number;
  keystroke_count: number;
  data_change_count: number;
  unique_ip_count: number;
  ip_addresses: string[] | null;
  device_types: string[] | null;
  is_activated: boolean;
}

interface UserActivityDashboardProps {
  tenantFilter?: string;
  showCompanyColumn?: boolean;
}

export const UserActivityDashboard: React.FC<UserActivityDashboardProps> = ({
  tenantFilter,
  showCompanyColumn = true
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { companies } = useAvailableCompanies();

  const { data: activityData, isLoading } = useQuery({
    queryKey: ['user-activity-summary', tenantFilter],
    queryFn: async () => {
      let query = supabase
        .from('user_activity_summary')
        .select('*')
        .order('last_session_activity', { ascending: false, nullsFirst: false });

      if (tenantFilter) {
        query = query.eq('tenant_id', tenantFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as UserActivitySummary[];
    }
  });

  const filteredData = activityData?.filter(user => {
    // Search filter
    const matchesSearch = searchQuery === "" || 
      `${user.first_name} ${user.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Status filter - use computed is_activated from database view
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "activated" && user.is_activated) ||
      (statusFilter === "pending" && !user.is_activated);

    return matchesSearch && matchesStatus;
  }) || [];

  // Get daily activity for sparklines (last 30 days)
  const { data: dailyActivity } = useQuery({
    queryKey: ['daily-activity-sparklines'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data, error } = await supabase
        .from('user_activity_log')
        .select('user_id, created_at')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by user and day
      const userDailyMap: Record<string, number[]> = {};
      data?.forEach(activity => {
        const userId = activity.user_id;
        const day = new Date(activity.created_at).toDateString();
        
        if (!userDailyMap[userId]) {
          userDailyMap[userId] = Array(30).fill(0);
        }
        
        const dayIndex = Math.floor((new Date(activity.created_at).getTime() - thirtyDaysAgo.getTime()) / (24 * 60 * 60 * 1000));
        if (dayIndex >= 0 && dayIndex < 30) {
          userDailyMap[userId][dayIndex]++;
        }
      });

      return userDailyMap;
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            User Activity Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              User Activity Intelligence
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{filteredData.length} users</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="activated">Activated</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Activity Table */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>User</TableHead>
                  {showCompanyColumn && <TableHead>Company</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <LogIn className="h-3 w-3" />
                      Logins
                    </div>
                  </TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Eye className="h-3 w-3" />
                      Pages
                    </div>
                  </TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <MousePointerClick className="h-3 w-3" />
                      Clicks
                    </div>
                  </TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Keyboard className="h-3 w-3" />
                      Keys
                    </div>
                  </TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Activity (30d)</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={showCompanyColumn ? 10 : 9} className="text-center py-8 text-muted-foreground">
                      No users found matching your criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((user) => (
                    <TableRow 
                      key={user.user_id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedUserId(user.user_id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={user.photo_url || user.avatar_url || undefined} />
                            <AvatarFallback>
                              {user.first_name?.[0]}{user.last_name?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.first_name} {user.last_name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      {showCompanyColumn && (
                        <TableCell>
                          {user.company_name ? (
                            <div className="flex items-center gap-1.5 text-sm">
                              <Building2 className="h-3 w-3 text-muted-foreground" />
                              {user.company_name}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <ProfileStatusBadge
                          loginCount={user.login_count}
                          hasPhoto={user.has_photo}
                          hasPhone={user.has_phone}
                          hasTitle={user.has_title}
                          passwordSetAt={user.password_set_at}
                          showCompletion={true}
                        />
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {user.login_count}
                      </TableCell>
                      <TableCell className="text-center">
                        {user.page_view_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {user.click_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {user.keystroke_count.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {user.last_session_activity ? (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {formatDistanceToNow(new Date(user.last_session_activity), { addSuffix: true })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ActivitySparkline
                          data={dailyActivity?.[user.user_id] || []}
                          width={80}
                          height={20}
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm">Activated</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {activityData?.filter(u => u.is_activated).length || 0}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">Pending</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {activityData?.filter(u => !u.is_activated).length || 0}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Eye className="h-4 w-4" />
                <span className="text-sm">Total Page Views</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {activityData?.reduce((sum, u) => sum + u.page_view_count, 0).toLocaleString() || 0}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground">
                <LogIn className="h-4 w-4" />
                <span className="text-sm">Total Logins</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {activityData?.reduce((sum, u) => sum + u.login_count, 0).toLocaleString() || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Detail Dialog */}
      <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Activity Details</DialogTitle>
          </DialogHeader>
          {selectedUserId && (
            <div className="space-y-4">
              {/* User Info Header */}
              {(() => {
                const user = activityData?.find(u => u.user_id === selectedUserId);
                if (!user) return null;
                
                return (
                  <>
                    <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={user.photo_url || user.avatar_url || undefined} />
                        <AvatarFallback>
                          {user.first_name?.[0]}{user.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold">{user.first_name} {user.last_name}</h3>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                        {user.company_name && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                            <Building2 className="h-3 w-3" />
                            {user.company_name}
                          </p>
                        )}
                      </div>
                      <ProfileStatusBadge
                        loginCount={user.login_count}
                        hasPhoto={user.has_photo}
                        hasPhone={user.has_phone}
                        hasTitle={user.has_title}
                        passwordSetAt={user.password_set_at}
                      />
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-2xl font-bold">{user.login_count}</p>
                        <p className="text-xs text-muted-foreground">Total Logins</p>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-2xl font-bold">{user.total_sessions}</p>
                        <p className="text-xs text-muted-foreground">Sessions</p>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-2xl font-bold">{user.unique_ip_count}</p>
                        <p className="text-xs text-muted-foreground">Locations</p>
                      </div>
                    </div>

                    {/* First/Last Login */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="p-3 border rounded-lg">
                        <p className="text-muted-foreground">First Login</p>
                        <p className="font-medium">
                          {user.first_login_at 
                            ? format(new Date(user.first_login_at), 'MMM d, yyyy h:mm a')
                            : 'Never'
                          }
                        </p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-muted-foreground">Last Activity</p>
                        <p className="font-medium">
                          {user.last_session_activity 
                            ? format(new Date(user.last_session_activity), 'MMM d, yyyy h:mm a')
                            : 'Never'
                          }
                        </p>
                      </div>
                    </div>

                    {/* Device & Location Info */}
                    {(user.device_types?.length > 0 || user.ip_addresses?.length > 0) && (
                      <div className="p-3 border rounded-lg space-y-2">
                        {user.device_types?.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              Devices: {user.device_types.filter(Boolean).join(', ') || 'Unknown'}
                            </span>
                          </div>
                        )}
                        {user.ip_addresses?.length > 0 && (
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <span className="text-sm">
                              IPs: {user.ip_addresses.slice(0, 3).join(', ')}
                              {user.ip_addresses.length > 3 && ` +${user.ip_addresses.length - 3} more`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Activity Timeline */}
              <UserActivityTimeline userId={selectedUserId} limit={30} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
