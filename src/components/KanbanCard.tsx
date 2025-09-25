import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanCardProps {
  id: string;
  entry: any;
  onView: (contactId: string) => void;
  isDragging?: boolean;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({ 
  id, 
  entry, 
  onView, 
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

  // Calculate days in status (mock calculation based on created_at)
  const getDaysInStatus = () => {
    if (entry.created_at) {
      const created = new Date(entry.created_at);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - created.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    }
    return Math.floor(Math.random() * 45) + 1; // Mock data
  };

  // Get job number using Contact-Lead-Job sequencing
  const getJobNumber = () => {
    if (!contact) return 'Unknown';
    
    // Extract contact number from contact_number field (format: "XX-XX")
    const contactNum = contact.contact_number?.split('-')[0] || '1';
    
    // For now, use pipeline entry ID to simulate lead sequence
    const leadNum = entry.lead_sequence || Math.floor(Math.random() * 20) + 1;
    
    // Job number only shows when approved (has estimate), otherwise shows 0
    const jobNum = estimate?.estimate_number ? 
      (entry.job_sequence || Math.floor(Math.random() * 5) + 1) : 0;
    
    return `${contactNum}-${leadNum}-${jobNum}`;
  };

  // Get last name only
  const getLastName = () => {
    if (!contact) return 'Unknown';
    return contact.last_name || contact.first_name || 'Unknown';
  };

  // Calculate days since last communication (mock data for now)
  const getDaysSinceLastComm = () => {
    return Math.floor(Math.random() * 14) + 1; // Mock: 1-14 days
  };

  // Get communication emoji based on recency
  const getCommEmoji = (days: number) => {
    if (days <= 2) return '📞'; // Recent call
    if (days <= 7) return '📧'; // Email
    return '📬'; // Overdue
  };

  const daysInStatus = getDaysInStatus();
  const jobNumber = getJobNumber();
  const lastName = getLastName();
  const daysSinceComm = getDaysSinceLastComm();
  const commEmoji = getCommEmoji(daysSinceComm);

  // Get status badge color
  const getStatusBadgeColor = () => {
    if (daysInStatus <= 7) return "bg-success/10 text-success border-success/20";
    if (daysInStatus <= 21) return "bg-warning/10 text-warning border-warning/20"; 
    return "bg-destructive/10 text-destructive border-destructive/20";
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "w-full min-w-0 max-w-full min-h-[80px] max-h-[100px]",
        "shadow-soft border-0 hover:shadow-medium transition-smooth",
        "cursor-grab active:cursor-grabbing",
        "relative group overflow-hidden",
        isDragging || isSortableDragging ? 'shadow-lg border-primary' : ''
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onView(contact?.id || entry.contact_id);
      }}
      role="button"
      tabIndex={0}
      aria-label={`Job ${jobNumber}, ${lastName}, ${daysInStatus} days in status, last contact ${daysSinceComm} days ago`}
    >
      <CardContent className="p-2 h-full flex flex-col justify-between">
        {/* Row 1: Days Badge + Job Number + Comm Badge */}
        <div className="flex items-center justify-between w-full mb-0.5">
          {/* Days in Status Badge */}
          <Badge 
            className={cn(
              "text-[10px] px-1.5 py-0.5 border font-medium leading-none",
              getStatusBadgeColor()
            )}
          >
            {daysInStatus}d
          </Badge>

          {/* Job Number - Centered */}
          <div 
            className="flex-1 text-center px-1 min-w-0"
            title={jobNumber}
          >
            <span 
              className="font-mono font-semibold text-foreground block truncate"
              style={{ fontSize: 'clamp(10px, 2.5vw, 12px)' }}
            >
              {jobNumber}
            </span>
          </div>

          {/* Communication Recency Badge */}
          <Badge 
            className="text-[10px] px-1.5 py-0.5 bg-muted/10 text-muted-foreground border-muted/20 flex items-center gap-0.5 leading-none"
            title={`Last contact ${daysSinceComm} days ago`}
          >
            <span role="img" aria-label="communication status" className="text-[8px]">{commEmoji}</span>
            <span>{daysSinceComm}d</span>
          </Badge>
        </div>

        {/* Row 2: Last Name */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div 
            className="text-center w-full min-w-0"
            title={lastName}
          >
            <span 
              className={cn(
                "font-medium text-foreground block truncate px-1",
                lastName.length > 15 ? "group-hover:text-clip" : ""
              )}
              style={{ fontSize: 'clamp(10px, 2.5vw, 13px)' }}
            >
              {lastName}
            </span>
          </div>
        </div>

        {/* Drag Handle (hidden, accessible via keyboard/screen reader) */}
        <GripVertical 
          className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        />
      </CardContent>
    </Card>
  );
};