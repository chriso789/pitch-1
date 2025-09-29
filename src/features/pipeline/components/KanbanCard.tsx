import React, { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GripVertical, X, UserCircle } from "lucide-react";
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

interface SalesRep {
  id: string;
  first_name: string;
  last_name: string;
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
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [showAssignment, setShowAssignment] = useState(false);

  useEffect(() => {
    loadSalesReps();
  }, []);

  const loadSalesReps = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) return;

      const { data: reps } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('tenant_id', profile.tenant_id)
        .in('role', ['admin', 'manager', 'rep', 'master'])
        .eq('is_active', true)
        .order('first_name');

      setSalesReps(reps || []);
    } catch (error) {
      console.error('Error loading sales reps:', error);
    }
  };

  const handleAssignmentChange = async (assignedTo: string) => {
    try {
      const updateData: any = { 
        created_by: assignedTo === 'unassigned' ? null : assignedTo
      };
      
      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', entry.id);

      if (error) throw error;

      toast.success("Assignment updated");
      onAssignmentChange?.();
    } catch (error) {
      console.error('Error updating assignment:', error);
      toast.error("Failed to update assignment");
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

  const assignedRep = salesReps.find(rep => rep.id === entry.assigned_to);

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
        if (!showAssignment) {
          onView(entry.contact_id);
        }
      }}
      onMouseEnter={() => setShowAssignment(true)}
      onMouseLeave={() => setShowAssignment(false)}
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

        {/* Row 2: Last Name or Assignment Selector */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          {showAssignment ? (
            <div className="w-full px-1" onClick={(e) => e.stopPropagation()}>
              <Select
                value={entry.assigned_to || 'unassigned'}
                onValueChange={handleAssignmentChange}
              >
                <SelectTrigger className="h-6 text-xs border-0 bg-muted/50 hover:bg-muted">
                  <SelectValue>
                    {assignedRep ? (
                      <span className="flex items-center gap-1">
                        <UserCircle className="h-3 w-3" />
                        {assignedRep.first_name[0]}{assignedRep.last_name[0]}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <UserCircle className="h-3 w-3" />
                        Unassigned
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {salesReps.map(rep => (
                    <SelectItem key={rep.id} value={rep.id}>
                      {rep.first_name} {rep.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
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
          )}
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