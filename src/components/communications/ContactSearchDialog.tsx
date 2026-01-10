/**
 * Contact Search Dialog
 * Allows searching and selecting an existing contact
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, User, Phone, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContactSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (contactId: string) => void;
  initialPhone?: string;
}

export const ContactSearchDialog = ({
  open,
  onOpenChange,
  onSelect,
  initialPhone,
}: ContactSearchDialogProps) => {
  const tenantId = useEffectiveTenantId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contact-search', tenantId, searchQuery],
    queryFn: async () => {
      if (!tenantId) return [];

      let query = supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email')
        .eq('tenant_id', tenantId)
        .limit(50);

      if (searchQuery) {
        query = query.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`
        );
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Contact search error:', error);
        return [];
      }

      return data;
    },
    enabled: open && !!tenantId,
  });

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
      setSelectedId(null);
      setSearchQuery('');
    }
  };

  const formatPhoneNumber = (phone: string | null) => {
    if (!phone) return null;
    if (phone.startsWith('+1') && phone.length === 12) {
      return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    }
    return phone;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to Contact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {/* Results */}
          <ScrollArea className="h-[300px] border rounded-md">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                Searching...
              </div>
            ) : contacts?.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                No contacts found
              </div>
            ) : (
              <div className="divide-y">
                {contacts?.map((contact) => (
                  <div
                    key={contact.id}
                    onClick={() => setSelectedId(contact.id)}
                    className={cn(
                      'p-3 cursor-pointer hover:bg-accent/50 transition-colors',
                      selectedId === contact.id && 'bg-accent'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-muted">
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {contact.first_name} {contact.last_name}
                        </p>
                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {formatPhoneNumber(contact.phone)}
                            </span>
                          )}
                          {contact.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              <span className="truncate max-w-[150px]">{contact.email}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!selectedId}>
              Link Contact
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
