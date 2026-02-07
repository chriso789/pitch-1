import React, { useState, useMemo, useCallback } from 'react';
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
import { useContactStatuses, type ContactStatus } from '@/hooks/useContactStatuses';
import { ContactKanbanColumn } from './ContactKanbanColumn';
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
}

interface ContactKanbanBoardProps {
  contacts: Contact[];
  onContactUpdated: () => void;
  onCall?: (contact: Contact) => void;
  onEmail?: (contact: Contact) => void;
}

export const ContactKanbanBoard: React.FC<ContactKanbanBoardProps> = ({
  contacts,
  onContactUpdated,
  onCall,
  onEmail,
}) => {
  const { statuses, isLoading: statusesLoading } = useContactStatuses();
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

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
      const status = contact.qualification_status || 'uncategorized';
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
    const newStatus = over.id as string;
    
    // Find the contact
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Check if status actually changed
    const currentStatus = contact.qualification_status || 'uncategorized';
    if (currentStatus === newStatus) return;

    // Don't allow dropping to uncategorized
    if (newStatus === 'uncategorized') {
      toast.error("Cannot move to uncategorized");
      return;
    }

    try {
      const { error } = await supabase
        .from('contacts')
        .update({ 
          qualification_status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);

      if (error) throw error;

      const statusName = statuses.find(s => s.key === newStatus)?.name || newStatus;
      toast.success(`Contact moved to ${statusName}`);
      onContactUpdated();
    } catch (error) {
      console.error('Error updating contact status:', error);
      toast.error('Failed to update contact status');
    }
  }, [contacts, statuses, onContactUpdated]);

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
        <div className="flex gap-4 overflow-x-auto pb-4">
          {statuses.map((status) => (
            <ContactKanbanColumn
              key={status.key}
              id={status.key}
              title={status.name}
              color={status.color}
              count={groupedContacts[status.key]?.length || 0}
              items={groupedContacts[status.key]?.map(c => c.id) || []}
            >
              {groupedContacts[status.key]?.map((contact) => (
                <ContactKanbanCard
                  key={contact.id}
                  contact={contact}
                  onCall={onCall}
                  onEmail={onEmail}
                />
              ))}
            </ContactKanbanColumn>
          ))}

          {/* Uncategorized column if there are contacts without status */}
          {groupedContacts['uncategorized']?.length > 0 && (
            <ContactKanbanColumn
              id="uncategorized"
              title="Uncategorized"
              color="#94a3b8"
              count={groupedContacts['uncategorized'].length}
              items={groupedContacts['uncategorized'].map(c => c.id)}
            >
              {groupedContacts['uncategorized'].map((contact) => (
                <ContactKanbanCard
                  key={contact.id}
                  contact={contact}
                  onCall={onCall}
                  onEmail={onEmail}
                />
              ))}
            </ContactKanbanColumn>
          )}
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
