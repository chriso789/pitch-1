/**
 * SMS Thread List Component
 * Displays all SMS conversation threads
 */

import { useState } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { MessageSquare, Search, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { SMSThread, useCommunications } from '@/hooks/useCommunications';

interface SMSThreadListProps {
  onSelectThread: (thread: SMSThread) => void;
  selectedThreadId?: string;
}

export const SMSThreadList = ({ onSelectThread, selectedThreadId }: SMSThreadListProps) => {
  const [search, setSearch] = useState('');
  const { smsThreads, threadsLoading } = useCommunications();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, 'h:mm a');
    }
    if (isYesterday(date)) {
      return 'Yesterday';
    }
    return format(date, 'MMM d');
  };

  const getInitials = (thread: SMSThread) => {
    if (thread.contact) {
      return `${thread.contact.first_name[0]}${thread.contact.last_name[0]}`.toUpperCase();
    }
    return thread.phone_number.slice(-2);
  };

  const filteredThreads = smsThreads.filter(thread => {
    if (!search) return true;
    const contactName = thread.contact 
      ? `${thread.contact.first_name} ${thread.contact.last_name}`.toLowerCase()
      : '';
    const phoneNumber = thread.phone_number.toLowerCase();
    const searchLower = search.toLowerCase();
    return contactName.includes(searchLower) || phoneNumber.includes(searchLower);
  });

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Messages
          {smsThreads.reduce((acc, t) => acc + t.unread_count, 0) > 0 && (
            <Badge variant="destructive">
              {smsThreads.reduce((acc, t) => acc + t.unread_count, 0)}
            </Badge>
          )}
        </CardTitle>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          {threadsLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading conversations...
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No conversations</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredThreads.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => onSelectThread(thread)}
                  className={cn(
                    'p-3 cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-3',
                    thread.unread_count > 0 && 'bg-primary/5',
                    selectedThreadId === thread.id && 'bg-primary/10'
                  )}
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className={cn(
                      thread.unread_count > 0 && 'bg-primary text-primary-foreground'
                    )}>
                      {getInitials(thread)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        'font-medium truncate',
                        thread.unread_count > 0 && 'font-semibold'
                      )}>
                        {thread.contact 
                          ? `${thread.contact.first_name} ${thread.contact.last_name}`
                          : thread.phone_number
                        }
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {formatDate(thread.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-sm text-muted-foreground truncate">
                        {thread.last_message_preview || 'No messages'}
                      </p>
                      {thread.unread_count > 0 && (
                        <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center ml-2">
                          {thread.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
