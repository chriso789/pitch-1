import React, { useEffect, useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Send, MessageSquare, User, Building2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface CustomerMessagesProps {
  projectId: string;
  contactId?: string;
}

interface Message {
  id: string;
  message: string;
  sender_type: string;
  created_at: string;
  is_read: boolean;
}

export const CustomerMessages: React.FC<CustomerMessagesProps> = ({ 
  projectId,
  contactId
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMessages();
    setupRealtimeSubscription();
  }, [projectId]);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_messages')
        .select('id, message, sender_type, created_at, is_read')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);

      // Mark unread messages as read
      if (data && data.length > 0) {
        const unreadIds = data.filter(m => !m.is_read && m.sender_type === 'staff').map(m => m.id);
        if (unreadIds.length > 0) {
          await supabase
            .from('customer_messages')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .in('id', unreadIds);
        }
      }
    } catch (error: any) {
      console.error('Messages fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel(`messages-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'customer_messages',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages(prev => [...prev, newMsg]);

          // Mark as read if from staff
          if (newMsg.sender_type === 'staff') {
            supabase
              .from('customer_messages')
              .update({ is_read: true, read_at: new Date().toISOString() })
              .eq('id', newMsg.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      const { data, error } = await supabase
        .from('customer_messages')
        .insert({
          project_id: projectId,
          contact_id: contactId,
          sender_type: 'customer',
          message: newMessage.trim(),
          is_read: false
        })
        .select()
        .single();

      if (error) throw error;

      setNewMessage('');
      inputRef.current?.focus();
    } catch (error: any) {
      toast({
        title: 'Error sending message',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex flex-col h-[500px]">
        <h3 className="text-lg font-semibold mb-4">Messages</h3>
        <div className="flex-1 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className={cn('flex gap-3', i % 2 === 0 && 'justify-end')}>
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-12 w-48 rounded-lg" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 flex flex-col h-[500px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Messages</h3>
        <span className="text-sm text-muted-foreground">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Messages list */}
      <ScrollArea className="flex-1 pr-4 -mr-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No messages yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Send a message to get started
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {messages.map((msg) => {
              const isCustomer = msg.sender_type === 'customer';
              return (
                <div
                  key={msg.id}
                  className={cn('flex gap-3', isCustomer && 'flex-row-reverse')}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className={cn(
                      isCustomer ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    )}>
                      {isCustomer ? <User className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className={cn('max-w-[75%]', isCustomer && 'items-end')}>
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-2.5',
                        isCustomer
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted rounded-bl-sm'
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {msg.message}
                      </p>
                    </div>
                    <p className={cn(
                      'text-xs text-muted-foreground mt-1',
                      isCustomer && 'text-right'
                    )}>
                      {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Message input */}
      <form onSubmit={handleSendMessage} className="flex gap-2 pt-4 border-t mt-4">
        <Input
          ref={inputRef}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          disabled={sending}
          className="flex-1"
        />
        <Button type="submit" disabled={!newMessage.trim() || sending} size="icon">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
};
