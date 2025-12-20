/**
 * Unified Communications Hook
 * Centralized data fetching and state management for communications hub
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface UnifiedInboxItem {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  channel: 'sms' | 'call' | 'email' | 'voicemail';
  direction: 'inbound' | 'outbound';
  content: string | null;
  subject: string | null;
  phone_number: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  assigned_to: string | null;
  related_call_id: string | null;
  related_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  };
}

export interface SMSThread {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  phone_number: string;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  is_archived: boolean;
  assigned_to: string | null;
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
  };
}

export interface SMSMessage {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  body: string;
  status: string;
  delivery_status?: string;
  provider: string | null;
  is_read: boolean;
  created_at: string;
}

export interface CallRecording {
  id: string;
  call_log_id: string | null;
  recording_url: string;
  duration_seconds: number | null;
  transcription: string | null;
  ai_summary: string | null;
  sentiment: string | null;
  is_starred: boolean;
  created_at: string;
  call_log?: {
    caller_id: string;
    callee_number: string;
    direction: string;
    contact?: {
      first_name: string;
      last_name: string;
    };
  };
}

export const useCommunications = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch unified inbox
  const {
    data: inboxItems = [],
    isLoading: inboxLoading,
    refetch: refetchInbox
  } = useQuery({
    queryKey: ['unified-inbox'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unified_inbox')
        .select(`
          *,
          contact:contacts(id, first_name, last_name, phone)
        `)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as UnifiedInboxItem[];
    }
  });

  // Fetch SMS threads
  const {
    data: smsThreads = [],
    isLoading: threadsLoading,
    refetch: refetchThreads
  } = useQuery({
    queryKey: ['sms-threads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_threads')
        .select(`
          *,
          contact:contacts(id, first_name, last_name)
        `)
        .eq('is_archived', false)
        .order('last_message_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as SMSThread[];
    }
  });

  // Fetch call recordings
  const {
    data: recordings = [],
    isLoading: recordingsLoading,
    refetch: refetchRecordings
  } = useQuery({
    queryKey: ['call-recordings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_recordings')
        .select(`
          *,
          call_log:call_logs(
            caller_id,
            callee_number,
            direction,
            contact:contacts(first_name, last_name)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as CallRecording[];
    }
  });

  // Fetch messages for a specific thread
  const fetchThreadMessages = useCallback(async (threadId: string) => {
    const { data, error } = await supabase
      .from('sms_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as SMSMessage[];
  }, []);

  // Mark inbox item as read
  const markAsRead = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('unified_inbox')
        .update({ is_read: true })
        .eq('id', itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
    }
  });

  // Mark thread as read
  const markThreadAsRead = useMutation({
    mutationFn: async (threadId: string) => {
      // Mark all messages in thread as read
      const { error: msgError } = await supabase
        .from('sms_messages')
        .update({ is_read: true })
        .eq('thread_id', threadId);

      if (msgError) throw msgError;

      // Reset unread count
      const { error: threadError } = await supabase
        .from('sms_threads')
        .update({ unread_count: 0 })
        .eq('id', threadId);

      if (threadError) throw threadError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-threads'] });
      queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
    }
  });

  // Toggle starred
  const toggleStarred = useMutation({
    mutationFn: async ({ id, isStarred }: { id: string; isStarred: boolean }) => {
      const { error } = await supabase
        .from('unified_inbox')
        .update({ is_starred: !isStarred })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
    }
  });

  // Archive item
  const archiveItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('unified_inbox')
        .update({ is_archived: true })
        .eq('id', itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
      toast({ title: 'Item archived' });
    }
  });

  // Send SMS
  const sendSMS = useMutation({
    mutationFn: async ({ to, message, threadId }: { to: string; message: string; threadId?: string }) => {
      const { data, error } = await supabase.functions.invoke('sms-send-reply', {
        body: { to, message, threadId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-threads'] });
      queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
      toast({ title: 'Message sent' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Get unread counts
  const unreadCounts = {
    total: inboxItems.filter(i => !i.is_read).length,
    sms: inboxItems.filter(i => i.channel === 'sms' && !i.is_read).length,
    calls: inboxItems.filter(i => i.channel === 'call' && !i.is_read).length,
    voicemail: inboxItems.filter(i => i.channel === 'voicemail' && !i.is_read).length
  };

  // Real-time subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('communications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'unified_inbox'
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['unified-inbox'] });
          // Show notification for inbound messages
          if (payload.new && (payload.new as UnifiedInboxItem).direction === 'inbound') {
            toast({
              title: `New ${(payload.new as UnifiedInboxItem).channel.toUpperCase()}`,
              description: (payload.new as UnifiedInboxItem).content?.substring(0, 50) || 'New message received'
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sms_threads'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['sms-threads'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, toast]);

  return {
    // Data
    inboxItems,
    smsThreads,
    recordings,
    unreadCounts,
    
    // Loading states
    isLoading: inboxLoading || threadsLoading || recordingsLoading,
    inboxLoading,
    threadsLoading,
    recordingsLoading,
    
    // Actions
    fetchThreadMessages,
    markAsRead: markAsRead.mutate,
    markThreadAsRead: markThreadAsRead.mutate,
    toggleStarred: toggleStarred.mutate,
    archiveItem: archiveItem.mutate,
    sendSMS: sendSMS.mutate,
    
    // Refetch
    refetchInbox,
    refetchThreads,
    refetchRecordings
  };
};
