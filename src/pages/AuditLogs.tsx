import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Shield, Download, Search, History, Filter } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { exportToCSV } from '@/lib/export-utils';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface AuditEntry {
  id: string;
  changed_at: string;
  changed_by: string;
  old_values: { status?: string } | null;
  new_values: { 
    status?: string;
    is_manager_override?: boolean;
    transition_reason?: string;
  } | null;
  record_id: string;
  user_full_name?: string;
  user_avatar_url?: string;
}

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-blue-100 text-blue-800',
  contingency_signed: 'bg-yellow-100 text-yellow-800',
  legal_review: 'bg-purple-100 text-purple-800',
  ready_for_approval: 'bg-orange-100 text-orange-800',
  project: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  lost: 'bg-red-100 text-red-800',
  canceled: 'bg-gray-100 text-gray-800',
  duplicate: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  lead: 'New Lead',
  contingency_signed: 'Contingency Signed',
  legal_review: 'Legal Review',
  ready_for_approval: 'Ready for Approval',
  project: 'Approved/Project',
  completed: 'Completed',
  closed: 'Closed',
  lost: 'Lost',
  canceled: 'Canceled',
  duplicate: 'Duplicate',
};

const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

export default function AuditLogs() {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [overrideFilter, setOverrideFilter] = useState<string>('all');

  // Query user roles separately
  const { data: userRoles } = useQuery({
    queryKey: ['user-roles', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Check if user is a manager
  const isManager = userRoles?.some(r => MANAGER_ROLES.includes(r.role)) || 
    (profile?.role && MANAGER_ROLES.includes(profile.role));

  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['all-status-audit-logs', statusFilter, overrideFilter],
    queryFn: async () => {
      const query = supabase
        .from('audit_log')
        .select(`
          id,
          changed_at,
          changed_by,
          old_values,
          new_values,
          record_id
        `)
        .eq('table_name', 'pipeline_entries')
        .eq('action', 'UPDATE')
        .order('changed_at', { ascending: false })
        .limit(200);

      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching audit logs:', error);
        throw error;
      }
      
      // Fetch user profiles for the changed_by users
      const userIds = [...new Set((data || []).map(d => d.changed_by).filter(Boolean))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url')
        .in('id', userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Filter to status changes and add user info
      let filtered = (data || [])
        .filter(entry => {
          const oldVals = entry.old_values as Record<string, unknown> | null;
          const newVals = entry.new_values as Record<string, unknown> | null;
          return oldVals?.status || newVals?.status;
        })
        .map(entry => {
          const profile = profileMap.get(entry.changed_by);
          return {
            ...entry,
            old_values: entry.old_values as { status?: string } | null,
            new_values: entry.new_values as { status?: string; is_manager_override?: boolean; transition_reason?: string } | null,
            user_full_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Unknown',
            user_avatar_url: profile?.avatar_url,
          };
        }) as AuditEntry[];

      // Apply status filter
      if (statusFilter !== 'all') {
        filtered = filtered.filter(entry => 
          entry.new_values?.status === statusFilter
        );
      }

      // Apply override filter
      if (overrideFilter === 'override') {
        filtered = filtered.filter(entry => entry.new_values?.is_manager_override);
      } else if (overrideFilter === 'normal') {
        filtered = filtered.filter(entry => !entry.new_values?.is_manager_override);
      }

      return filtered;
    },
    enabled: isManager,
  });

  // If not a manager, redirect
  if (!isManager && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }

  // Filter by search query
  const filteredLogs = auditLogs?.filter(entry => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      entry.user_full_name?.toLowerCase().includes(searchLower) ||
      entry.new_values?.transition_reason?.toLowerCase().includes(searchLower) ||
      entry.record_id.toLowerCase().includes(searchLower)
    );
  });

  const handleExport = () => {
    if (!filteredLogs?.length) return;

    const exportData = filteredLogs.map(entry => ({
      date: format(new Date(entry.changed_at), 'yyyy-MM-dd HH:mm:ss'),
      changed_by: entry.user_full_name || 'Unknown',
      from_status: STATUS_LABELS[entry.old_values?.status || ''] || entry.old_values?.status || '',
      to_status: STATUS_LABELS[entry.new_values?.status || ''] || entry.new_values?.status || '',
      is_override: entry.new_values?.is_manager_override ? 'Yes' : 'No',
      reason: entry.new_values?.transition_reason || '',
      record_id: entry.record_id,
    }));

    exportToCSV(exportData, `status-changes-audit-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                All Status Changes
              </CardTitle>
              <Button onClick={handleExport} variant="outline" disabled={!filteredLogs?.length}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, reason, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={overrideFilter} onValueChange={setOverrideFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Override filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Changes</SelectItem>
                  <SelectItem value="override">Manager Overrides Only</SelectItem>
                  <SelectItem value="normal">Normal Transitions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !filteredLogs?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                No status changes found matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Changed By</TableHead>
                      <TableHead>From → To</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Lead ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((entry) => {
                      const fromStatus = entry.old_values?.status || 'unknown';
                      const toStatus = entry.new_values?.status || 'unknown';
                      const isOverride = entry.new_values?.is_manager_override;
                      const reason = entry.new_values?.transition_reason;

                      return (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(entry.changed_at), 'MMM d, yyyy')}
                            <br />
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(entry.changed_at), 'h:mm a')}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7">
                                <AvatarImage src={entry.user_avatar_url || undefined} />
                                <AvatarFallback className="text-xs">
                                  {entry.user_full_name?.[0] || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <span className="text-sm font-medium">{entry.user_full_name || 'Unknown'}</span>
                                {isOverride && (
                                  <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300 gap-1">
                                    <Shield className="h-3 w-3" />
                                    Override
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={STATUS_COLORS[fromStatus] || 'bg-muted'}>
                                {STATUS_LABELS[fromStatus] || fromStatus}
                              </Badge>
                              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              <Badge className={STATUS_COLORS[toStatus] || 'bg-muted'}>
                                {STATUS_LABELS[toStatus] || toStatus}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[250px]">
                            {reason ? (
                              <span className="text-sm text-muted-foreground" title={reason}>
                                {reason.length > 80 ? `${reason.slice(0, 80)}...` : reason}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <a 
                              href={`/lead/${entry.record_id}`}
                              className="text-sm text-primary hover:underline font-mono"
                            >
                              {entry.record_id.slice(0, 8)}...
                            </a>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
