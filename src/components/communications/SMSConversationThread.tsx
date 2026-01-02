/**
 * SMS Conversation Thread Component
 * Two-way SMS messaging interface
 */

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Send, Phone, User, Loader2, ChevronLeft, Check, CheckCheck, Clock, XCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { SMSThread, SMSMessage, useCommunications } from '@/hooks/useCommunications';
import { supabase } from '@/integrations/supabase/client';

interface SMSConversationThreadProps {
  thread?: SMSThread;
  phoneNumber?: string;
  contactName?: string;
  onBack?: () => void;
  onCall?: (phoneNumber: string) => void;
}

// Delivery status icon component
const DeliveryStatusIcon = ({ status, errorMessage, isOutbound }: { status?: string; errorMessage?: string; isOutbound: boolean }) => {
  const iconClass = cn(
    'h-3.5 w-3.5',
    isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
  );

  switch (status) {
    case 'delivered':
      return (
        <span className="flex items-center" title="Delivered">
          <CheckCheck className={cn(iconClass, 'text-green-400')} />
        </span>
      );
    case 'sent':
      return (
        <span className="flex items-center" title="Sent">
          <Check className={cn(iconClass, isOutbound ? 'text-primary-foreground/70' : '')} />
        </span>
      );
    case 'queued':
    case 'sending':
    case 'pending':
      return (
        <span className="flex items-center" title="Sending...">
          <Clock className={cn(iconClass, 'opacity-60')} />
        </span>
      );
    case 'failed':
    case 'undelivered':
    case 'delivery_failed':
      return (
        <span 
          className="flex items-center cursor-help" 
          title={errorMessage || "Failed to deliver - check 10DLC registration"}
        >
          <XCircle className={cn('h-3.5 w-3.5 text-red-400')} />
        </span>
      );
    default:
      // Unknown or no status - show single check
      return (
        <span className="flex items-center" title={status || 'Sent'}>
          <Check className={iconClass} />
        </span>
      );
  }
};

// Failed message alert component
const FailedMessageAlert = ({ count }: { count: number }) => {
  if (count === 0) return null;
  
  return (
    <div className="mx-4 mb-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-destructive">
            {count} message{count > 1 ? 's' : ''} failed to deliver
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            This may be due to 10DLC registration requirements. US carriers require SMS campaigns to be registered. 
            Check your Telnyx messaging profile settings.
          </p>
        </div>
      </div>
    </div>
  );
};

export const SMSConversationThread = ({
  thread,
  phoneNumber,
  contactName,
  onBack,
  onCall
}: SMSConversationThreadProps) => {
  const [messages, setMessages] = useState<SMSMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { fetchThreadMessages, sendSMS, markThreadAsRead } = useCommunications();

  const targetPhone = thread?.phone_number || phoneNumber;
  const displayName = thread?.contact 
    ? `${thread.contact.first_name} ${thread.contact.last_name}`
    : contactName || targetPhone;

  // Load messages when thread changes
  useEffect(() => {
    if (thread?.id) {
      setLoading(true);
      fetchThreadMessages(thread.id)
        .then(setMessages)
        .finally(() => setLoading(false));
      
      // Mark as read
      markThreadAsRead(thread.id);
    } else {
      setMessages([]);
    }
  }, [thread?.id, fetchThreadMessages, markThreadAsRead]);

  // Real-time subscription for delivery status updates
  useEffect(() => {
    if (!thread?.id) return;

    const channel = supabase
      .channel(`sms-status-${thread.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'communication_history',
          filter: `sms_thread_id=eq.${thread.id}`
        },
        (payload) => {
          // Update the message in state with new delivery status
          setMessages(prev => prev.map(msg => 
            msg.id === payload.new.id 
              ? { ...msg, delivery_status: (payload.new as any).delivery_status, error_message: (payload.new as any).error_message }
              : msg
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !targetPhone) return;

    setSending(true);
    try {
      await sendSMS({
        to: targetPhone,
        message: newMessage.trim(),
        threadId: thread?.id
      });
      setNewMessage('');
      
      // Refresh messages if we have a thread
      if (thread?.id) {
        const updated = await fetchThreadMessages(thread.id);
        setMessages(updated);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!thread && !phoneNumber) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a conversation to start messaging</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{displayName}</CardTitle>
            <p className="text-sm text-muted-foreground">{targetPhone}</p>
          </div>
          {targetPhone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCall?.(targetPhone)}
              className="shrink-0"
            >
              <Phone className="h-4 w-4 mr-2" />
              Call
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Failed message alert */}
        <FailedMessageAlert 
          count={messages.filter(m => 
            m.direction === 'outbound' && 
            (m.delivery_status === 'failed' || m.delivery_status === 'delivery_failed' || m.delivery_status === 'undelivered')
          ).length} 
        />
        
        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>No messages yet. Start the conversation!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, index) => {
                const isOutbound = msg.direction === 'outbound';
                const isFailed = msg.delivery_status === 'failed' || msg.delivery_status === 'delivery_failed' || msg.delivery_status === 'undelivered';
                const showTimestamp = index === 0 || 
                  new Date(msg.created_at).getTime() - new Date(messages[index - 1].created_at).getTime() > 300000;
                
                return (
                  <div key={msg.id}>
                    {showTimestamp && (
                      <div className="text-center my-4">
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                          {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    )}
                    <div className={cn(
                      'flex',
                      isOutbound ? 'justify-end' : 'justify-start'
                    )}>
                      <div className={cn(
                        'max-w-[80%] rounded-2xl px-4 py-2',
                        isOutbound 
                          ? isFailed 
                            ? 'bg-destructive/80 text-destructive-foreground rounded-br-sm'
                            : 'bg-primary text-primary-foreground rounded-br-sm' 
                          : 'bg-muted rounded-bl-sm'
                      )}>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                        <div className={cn(
                          'flex items-center gap-1.5 mt-1',
                          isOutbound ? 'justify-end' : 'justify-start'
                        )}>
                          <span className={cn(
                            'text-xs',
                            isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}>
                            {format(new Date(msg.created_at), 'h:mm a')}
                          </span>
                          {isOutbound && (
                            <DeliveryStatusIcon 
                              status={msg.delivery_status || msg.status} 
                              errorMessage={msg.error_message}
                              isOutbound={isOutbound}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Message Input */}
        <div className="p-4 border-t shrink-0">
          <div className="flex gap-2">
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="min-h-[44px] max-h-32 resize-none"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!newMessage.trim() || sending}
              className="shrink-0"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
