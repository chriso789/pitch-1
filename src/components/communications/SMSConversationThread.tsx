/**
 * SMS Conversation Thread Component
 * Two-way SMS messaging interface
 */

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Send, Phone, User, Loader2, ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { SMSThread, SMSMessage, useCommunications } from '@/hooks/useCommunications';

interface SMSConversationThreadProps {
  thread?: SMSThread;
  phoneNumber?: string;
  contactName?: string;
  onBack?: () => void;
  onCall?: (phoneNumber: string) => void;
}

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
                          ? 'bg-primary text-primary-foreground rounded-br-sm' 
                          : 'bg-muted rounded-bl-sm'
                      )}>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                        <div className={cn(
                          'flex items-center gap-1 mt-1',
                          isOutbound ? 'justify-end' : 'justify-start'
                        )}>
                          <span className={cn(
                            'text-xs',
                            isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}>
                            {format(new Date(msg.created_at), 'h:mm a')}
                          </span>
                          {isOutbound && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                'text-[10px] h-4 px-1',
                                msg.status === 'delivered' && 'border-green-500 text-green-500',
                                msg.status === 'failed' && 'border-red-500 text-red-500'
                              )}
                            >
                              {msg.status}
                            </Badge>
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
