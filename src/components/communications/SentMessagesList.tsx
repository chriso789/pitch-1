/**
 * Sent Messages List
 * One row per contact (or destination number) showing the latest outbound SMS we sent.
 * Used in the Follow Up Hub "Sent" tab so reps can see everyone we've messaged.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { Send, Search, CheckCircle2, Clock, XCircle, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useLocation } from '@/contexts/LocationContext';

interface SentRow {
  key: string;
  contact_id: string | null;
  phone: string;
  name: string;
  body: string;
  sent_at: string;
  status: string;
  count: number;
}

interface Props {
  onSelect?: (row: { contact_id: string | null; phone: string; name: string }) => void;
  selectedKey?: string;
}

export const SentMessagesList = ({ onSelect, selectedKey }: Props) => {
  const [search, setSearch] = useState('');
  const { effectiveTenantId } = useEffectiveTenantId();
  const { currentLocationId } = useLocation();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['sent-sms-grouped', effectiveTenantId, currentLocationId],
    enabled: !!effectiveTenantId,
    queryFn: async (): Promise<SentRow[]> => {
      let q = supabase
        .from('sms_messages')
        .select('id, contact_id, to_number, body, status, sent_at, created_at, location_id, contacts:contacts!sms_messages_contact_id_fkey(first_name,last_name)')
        .eq('tenant_id', effectiveTenantId!)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(500);
      if (currentLocationId) q = q.eq('location_id', currentLocationId);
      const { data, error } = await q;
      if (error) throw error;

      const map = new Map<string, SentRow>();
      for (const m of (data || []) as any[]) {
        const key = m.contact_id || m.to_number || m.id;
        const existing = map.get(key);
        const name = m.contacts
          ? `${m.contacts.first_name || ''} ${m.contacts.last_name || ''}`.trim() || m.to_number
          : m.to_number;
        if (!existing) {
          map.set(key, {
            key,
            contact_id: m.contact_id,
            phone: m.to_number,
            name,
            body: m.body || '',
            sent_at: m.sent_at || m.created_at,
            status: m.status || 'sent',
            count: 1,
          });
        } else {
          existing.count += 1;
        }
      }
      return Array.from(map.values());
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.phone?.toLowerCase().includes(s) ||
      r.body.toLowerCase().includes(s),
    );
  }, [rows, search]);

  const formatDate = (d: string) => {
    const dt = new Date(d);
    if (isToday(dt)) return format(dt, 'h:mm a');
    if (isYesterday(dt)) return 'Yesterday';
    return format(dt, 'MMM d');
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'delivered' || status === 'sent') return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    if (status === 'failed' || status === 'undelivered') return <XCircle className="h-3 w-3 text-destructive" />;
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="h-5 w-5" />
          Sent
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipients..."
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sent messages yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((row) => {
                const initials = row.name
                  .split(' ')
                  .map(p => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '#';
                return (
                  <div
                    key={row.key}
                    onClick={() => onSelect?.({ contact_id: row.contact_id, phone: row.phone, name: row.name })}
                    className={cn(
                      'p-3 cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-3',
                      selectedKey === row.key && 'bg-primary/10',
                    )}
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{row.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2 flex items-center gap-1">
                          <StatusIcon status={row.status} />
                          {formatDate(row.sent_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-sm text-muted-foreground truncate">{row.body || row.phone}</p>
                        {row.count > 1 && (
                          <Badge variant="outline" className="h-5 ml-2 shrink-0">{row.count}</Badge>
                        )}
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
