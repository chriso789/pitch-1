import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, Shield, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface StatusChangeAuditLogProps {
  pipelineEntryId?: string;
  limit?: number;
}

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

export function StatusChangeAuditLog({ pipelineEntryId, limit = 50 }: StatusChangeAuditLogProps) {
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['status-audit-log', pipelineEntryId],
    queryFn: async () => {
      let query = supabase
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
        .limit(limit);

      if (pipelineEntryId) {
        query = query.eq('record_id', pipelineEntryId);
      }

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
      
      // Filter to only status change entries and add user info
      const entries = (data || [])
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
        });
      
      return entries as AuditEntry[];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Status Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!auditLogs?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Status Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            No status changes recorded yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          Status Change History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Changed By</TableHead>
                <TableHead>Transition</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((entry) => {
                const fromStatus = entry.old_values?.status || 'unknown';
                const toStatus = entry.new_values?.status || 'unknown';
                const isManagerOverride = entry.new_values?.is_manager_override;
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
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={entry.user_avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {entry.user_full_name?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{entry.user_full_name || 'Unknown'}</span>
                        {isManagerOverride && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1">
                            <Shield className="h-3 w-3" />
                            Override
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={STATUS_COLORS[fromStatus] || 'bg-muted'}>
                          {STATUS_LABELS[fromStatus] || fromStatus}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <Badge className={STATUS_COLORS[toStatus] || 'bg-muted'}>
                          {STATUS_LABELS[toStatus] || toStatus}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {reason ? (
                        <span className="text-sm text-muted-foreground truncate block" title={reason}>
                          {reason}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
