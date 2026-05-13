import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useContactStatuses, type ContactStatus } from '@/hooks/useContactStatuses';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { ContactKanbanColumn, type ColumnSortKey } from './ContactKanbanColumn';
import { ContactKanbanCard } from './ContactKanbanCard';
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Contact {
  id: string;
  contact_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  lead_score: number | null;
  qualification_status: string | null;
  lead_source: string | null;
  assigned_to?: string | null;
  assigned_rep?: { first_name: string; last_name: string } | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface ContactKanbanBoardProps {
  contacts: Contact[];
  onContactUpdated: () => void;
  onContactStatusChangedLocal?: (contactId: string, newStatus: string | null) => void;
  onCall?: (contact: Contact) => void;
  onEmail?: (contact: Contact) => void;
}

export const ContactKanbanBoard: React.FC<ContactKanbanBoardProps> = ({
  contacts,
  onContactUpdated,
  onContactStatusChangedLocal,
  onCall,
  onEmail,
}) => {
  const { statuses, isLoading: statusesLoading } = useContactStatuses();
  const effectiveTenantId = useEffectiveTenantId();
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [columnSorts, setColumnSorts] = useState<Record<string, ColumnSortKey>>({});

  const getSortKey = (columnId: string): ColumnSortKey =>
    columnSorts[columnId] || 'newest';

  const setColumnSort = (columnId: string, key: ColumnSortKey) =>
    setColumnSorts((prev) => ({ ...prev, [columnId]: key }));

  const sortColumnContacts = (list: Contact[], key: ColumnSortKey): Contact[] => {
    const arr = [...list];
    const nameOf = (c: Contact) =>
      `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase();
    const repNameOf = (c: Contact) =>
      `${c.assigned_rep?.first_name || ''} ${c.assigned_rep?.last_name || ''}`.trim().toLowerCase();
    const numOf = (c: Contact) => parseInt((c.contact_number || '').replace(/\D/g, '') || '0');
    switch (key) {
      case 'oldest':
        return arr.sort((a, b) => numOf(a) - numOf(b));
      case 'name_asc':
        return arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      case 'name_desc':
        return arr.sort((a, b) => nameOf(b).localeCompare(nameOf(a)));
      case 'score_desc':
        return arr.sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0));
      case 'score_asc':
        return arr.sort((a, b) => (a.lead_score || 0) - (b.lead_score || 0));
      case 'rep_asc':
        return arr.sort((a, b) => repNameOf(a).localeCompare(repNameOf(b)));
      case 'newest':
      default:
        return arr.sort((a, b) => numOf(b) - numOf(a));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Filter contacts by search
  const filteredContacts = useMemo(() => {
    if (!searchTerm) return contacts;
    const term = searchTerm.toLowerCase();
    return contacts.filter(c =>
      c.first_name?.toLowerCase().includes(term) ||
      c.last_name?.toLowerCase().includes(term) ||
      c.email?.toLowerCase().includes(term) ||
      c.phone?.includes(term) ||
      c.contact_number?.toLowerCase().includes(term)
    );
  }, [contacts, searchTerm]);

  // Group contacts by qualification status
  const groupedContacts = useMemo(() => {
    const groups: Record<string, Contact[]> = {};
    
    // Initialize groups for all statuses
    statuses.forEach(status => {
      groups[status.key] = [];
    });

    // Also add an "uncategorized" group for contacts without a status
    groups['uncategorized'] = [];

    // Group contacts
    filteredContacts.forEach(contact => {
      const status = (!contact.qualification_status || contact.qualification_status === 'unqualified') ? 'uncategorized' : contact.qualification_status;
      if (groups[status]) {
        groups[status].push(contact);
      } else {
        groups['uncategorized'].push(contact);
      }
    });

    return groups;
  }, [filteredContacts, statuses]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const contact = contacts.find(c => c.id === active.id);
    if (contact) {
      setActiveContact(contact);
    }
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveContact(null);

    if (!over) return;

    const contactId = active.id as string;
    const overId = over.id as string;
    const statusKeys = new Set(statuses.map(status => status.key));
    const targetContact = contacts.find(c => c.id === overId);
    const newStatus = statusKeys.has(overId)
      ? overId
      : targetContact?.qualification_status || over.data.current?.sortable?.containerId || null;

    if (!newStatus || !statusKeys.has(newStatus)) return;

    // Find the contact
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Check if status actually changed
    const previousStatus = contact.qualification_status || 'uncategorized';
    if (previousStatus === newStatus) return;

    // Don't allow dropping to uncategorized
    if (newStatus === 'uncategorized') {
      toast.error("Cannot move to uncategorized");
      return;
    }

    if (!effectiveTenantId) {
      toast.error('Unable to save status without an active company');
      return;
    }

    // Optimistic update — mutate the contact in place so the column re-renders immediately.
    // Avoids a full refetch (which would blank the page with "Loading client data...").
    contact.qualification_status = newStatus;
    if (onContactStatusChangedLocal) {
      onContactStatusChangedLocal(contactId, newStatus);
    }

    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          qualification_status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId)
        .eq('tenant_id', effectiveTenantId)
        .select('id')
        .single();

      if (error) throw error;

      const statusName = statuses.find(s => s.key === newStatus)?.name || newStatus;
      toast.success(`Contact moved to ${statusName}`);
    } catch (error) {
      console.error('Error updating contact status:', error);
      toast.error('Failed to update contact status');
      // Revert optimistic change
      contact.qualification_status = previousStatus === 'uncategorized' ? null : previousStatus;
      if (onContactStatusChangedLocal) {
        onContactStatusChangedLocal(contactId, previousStatus === 'uncategorized' ? null : previousStatus);
      }
    }
  }, [contacts, statuses, effectiveTenantId, onContactStatusChangedLocal]);

  if (statusesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search contacts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 max-h-[calc(100vh-280px)]" style={{ overscrollBehaviorX: 'contain' }}>
          {/* New / Unassigned column FIRST — always visible */}
          {(() => {
            const sorted = sortColumnContacts(
              groupedContacts['uncategorized'] || [],
              getSortKey('uncategorized')
            );
            return (
              <ContactKanbanColumn
                id="uncategorized"
                title="New / Unqualified"
                color="#f59e0b"
                count={sorted.length}
                items={sorted.map((c) => c.id)}
                sortKey={getSortKey('uncategorized')}
                onSortChange={(k) => setColumnSort('uncategorized', k)}
              >
                {sorted.map((contact) => (
                  <ContactKanbanCard
                    key={contact.id}
                    contact={contact}
                    onCall={onCall}
                    onEmail={onEmail}
                  />
                ))}
              </ContactKanbanColumn>
            );
          })()}

          {statuses.map((status) => {
            const sorted = sortColumnContacts(
              groupedContacts[status.key] || [],
              getSortKey(status.key)
            );
            return (
              <ContactKanbanColumn
                key={status.key}
                id={status.key}
                title={status.name}
                color={status.color}
                count={sorted.length}
                items={sorted.map((c) => c.id)}
                sortKey={getSortKey(status.key)}
                onSortChange={(k) => setColumnSort(status.key, k)}
              >
                {sorted.map((contact) => (
                  <ContactKanbanCard
                    key={contact.id}
                    contact={contact}
                    onCall={onCall}
                    onEmail={onEmail}
                  />
                ))}
              </ContactKanbanColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeContact && (
            <ContactKanbanCard
              contact={activeContact}
              onCall={onCall}
              onEmail={onEmail}
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default ContactKanbanBoard;
