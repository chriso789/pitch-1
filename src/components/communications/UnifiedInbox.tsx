/**
 * Unified Inbox Component — Grouped by Client
 * One row per contact (or phone number) with latest message preview and aggregated unread count.
 * Clicking a row opens the full back-and-forth thread for that client in the detail panel.
 */

import { useMemo, useState } from 'react';
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

interface ContactGroup {
  key: string;
  contactId: string | null;
  phoneNumber: string | null;
  contactName: string;
  latest: UnifiedInboxItem;
  unreadCount: number;
  channels: Set<string>;
  items: UnifiedInboxItem[];
}

export const UnifiedInbox = ({
  onSelectItem,
  onCallContact,
  selectedItemId,
}: UnifiedInboxProps) => {
  const [filter, setFilter] = useState<'all' | 'sms' | 'call' | 'voicemail'>('all');
  const {
    inboxItems,
    inboxLoading,
    unreadCounts,
    markAsRead,
    toggleStarred,
    archiveItem,
  } = useCommunications();

  // Group items by contact (fallback to phone number) so each client shows once
  const groupedContacts = useMemo<ContactGroup[]>(() => {
    const filtered = inboxItems.filter(item =>
      filter === 'all' ? true : item.channel === filter
    );

    const groups = new Map<string, ContactGroup>();

    for (const item of filtered) {
      const key =
        item.contact_id ||
        item.phone_number ||
        `unknown-${item.id}`;

      const name = item.contact
        ? `${item.contact.first_name} ${item.contact.last_name}`.trim()
        : item.phone_number || 'Unknown';

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          contactId: item.contact_id,
          phoneNumber: item.phone_number,
          contactName: name,
          latest: item,
          unreadCount: item.is_read ? 0 : 1,
          channels: new Set([item.channel]),
          items: [item],
        });
      } else {
        existing.items.push(item);
        existing.channels.add(item.channel);
        if (!item.is_read) existing.unreadCount += 1;
        if (new Date(item.created_at) > new Date(existing.latest.created_at)) {
          existing.latest = item;
        }
        if (!existing.phoneNumber && item.phone_number) {
          existing.phoneNumber = item.phone_number;
        }
      }
    }

    return Array.from(groups.values()).sort(
      (a, b) =>
        new Date(b.latest.created_at).getTime() -
        new Date(a.latest.created_at).getTime()
    );
  }, [inboxItems, filter]);

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

  const handleGroupClick = (group: ContactGroup) => {
    // Mark all unread items for this client as read
    group.items
      .filter(i => !i.is_read)
      .forEach(i => markAsRead(i.id));
    // Open the conversation by selecting the latest item (detail panel
    // loads full back-and-forth by phone number).
    onSelectItem?.(group.latest);
  };

  const isGroupSelected = (group: ContactGroup) =>
    !!selectedItemId && group.items.some(i => i.id === selectedItemId);

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
          ) : groupedContacts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No messages</p>
            </div>
          ) : (
            <div className="divide-y">
              {groupedContacts.map((group) => {
                const latest = group.latest;
                const isUnread = group.unreadCount > 0;
                const selected = isGroupSelected(group);
                return (
                  <div
                    key={group.key}
                    onClick={() => handleGroupClick(group)}
                    className={cn(
                      'p-3 cursor-pointer hover:bg-muted/50 transition-colors',
                      isUnread && 'bg-primary/5',
                      selected && 'bg-primary/10'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Channel icon (latest channel) */}
                      <div className={cn('p-2 rounded-full shrink-0', getChannelColor(latest.channel))}>
                        {getChannelIcon(latest.channel, latest.direction)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={cn(
                              'font-medium truncate',
                              isUnread && 'font-semibold'
                            )}>
                              {group.contactName}
                            </span>
                            {isUnread && (
                              <Badge variant="destructive" className="h-4 px-1.5 text-[10px] shrink-0">
                                {group.unreadCount}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {format(new Date(latest.created_at), 'MMM d, h:mm a')}
                          </span>
                        </div>

                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {latest.direction === 'outbound' && (
                            <Check className="h-3 w-3 inline mr-1" />
                          )}
                          {latest.content || `${latest.channel} ${latest.direction}`}
                        </p>

                        {/* Channel mix indicator */}
                        {group.channels.size > 1 && (
                          <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                            {Array.from(group.channels).map((ch) => (
                              <span key={ch} className={cn('p-0.5 rounded', getChannelColor(ch))}>
                                {getChannelIcon(ch, 'inbound')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStarred({ id: latest.id, isStarred: latest.is_starred });
                          }}
                        >
                          <Star className={cn(
                            'h-4 w-4',
                            latest.is_starred && 'fill-yellow-400 text-yellow-400'
                          )} />
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {group.phoneNumber && (
                              <DropdownMenuItem onClick={() => onCallContact?.(group.phoneNumber!)}>
                                <Phone className="h-4 w-4 mr-2" />
                                Call
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => group.items.forEach(i => archiveItem(i.id))}
                            >
                              <Archive className="h-4 w-4 mr-2" />
                              Archive conversation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
