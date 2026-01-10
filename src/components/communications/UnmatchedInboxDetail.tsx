/**
 * Unmatched Inbox Detail Component
 * Shows details of selected unmatched item with actions
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { 
  Phone, MessageSquare, Link as LinkIcon, UserPlus, Ban, 
  Clock, MapPin, History, ExternalLink
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ContactSearchDialog } from './ContactSearchDialog';
import { CreateContactDialog } from './CreateContactDialog';
import type { UnmatchedInboundItem } from '@/pages/UnmatchedInboxPage';

interface UnmatchedInboxDetailProps {
  item: UnmatchedInboundItem;
  onLinked: () => void;
}

export const UnmatchedInboxDetail = ({ item, onLinked }: UnmatchedInboxDetailProps) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [showContactSearch, setShowContactSearch] = useState(false);
  const [showCreateContact, setShowCreateContact] = useState(false);

  // Fetch history from same phone number
  const { data: history } = useQuery({
    queryKey: ['unmatched-history', tenantId, item.from_e164],
    queryFn: async () => {
      if (!tenantId) return [];

      const { data, error } = await supabase
        .from('unmatched_inbound')
        .select('id, channel, body, state, received_at')
        .eq('tenant_id', tenantId)
        .eq('from_e164', item.from_e164)
        .neq('id', item.id)
        .order('received_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Failed to fetch history:', error);
        return [];
      }

      return data;
    },
    enabled: !!tenantId && !!item.from_e164,
  });

  // Link to contact mutation
  const linkMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.functions.invoke('link-unmatched-to-contact', {
        body: {
          tenant_id: tenantId,
          unmatched_inbound_id: item.id,
          contact_id: contactId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Successfully linked to contact');
      queryClient.invalidateQueries({ queryKey: ['unmatched-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['unmatched-history'] });
      onLinked();
    },
    onError: (error) => {
      console.error('Link failed:', error);
      toast.error('Failed to link to contact');
    },
  });

  // Ignore mutation
  const ignoreMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('unmatched_inbound')
        .update({ state: 'ignored' })
        .eq('id', item.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as ignored');
      queryClient.invalidateQueries({ queryKey: ['unmatched-inbox'] });
      onLinked();
    },
    onError: (error) => {
      console.error('Ignore failed:', error);
      toast.error('Failed to ignore item');
    },
  });

  const handleContactSelected = (contactId: string) => {
    setShowContactSearch(false);
    linkMutation.mutate(contactId);
  };

  const handleContactCreated = (contactId: string) => {
    setShowCreateContact(false);
    linkMutation.mutate(contactId);
  };

  const formatPhoneNumber = (phone: string) => {
    if (phone.startsWith('+1') && phone.length === 12) {
      return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    }
    return phone;
  };

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1 p-4">
        {/* Header Info */}
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {item.channel === 'sms' ? (
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                  <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
              ) : (
                <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                  <Phone className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold">
                  {formatPhoneNumber(item.from_e164)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  To: {formatPhoneNumber(item.to_e164)}
                </p>
              </div>
            </div>
            <Badge
              variant={
                item.state === 'open' ? 'default' :
                item.state === 'linked' ? 'secondary' :
                'outline'
              }
            >
              {item.state}
            </Badge>
          </div>

          {/* Time & Location */}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{format(new Date(item.received_at), 'PPpp')}</span>
              <span className="text-xs">
                ({formatDistanceToNow(new Date(item.received_at), { addSuffix: true })})
              </span>
            </div>
            {item.location_name && (
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{item.location_name}</span>
              </div>
            )}
          </div>

          {/* Message Body */}
          {item.body && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">Message</CardTitle>
              </CardHeader>
              <CardContent className="py-3 pt-0">
                <p className="whitespace-pre-wrap">{item.body}</p>
              </CardContent>
            </Card>
          )}

          {/* Call Details */}
          {item.channel === 'call' && item.event_type && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">Call Details</CardTitle>
              </CardHeader>
              <CardContent className="py-3 pt-0">
                <p>Event: {item.event_type}</p>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          {item.state === 'open' && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button 
                  onClick={() => setShowContactSearch(true)}
                  disabled={linkMutation.isPending}
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Link to Contact
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowCreateContact(true)}
                  disabled={linkMutation.isPending}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create Contact & Link
                </Button>
                <Button 
                  variant="ghost"
                  onClick={() => ignoreMutation.mutate()}
                  disabled={ignoreMutation.isPending}
                >
                  <Ban className="h-4 w-4 mr-2" />
                  Ignore
                </Button>
              </div>
            </>
          )}

          {/* History */}
          {history && history.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Other messages from this number
                </h3>
                <div className="space-y-2">
                  {history.map((h) => (
                    <div 
                      key={h.id} 
                      className="p-2 rounded-lg bg-muted/50 text-sm"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {h.channel === 'sms' ? (
                            <MessageSquare className="h-3 w-3" />
                          ) : (
                            <Phone className="h-3 w-3" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(h.received_at), { addSuffix: true })}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {h.state}
                        </Badge>
                      </div>
                      {h.body && (
                        <p className="text-muted-foreground line-clamp-2">{h.body}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Dialogs */}
      <ContactSearchDialog
        open={showContactSearch}
        onOpenChange={setShowContactSearch}
        onSelect={handleContactSelected}
        initialPhone={item.from_e164}
      />

      <CreateContactDialog
        open={showCreateContact}
        onOpenChange={setShowCreateContact}
        onCreated={handleContactCreated}
        initialPhone={item.from_e164}
      />
    </div>
  );
};
