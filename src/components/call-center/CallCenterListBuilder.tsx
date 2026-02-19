import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Search, Users, Loader2, ListPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { StagnantLeadFilter } from './StagnantLeadFilter';
import { toast } from '@/hooks/use-toast';
import { subDays } from 'date-fns';

interface CallCenterListBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onListCreated: () => void;
}

// Pipeline statuses that indicate a contact is already a project/job
const EXCLUDED_PIPELINE_STATUSES = ['project', 'completed', 'closed'];

export const CallCenterListBuilder: React.FC<CallCenterListBuilderProps> = ({
  open,
  onOpenChange,
  onListCreated,
}) => {
  const tenantId = useEffectiveTenantId();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [stagnantDays, setStagnantDays] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch contact IDs that are in project/completed/closed pipeline stages
  const { data: excludedContactIds } = useQuery({
    queryKey: ['excluded-project-contacts', tenantId],
    queryFn: async () => {
      if (!tenantId) return new Set<string>();
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('contact_id')
        .eq('is_deleted', false)
        .in('status', EXCLUDED_PIPELINE_STATUSES);
      if (error) {
        console.error('Failed to fetch excluded contacts:', error);
        return new Set<string>();
      }
      return new Set((data || []).map(e => e.contact_id));
    },
    enabled: !!tenantId && open,
    staleTime: 60_000,
  });

  // Fetch contacts with phone numbers
  const { data: contacts, isLoading } = useQuery({
    queryKey: ['list-builder-contacts', tenantId, statusFilter, sourceFilter, stagnantDays],
    queryFn: async () => {
      if (!tenantId) return [];
      let query = supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email, qualification_status, lead_source, address_city, address_state, updated_at')
        .eq('tenant_id', tenantId)
        .not('phone', 'is', null)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: true })
        .limit(500);

      if (statusFilter !== 'all') {
        query = query.eq('qualification_status', statusFilter);
      }
      if (sourceFilter !== 'all') {
        query = query.eq('lead_source', sourceFilter);
      }
      if (stagnantDays) {
        const threshold = subDays(new Date(), stagnantDays).toISOString();
        query = query.lt('updated_at', threshold);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId && open,
  });

  // Filter out contacts that are already in project/completed/closed stages
  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    let list = contacts;

    // Exclude project-stage contacts
    if (excludedContactIds && excludedContactIds.size > 0) {
      list = list.filter(c => !excludedContactIds.has(c.id));
    }

    // Apply search filter
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(s) ||
        c.phone?.includes(s) ||
        c.email?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [contacts, search, excludedContactIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleSave = async () => {
    if (!tenantId || !listName.trim() || selectedIds.size === 0) {
      toast({ title: 'Missing info', description: 'Enter a list name and select at least one contact.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { data: list, error: listError } = await supabase
        .from('dialer_lists')
        .insert({
          name: listName.trim(),
          tenant_id: tenantId,
          created_by: user?.id || null,
          total_items: selectedIds.size,
        })
        .select()
        .single();
      if (listError) throw listError;

      const selected = filteredContacts.filter(c => selectedIds.has(c.id));
      const items = selected.map(c => ({
        list_id: list.id,
        tenant_id: tenantId,
        phone: c.phone!,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        created_by: user?.id || null,
        metadata: { contact_id: c.id, qualification_status: c.qualification_status } as any,
      }));

      const { error: itemsError } = await supabase.from('dialer_list_items').insert(items);
      if (itemsError) throw itemsError;

      toast({ title: 'List created', description: `"${listName}" with ${selectedIds.size} contacts.` });
      onListCreated();
      onOpenChange(false);
      setListName('');
      setSelectedIds(new Set());
      setSearch('');
      setStatusFilter('all');
      setSourceFilter('all');
      setStagnantDays(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5" />
            Build Dialer List
          </DialogTitle>
          <DialogDescription>Filter and select contacts to create a callable list. Contacts with active projects are excluded.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0">
          <div className="space-y-1.5">
            <Label>List Name</Label>
            <Input placeholder="e.g. Stagnant Leads - January" value={listName} onChange={e => setListName(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="unqualified">Unqualified</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="not_home">Not Home</SelectItem>
                <SelectItem value="interested">Interested</SelectItem>
                <SelectItem value="not_interested">Not Interested</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="canvassing">Canvassing</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="import">Import</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <StagnantLeadFilter selectedDays={stagnantDays} onSelect={setStagnantDays} />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, phone, email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={filteredContacts.length > 0 && selectedIds.size === filteredContacts.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm text-muted-foreground">Select all</span>
            </div>
            <Badge variant="secondary">
              <Users className="h-3 w-3 mr-1" />
              {selectedIds.size} selected / {filteredContacts.length} shown
            </Badge>
          </div>

          <ScrollArea className="h-[280px] border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">No contacts match filters</div>
            ) : (
              <div className="divide-y">
                {filteredContacts.map(c => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors">
                    <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.first_name} {c.last_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.phone} {c.address_city && `• ${c.address_city}, ${c.address_state || ''}`}</div>
                    </div>
                    {c.qualification_status && (
                      <Badge variant="outline" className="text-xs shrink-0">{c.qualification_status}</Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || selectedIds.size === 0 || !listName.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create List ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
