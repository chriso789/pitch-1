import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, Mail, Eye, Star } from "lucide-react";
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
        "w-full min-w-0 max-w-full min-h-[80px] max-h-[100px]",
        "shadow-soft border-0 hover:shadow-medium transition-all",
        "cursor-grab active:cursor-grabbing relative group overflow-hidden bg-card",
        isDragging && "shadow-2xl scale-105 border-2 border-primary"
      )}>
        <CardContent className="p-1.5 h-full flex flex-col justify-between">
          {/* Header Row: Contact Number + Lead Score */}
          <div className="flex items-center justify-between gap-1">
            <p className="text-[8px] font-mono text-muted-foreground truncate">
              {contact.contact_number}
            </p>
            {contact.lead_score && contact.lead_score > 0 && (
              <div className={cn("flex items-center gap-0.5", getScoreColor(contact.lead_score))}>
                <Star className="h-2 w-2" />
                <span className="text-[8px] font-medium">{contact.lead_score}</span>
              </div>
            )}
          </div>

          {/* Name Row */}
          <h4 className="font-medium text-[10px] truncate text-center py-0.5">
            {contact.first_name} {contact.last_name}
          </h4>

          {/* Actions Row */}
          <div className="flex items-center justify-center gap-0.5 pt-0.5">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-5 px-1.5 text-[8px]"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/contact/${contact.id}`);
              }}
            >
              <Eye className="h-2.5 w-2.5 mr-0.5" />
              View
            </Button>
            {contact.phone && onCall && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-5 px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onCall(contact);
                }}
              >
                <Phone className="h-2.5 w-2.5" />
              </Button>
            )}
            {contact.email && onEmail && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-5 px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onEmail(contact);
                }}
              >
                <Mail className="h-2.5 w-2.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
