/**
 * Unmatched Inbox List Component
 * Displays list of unmatched inbound items with filters
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Phone, MessageSquare, Search, RefreshCw, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { UnmatchedInboundItem } from '@/pages/UnmatchedInboxPage';

interface UnmatchedInboxListProps {
  selectedId?: string;
  onSelect: (item: UnmatchedInboundItem) => void;
}

export const UnmatchedInboxList = ({ selectedId, onSelect }: UnmatchedInboxListProps) => {
  const tenantId = useEffectiveTenantId();
  const [stateFilter, setStateFilter] = useState<string>('open');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ['unmatched-inbox', tenantId, stateFilter, channelFilter],
    queryFn: async () => {
      if (!tenantId) return [];

      let query = supabase
        .from('unmatched_inbound')
        .select(`
          id,
          tenant_id,
          from_e164,
          to_e164,
          channel,
          body,
          state,
          event_type,
          received_at,
          notes,
          contact_id,
          conversation_id,
          location_id,
          media,
          raw_payload
        `)
        .eq('tenant_id', tenantId)
        .order('received_at', { ascending: false })
        .limit(100);

      if (stateFilter !== 'all') {
        query = query.eq('state', stateFilter);
      }

      if (channelFilter !== 'all') {
        query = query.eq('channel', channelFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch unmatched inbox:', error);
        return [];
      }

      return data as UnmatchedInboundItem[];
    },
    enabled: !!tenantId,
  });

  // Filter by search query locally
  const filteredItems = items?.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.from_e164?.toLowerCase().includes(query) ||
      item.body?.toLowerCase().includes(query)
    );
  }) ?? [];

  const formatPhoneNumber = (phone: string) => {
    // Simple formatting for display
    if (phone.startsWith('+1') && phone.length === 12) {
      return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    }
    return phone;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Filters */}
      <div className="p-3 border-b space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by phone or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="linked">Linked</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>

          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="call">Calls</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground">
            Loading...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            No unmatched items found
          </div>
        ) : (
          <div className="divide-y">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelect(item)}
                className={cn(
                  'p-3 cursor-pointer hover:bg-accent/50 transition-colors',
                  selectedId === item.id && 'bg-accent'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.channel === 'sms' ? (
                      <MessageSquare className="h-4 w-4 text-blue-500 shrink-0" />
                    ) : (
                      <Phone className="h-4 w-4 text-green-500 shrink-0" />
                    )}
                    <span className="font-medium truncate">
                      {formatPhoneNumber(item.from_e164)}
                    </span>
                  </div>
                  <Badge
                    variant={
                      item.state === 'open' ? 'default' :
                      item.state === 'linked' ? 'secondary' :
                      'outline'
                    }
                    className="shrink-0"
                  >
                    {item.state}
                  </Badge>
                </div>

                {item.body && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {item.body}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{formatDistanceToNow(new Date(item.received_at), { addSuffix: true })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
