import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  MapPin, 
  Phone,
  Home,
  DollarSign,
  FileText,
  GripVertical
} from "lucide-react";

interface KanbanCardProps {
  id: string;
  entry: any;
  onView: (contactId: string) => void;
  formatCurrency: (amount: number) => string;
  isDragging?: boolean;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({ 
  id, 
  entry, 
  onView, 
  formatCurrency, 
  isDragging = false 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const contact = entry.contacts;
  const estimate = entry.estimates?.[0];

  const formatName = (contact: any) => {
    if (!contact) return 'Unknown';
    return `${contact.first_name} ${contact.last_name}`;
  };

  const formatAddress = (contact: any) => {
    if (!contact) return 'No address';
    return `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case "high": return "bg-destructive text-destructive-foreground";
      case "medium": return "bg-warning text-warning-foreground"; 
      case "low": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={`shadow-soft border-0 hover:shadow-medium transition-smooth cursor-grab active:cursor-grabbing ${
        isDragging || isSortableDragging ? 'shadow-lg border-primary' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-sm text-muted-foreground">
                {estimate?.estimate_number || `PIPE-${entry.id.slice(-4)}`}
              </span>
            </div>
            <h3 className="font-semibold">{formatName(contact)}</h3>
          </div>
          {entry.priority && (
            <Badge className={getPriorityColor(entry.priority)}>
              {entry.priority}
            </Badge>
          )}
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{formatAddress(contact)}</span>
          </div>
          
          {contact?.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" />
              <span>{contact.phone}</span>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-primary font-medium">
            <Home className="h-4 w-4" />
            <span>{entry.roof_type || 'Roofing Project'}</span>
          </div>
          
          <div className="flex items-center gap-2 font-semibold">
            <DollarSign className="h-4 w-4 text-success" />
            <span>{formatCurrency(estimate?.selling_price || entry.estimated_value)}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onView(contact?.id || entry.contact_id);
            }}
          >
            <FileText className="h-4 w-4 mr-1" />
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};