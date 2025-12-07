/**
 * Unified Inbox Component
 * Displays all communications in a single list with filtering
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { 
  Phone, MessageSquare, Mail, Voicemail, Star, Archive, 
  PhoneIncoming, PhoneOutgoing, Check, MoreHorizontal 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { UnifiedInboxItem, useCommunications } from '@/hooks/useCommunications';

interface UnifiedInboxProps {
  onSelectItem?: (item: UnifiedInboxItem) => void;
  onCallContact?: (phoneNumber: string) => void;
  selectedItemId?: string;
}

export const UnifiedInbox = ({ 
  onSelectItem, 
  onCallContact,
  selectedItemId 
}: UnifiedInboxProps) => {
  const [filter, setFilter] = useState<'all' | 'sms' | 'call' | 'voicemail'>('all');
  const { 
    inboxItems, 
    inboxLoading, 
    unreadCounts,
    markAsRead,
    toggleStarred,
    archiveItem 
  } = useCommunications();

  const filteredItems = inboxItems.filter(item => {
    if (filter === 'all') return true;
    return item.channel === filter;
  });

  const getChannelIcon = (channel: string, direction: string) => {
    switch (channel) {
      case 'sms':
        return <MessageSquare className="h-4 w-4" />;
      case 'call':
        return direction === 'inbound' 
          ? <PhoneIncoming className="h-4 w-4" /> 
          : <PhoneOutgoing className="h-4 w-4" />;
      case 'voicemail':
        return <Voicemail className="h-4 w-4" />;
      case 'email':
        return <Mail className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getChannelColor = (channel: string) => {
    switch (channel) {
      case 'sms':
        return 'text-blue-500 bg-blue-500/10';
      case 'call':
        return 'text-green-500 bg-green-500/10';
      case 'voicemail':
        return 'text-orange-500 bg-orange-500/10';
      case 'email':
        return 'text-purple-500 bg-purple-500/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const handleItemClick = (item: UnifiedInboxItem) => {
    if (!item.is_read) {
      markAsRead(item.id);
    }
    onSelectItem?.(item);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Inbox
            {unreadCounts.total > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCounts.total}
              </Badge>
            )}
          </CardTitle>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="all" className="text-xs">
              All
              {unreadCounts.total > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-4 px-1">
                  {unreadCounts.total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sms" className="text-xs">
              SMS
              {unreadCounts.sms > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-4 px-1">
                  {unreadCounts.sms}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="call" className="text-xs">
              Calls
              {unreadCounts.calls > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-4 px-1">
                  {unreadCounts.calls}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="voicemail" className="text-xs">
              VM
              {unreadCounts.voicemail > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-4 px-1">
                  {unreadCounts.voicemail}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          {inboxLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No messages</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    'p-3 cursor-pointer hover:bg-muted/50 transition-colors',
                    !item.is_read && 'bg-primary/5',
                    selectedItemId === item.id && 'bg-primary/10'
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Channel Icon */}
                    <div className={cn('p-2 rounded-full shrink-0', getChannelColor(item.channel))}>
                      {getChannelIcon(item.channel, item.direction)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn(
                            'font-medium truncate',
                            !item.is_read && 'font-semibold'
                          )}>
                            {item.contact 
                              ? `${item.contact.first_name} ${item.contact.last_name}`
                              : item.phone_number || 'Unknown'
                            }
                          </span>
                          {!item.is_read && (
                            <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(item.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {item.direction === 'outbound' && (
                          <Check className="h-3 w-3 inline mr-1" />
                        )}
                        {item.content || `${item.channel} ${item.direction}`}
                      </p>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStarred({ id: item.id, isStarred: item.is_starred });
                        }}
                      >
                        <Star className={cn(
                          'h-4 w-4',
                          item.is_starred && 'fill-yellow-400 text-yellow-400'
                        )} />
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {item.phone_number && (
                            <DropdownMenuItem onClick={() => onCallContact?.(item.phone_number!)}>
                              <Phone className="h-4 w-4 mr-2" />
                              Call
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => archiveItem(item.id)}>
                            <Archive className="h-4 w-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
