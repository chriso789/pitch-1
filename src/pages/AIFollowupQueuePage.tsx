/**
 * AI Follow-up Queue Page
 * Shows pending AI outreach items for the current tenant
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Clock, Phone, MessageSquare, Pause, Play, X, RefreshCw, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface QueueItem {
  id: string;
  contact_id: string;
  channel: string;
  state: string;
  scheduled_for: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  contact?: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  } | null;
}

const AIFollowupQueuePage = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  // Fetch queue items
  const { data: queueItems, isLoading, refetch } = useQuery({
    queryKey: ['ai-outreach-queue', tenantId, statusFilter],
    queryFn: async () => {
      if (!tenantId) return [];
      
      let query = supabase
        .from('ai_outreach_queue')
        .select(`
          *,
          contact:contacts(first_name, last_name, phone)
        `)
        .eq('tenant_id', tenantId)
        .order('scheduled_for', { ascending: true });
      
      if (statusFilter !== 'all') {
        query = query.eq('state', statusFilter);
      }
      
      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as QueueItem[];
    },
    enabled: !!tenantId,
  });

  // Pause item mutation
  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ai_outreach_queue')
        .update({ state: 'paused' })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-outreach-queue'] });
      toast({ title: 'Item paused' });
    },
  });

  // Resume item mutation
  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ai_outreach_queue')
        .update({ state: 'pending' })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-outreach-queue'] });
      toast({ title: 'Item resumed' });
    },
  });

  // Cancel item mutation
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ai_outreach_queue')
        .update({ state: 'cancelled' })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-outreach-queue'] });
      toast({ title: 'Item cancelled' });
    },
  });

  const getStatusBadge = (state: string) => {
    switch (state) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-300">Pending</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-300">In Progress</Badge>;
      case 'completed':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-300">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'paused':
        return <Badge variant="secondary">Paused</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{state}</Badge>;
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'sms':
        return <MessageSquare className="h-4 w-4 text-green-500" />;
      case 'call':
        return <Phone className="h-4 w-4 text-blue-500" />;
      default:
        return <Bot className="h-4 w-4" />;
    }
  };

  return (
    <GlobalLayout>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              AI Follow-up Queue
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage pending AI outreach for leads and contacts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{queueItems?.filter(i => i.state === 'pending').length || 0}</div>
              <p className="text-muted-foreground text-sm">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{queueItems?.filter(i => i.state === 'in_progress').length || 0}</div>
              <p className="text-muted-foreground text-sm">In Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{queueItems?.filter(i => i.state === 'completed').length || 0}</div>
              <p className="text-muted-foreground text-sm">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{queueItems?.filter(i => i.state === 'failed').length || 0}</div>
              <p className="text-muted-foreground text-sm">Failed</p>
            </CardContent>
          </Card>
        </div>

        {/* Queue List */}
        <Card>
          <CardHeader>
            <CardTitle>Queue Items</CardTitle>
            <CardDescription>
              {queueItems?.length || 0} items in queue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : queueItems?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No items in queue</p>
              </div>
            ) : (
              <div className="divide-y">
                {queueItems?.map((item) => (
                  <div key={item.id} className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {getChannelIcon(item.channel)}
                      <div>
                        <div className="font-medium">
                          {item.contact 
                            ? `${item.contact.first_name} ${item.contact.last_name}`
                            : 'Unknown Contact'
                          }
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <Clock className="h-3 w-3" />
                          {format(new Date(item.scheduled_for), 'MMM d, h:mm a')}
                          {item.attempts > 0 && (
                            <span className="text-xs">• {item.attempts} attempts</span>
                          )}
                        </div>
                        {item.last_error && (
                          <div className="text-xs text-destructive mt-1">{item.last_error}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(item.state)}
                      {item.state === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => pauseMutation.mutate(item.id)}
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}
                      {item.state === 'paused' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resumeMutation.mutate(item.id)}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      {(item.state === 'pending' || item.state === 'paused') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => cancelMutation.mutate(item.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default AIFollowupQueuePage;
