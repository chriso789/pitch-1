import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Mail, Reply, ArrowUpRight, ArrowDownLeft, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface EmailThreadViewProps {
  contactId: string;
  onReply?: (threadId: string, subject: string, toAddress: string) => void;
  maxHeight?: string;
}

interface EmailMessage {
  id: string;
  direction: string | null;
  subject: string | null;
  content: string | null;
  created_at: string;
  thread_id: string | null;
  message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  metadata: Record<string, unknown> | null;
}

export function EmailThreadView({ contactId, onReply, maxHeight = '500px' }: EmailThreadViewProps) {
  const { data: emails, isLoading } = useQuery({
    queryKey: ['email-thread', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communication_history')
        .select('id, direction, subject, content, created_at, thread_id, message_id, from_address, to_address, metadata')
        .eq('contact_id', contactId)
        .eq('communication_type', 'email')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as EmailMessage[];
    },
    enabled: !!contactId,
  });

  // Group emails by thread
  const groupedByThread = React.useMemo(() => {
    if (!emails) return new Map<string, EmailMessage[]>();
    
    const threads = new Map<string, EmailMessage[]>();
    
    emails.forEach(email => {
      const threadKey = email.thread_id || email.id;
      if (!threads.has(threadKey)) {
        threads.set(threadKey, []);
      }
      threads.get(threadKey)!.push(email);
    });

    return threads;
  }, [emails]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Conversation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!emails?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Conversation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No email history with this contact yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Conversation
          <Badge variant="secondary" className="ml-auto">
            {emails.length} message{emails.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ maxHeight }}>
          <div className="p-4 space-y-6">
            {Array.from(groupedByThread.entries()).map(([threadId, threadEmails]) => (
              <div key={threadId} className="space-y-3">
                {/* Thread Header */}
                {threadEmails.length > 1 && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2 px-2">
                    <span className="h-px flex-1 bg-border" />
                    <span>Thread: {threadEmails[0].subject || 'No Subject'}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                
                {/* Thread Messages */}
                {threadEmails.map((email, index) => (
                  <div
                    key={email.id}
                    className={cn(
                      'flex gap-3',
                      email.direction === 'outbound' ? 'flex-row-reverse' : 'flex-row'
                    )}
                  >
                    {/* Avatar */}
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className={cn(
                        'text-xs',
                        email.direction === 'outbound' 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-muted'
                      )}>
                        {email.direction === 'outbound' 
                          ? <ArrowUpRight className="h-4 w-4" />
                          : <ArrowDownLeft className="h-4 w-4" />
                        }
                      </AvatarFallback>
                    </Avatar>

                    {/* Message Content */}
                    <div className={cn(
                      'flex-1 max-w-[80%] rounded-lg p-3',
                      email.direction === 'outbound' 
                        ? 'bg-primary/10 border border-primary/20' 
                        : 'bg-muted'
                    )}>
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={email.direction === 'outbound' ? 'default' : 'secondary'} className="text-[10px]">
                          {email.direction === 'outbound' ? 'Sent' : 'Received'}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(email.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>

                      {/* Subject (only show on first message or if different) */}
                      {(index === 0 || email.subject !== threadEmails[index - 1]?.subject) && email.subject && (
                        <p className="font-medium text-sm mb-1">{email.subject}</p>
                      )}

                      {/* Addresses */}
                      <div className="text-xs text-muted-foreground mb-2">
                        {email.direction === 'outbound' ? (
                          <span>To: {email.to_address}</span>
                        ) : (
                          <span>From: {email.from_address}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div 
                        className="text-sm prose prose-sm max-w-none dark:prose-invert"
                        dangerouslySetInnerHTML={{ 
                          __html: email.content || '<em>No content</em>' 
                        }}
                      />

                      {/* Reply Button (for last message in thread) */}
                      {index === threadEmails.length - 1 && onReply && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => onReply(
                            email.thread_id || email.id,
                            email.subject?.startsWith('Re:') 
                              ? email.subject 
                              : `Re: ${email.subject || 'No Subject'}`,
                            email.direction === 'inbound' 
                              ? email.from_address || '' 
                              : email.to_address || ''
                          )}
                        >
                          <Reply className="h-4 w-4 mr-1" />
                          Reply
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
