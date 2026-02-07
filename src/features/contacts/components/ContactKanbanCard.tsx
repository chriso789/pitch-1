import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Mail, MapPin, Eye, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from 'react-router-dom';

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

interface ContactKanbanCardProps {
  contact: Contact;
  onCall?: (contact: Contact) => void;
  onEmail?: (contact: Contact) => void;
}

export const ContactKanbanCard: React.FC<ContactKanbanCardProps> = ({
  contact,
  onCall,
  onEmail,
}) => {
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: contact.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const address = [contact.address_street, contact.address_city, contact.address_state]
    .filter(Boolean)
    .join(', ');

  const getScoreColor = (score: number | null) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 80) return 'text-success';
    if (score >= 50) return 'text-warning';
    return 'text-muted-foreground';
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none w-full",
        isDragging && "opacity-50"
      )}
    >
      <Card className={cn(
        "p-3 cursor-grab active:cursor-grabbing shadow-soft hover:shadow-medium transition-all",
        "border border-border/50 bg-card"
      )}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">
              {contact.contact_number}
            </p>
            <h4 className="font-medium text-sm truncate">
              {contact.first_name} {contact.last_name}
            </h4>
          </div>
          {contact.lead_score && contact.lead_score > 0 && (
            <div className={cn("flex items-center gap-0.5", getScoreColor(contact.lead_score))}>
              <Star className="h-3 w-3" />
              <span className="text-xs font-medium">{contact.lead_score}</span>
            </div>
          )}
        </div>

        {/* Contact Info */}
        <div className="space-y-1 text-xs text-muted-foreground mb-3">
          {contact.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="truncate">{contact.phone}</span>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-1.5">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
          {address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{address}</span>
            </div>
          )}
        </div>

        {/* Lead Source Badge */}
        {contact.lead_source && (
          <Badge variant="secondary" className="text-[10px] mb-2">
            {contact.lead_source.replace(/_/g, ' ')}
          </Badge>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 pt-2 border-t border-border/50">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 px-2 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/contact/${contact.id}`);
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            View
          </Button>
          {contact.phone && onCall && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                onCall(contact);
              }}
            >
              <Phone className="h-3 w-3" />
            </Button>
          )}
          {contact.email && onEmail && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                onEmail(contact);
              }}
            >
              <Mail className="h-3 w-3" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
