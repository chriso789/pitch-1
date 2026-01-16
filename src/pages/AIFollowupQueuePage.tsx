/**
 * AI Follow-up Queue Page
 * Shows pending AI outreach items for the current tenant with settings
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Clock, Phone, MessageSquare, Mail, Pause, Play, X, RefreshCw, Filter, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import AIFollowupAgentSettings from '@/components/communications/AIFollowupAgentSettings';

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
    email: string | null;
  } | null;
}

const AIFollowupQueuePage = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [activeTab, setActiveTab] = useState<string>('queue');

  // Fetch queue items
  const { data: queueItems, isLoading, refetch } = useQuery({
    queryKey: ['ai-outreach-queue', tenantId, statusFilter],
    queryFn: async () => {
      if (!tenantId) return [];
      
      let query = supabase
        .from('ai_outreach_queue')
        .select(`
          *,
          contact:contacts(first_name, last_name, phone, email)
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
      case 'email':
        return <Mail className="h-4 w-4 text-blue-500" />;
      case 'call':
        return <Phone className="h-4 w-4 text-purple-500" />;
      default:
        return <Bot className="h-4 w-4" />;
    }
  };

  const pendingCount = queueItems?.filter(i => i.state === 'pending').length || 0;
  const inProgressCount = queueItems?.filter(i => i.state === 'in_progress').length || 0;
  const completedCount = queueItems?.filter(i => i.state === 'completed').length || 0;
  const failedCount = queueItems?.filter(i => i.state === 'failed').length || 0;

  return (
    <GlobalLayout>
      <div className="container mx-auto py-4 md:py-6 px-4 md:px-6 space-y-4 md:space-y-6">
        {/* Header - Mobile Optimized */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              AI Follow-up Hub
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage AI-powered lead follow-ups
            </p>
          </div>
        </div>

        {/* Tabs - Mobile Friendly */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-12 md:h-10 md:w-auto md:inline-grid">
            <TabsTrigger value="queue" className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4" />
              <span>Queue</span>
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2 text-sm">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </TabsTrigger>
          </TabsList>

          {/* Queue Tab */}
          <TabsContent value="queue" className="mt-4 space-y-4">
            {/* Filter & Refresh - Mobile Optimized */}
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="flex-1 md:w-[160px] h-11 md:h-9">
                  <Filter className="h-4 w-4 mr-2 flex-shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9 flex-shrink-0" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {/* Stats Cards - Mobile Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-3 md:p-4">
                <div className="text-xl md:text-2xl font-bold text-yellow-600">{pendingCount}</div>
                <p className="text-xs md:text-sm text-muted-foreground">Pending</p>
              </Card>
              <Card className="p-3 md:p-4">
                <div className="text-xl md:text-2xl font-bold text-blue-600">{inProgressCount}</div>
                <p className="text-xs md:text-sm text-muted-foreground">In Progress</p>
              </Card>
              <Card className="p-3 md:p-4">
                <div className="text-xl md:text-2xl font-bold text-green-600">{completedCount}</div>
                <p className="text-xs md:text-sm text-muted-foreground">Completed</p>
              </Card>
              <Card className="p-3 md:p-4">
                <div className="text-xl md:text-2xl font-bold text-red-600">{failedCount}</div>
                <p className="text-xs md:text-sm text-muted-foreground">Failed</p>
              </Card>
            </div>

            {/* Queue List - Mobile Optimized */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg">Queue Items</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  {queueItems?.length || 0} items total
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 md:p-6 md:pt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : queueItems?.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground px-4">
                    <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">No items in queue</p>
                    <p className="text-xs mt-1">Items will appear here when contacts need follow-up</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {queueItems?.map((item) => (
                      <div 
                        key={item.id} 
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {getChannelIcon(item.channel)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">
                              {item.contact 
                                ? `${item.contact.first_name || ''} ${item.contact.last_name || ''}`.trim() || 'Unknown'
                                : 'Unknown Contact'
                              }
                            </div>
                            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(item.scheduled_for), 'MMM d, h:mm a')}
                              </span>
                              {item.attempts > 0 && (
                                <span>• {item.attempts} attempts</span>
                              )}
                            </div>
                            {item.last_error && (
                              <div className="text-xs text-destructive mt-1 line-clamp-1">{item.last_error}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-between sm:justify-end">
                          {getStatusBadge(item.state)}
                          <div className="flex items-center gap-1">
                            {item.state === 'pending' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9"
                                onClick={() => pauseMutation.mutate(item.id)}
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                            )}
                            {item.state === 'paused' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9"
                                onClick={() => resumeMutation.mutate(item.id)}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            )}
                            {(item.state === 'pending' || item.state === 'paused') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-destructive hover:text-destructive"
                                onClick={() => cancelMutation.mutate(item.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-4">
            <AIFollowupAgentSettings />
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default AIFollowupQueuePage;
