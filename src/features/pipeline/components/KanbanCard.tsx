import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface KanbanCardProps {
  id: string;
  entry: {
    id: string;
    job_number: string;
    name: string;
    status: string;
    created_at: string;
    contact_id: string;
    assigned_to?: string;
    contacts: {
      id: string;
      contact_number: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
      address_street: string;
      address_city: string;
      address_state: string;
      address_zip: string;
    };
    projects?: {
      id: string;
      name: string;
    };
  };
  onView: (contactId: string) => void;
  onDelete?: (jobId: string) => void;
  canDelete?: boolean;
  isDragging?: boolean;
  onAssignmentChange?: () => void;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  id, 
  entry, 
  onView, 
  onDelete,
  canDelete = false,
  isDragging = false,
  onAssignmentChange
}) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [daysSinceLastComm, setDaysSinceLastComm] = useState<number>(0);
  
  // Drag detection refs
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);
  const DRAG_THRESHOLD = 5; // pixels

  useEffect(() => {
    if (entry.contact_id) {
      fetchLastCommunication();
    }
  }, [entry.contact_id]);

  const fetchLastCommunication = async () => {
    try {
      const { data } = await supabase
        .from('communication_history')
        .select('created_at')
        .eq('contact_id', entry.contact_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.created_at) {
        const lastComm = new Date(data.created_at);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - lastComm.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setDaysSinceLastComm(diffDays);
      } else {
        setDaysSinceLastComm(99); // Show 99+ if no communication found
      }
    } catch (error) {
      console.error('Error fetching last communication:', error);
      setDaysSinceLastComm(99);
    }
  };
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

  // Calculate days in status (based on created_at)
  const getDaysInStatus = () => {
    if (entry.created_at) {
      const created = new Date(entry.created_at);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - created.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    }
    return 1; // Default to 1 day
  };

  // Get job number - use the job_number field directly
  const getJobNumber = () => {
    return entry.job_number || entry.name || 'New Job';
  };

  // Get last name only
  const getLastName = () => {
    if (!contact) return 'Unknown';
    return contact.last_name || contact.first_name || 'Unknown';
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
  const commEmoji = getCommEmoji(daysSinceLastComm);

  // Get status badge color
  const getStatusBadgeColor = () => {
    if (daysInStatus <= 7) return "bg-success/10 text-success border-success/20";
    if (daysInStatus <= 21) return "bg-warning/10 text-warning border-warning/20"; 
    return "bg-destructive/10 text-destructive border-destructive/20";
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete(entry.id);
    }
    setShowDeleteDialog(false);
  };

  // Pointer event handlers to detect click vs drag
  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    hasDragged.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartPos.current) {
      const deltaX = Math.abs(e.clientX - dragStartPos.current.x);
      const deltaY = Math.abs(e.clientY - dragStartPos.current.y);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        hasDragged.current = true;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // Only trigger view if it was a click (not a drag)
    if (!hasDragged.current && dragStartPos.current) {
      e.stopPropagation();
      onView(entry.contact_id);
    }
    dragStartPos.current = null;
    hasDragged.current = false;
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="button"
      tabIndex={0}
      aria-label={`Job ${jobNumber}, ${lastName}, ${daysInStatus} days in status, last contact ${daysSinceLastComm} days ago`}
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
            title={`Last contact ${daysSinceLastComm} days ago`}
          >
            <span role="img" aria-label="communication status" className="text-[8px]">{commEmoji}</span>
            <span>{daysSinceLastComm > 99 ? '99+' : `${daysSinceLastComm}`}d</span>
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

        {/* Delete Button (only visible to authorized users on hover) */}
        {canDelete && (
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-0.5 left-0.5 h-4 w-4 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleDeleteClick}
                aria-label={`Delete job ${jobNumber}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Job</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete job {jobNumber} for {lastName}? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete Job
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Drag Handle (hidden, accessible via keyboard/screen reader) */}
        <GripVertical 
          className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        />
      </CardContent>
    </Card>
  );
};