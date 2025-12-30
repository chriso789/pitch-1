import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { GripVertical, X, ArrowRight, MoreVertical, FileText, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CLJBadge } from '@/components/CLJBadge';
import { usePrefetchLeadDetails } from '@/hooks/useLeadDetails';

interface KanbanCardProps {
  id: string;
  entry: {
    id: string;
    clj_formatted_number: string;
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
    project?: {
      id: string;
      project_number: string;
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
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [daysSinceLastComm, setDaysSinceLastComm] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const prefetchLeadDetails = usePrefetchLeadDetails();
  const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    transition: isSortableDragging ? 'none' : transition,
    opacity: isSortableDragging ? 0.3 : 1,
    zIndex: isSortableDragging ? 50 : 1,
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

  // Get display number - show job number for approved projects, lead number otherwise
  const getDisplayNumber = () => {
    // If this is an approved project, show the job number
    if (entry.status === 'project' && entry.project?.project_number) {
      return entry.project.project_number; // e.g., "JOB-0001"
    }
    // Otherwise, show the lead number
    return entry.clj_formatted_number || 'No Number'; // e.g., "C010-L010-J010"
  };

  // Get display name with full name support
  const getLastName = () => {
    if (!contact) {
      console.warn('No contact data for pipeline entry:', entry.id);
      return 'Unknown';
    }
    
    // Show full name for better clarity
    if (contact.first_name && contact.last_name) {
      return `${contact.first_name} ${contact.last_name}`;
    }
    
    return contact.last_name || contact.first_name || 'Unknown';
  };

  // Get communication emoji based on recency
  const getCommEmoji = (days: number) => {
    if (days <= 2) return '📞'; // Recent call
    if (days <= 7) return '📧'; // Email
    return '📬'; // Overdue
  };

  const daysInStatus = getDaysInStatus();
  const displayNumber = getDisplayNumber();
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

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!onDelete || isDeleting) return;
    
    setIsDeleting(true);
    try {
      await onDelete(entry.id);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeadDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/lead/${entry.id}`, { state: { from: '/pipeline' } });
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger view if dragging or if clicking on a button
    if (isSortableDragging || (e.target as HTMLElement).closest('button')) {
      return;
    }
    onView(entry.contact_id);
  };

  const handleGeneratePDF = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setGenerating(true);
    
    try {
      // Generate PDF by calling smart-docs-renderer first, then PDF function
      const { data: renderData, error: renderError } = await supabase.functions.invoke('smart-docs-renderer', {
        body: {
          slug: 'asphalt-shingle-photo-report',
          lead_id: entry.id,
          save_instance: true
        }
      });

      if (renderError) throw renderError;

      if (renderData?.instance_id) {
        const { data: pdfData, error: pdfError } = await supabase.functions.invoke('smart-docs-pdf', {
          body: {
            instance_id: renderData.instance_id,
            upload: 'signed',
            filename: `${displayNumber || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`
          }
        });

        if (pdfError) throw pdfError;

        // Open PDF in new tab
        if (pdfData?.pdf_url) {
          window.open(pdfData.pdf_url, '_blank');
          toast.success('PDF generated successfully');
        }
      }
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setGenerating(false);
    }
  };

  const handleEmailPDF = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!contact?.email) {
      toast.error('No email address found for this contact');
      return;
    }

    setGenerating(true);
    
    try {
      const { data: renderData, error: renderError } = await supabase.functions.invoke('smart-docs-renderer', {
        body: {
          slug: 'asphalt-shingle-photo-report',
          lead_id: entry.id,
          save_instance: true
        }
      });

      if (renderError) throw renderError;

      if (renderData?.instance_id) {
          const { data: pdfData, error: pdfError } = await supabase.functions.invoke('smart-docs-pdf', {
            body: {
              instance_id: renderData.instance_id,
              upload: 'signed',
              filename: `${displayNumber || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`,
              to_email: contact.email,
              subject: `Your Roofing Report - ${displayNumber}`,
              message: `Dear ${contact.first_name},\n\nPlease find your roofing report attached.\n\nBest regards`
          }
        });

        if (pdfError) throw pdfError;
        toast.success(`PDF sent to ${contact.email}`);
      }
    } catch (error) {
      console.error('Email PDF error:', error);
      toast.error('Failed to send PDF');
    } finally {
      setGenerating(false);
    }
  };

  // Prefetch lead details on hover (with 150ms delay to avoid unnecessary prefetches)
  const handleMouseEnter = () => {
    prefetchTimeoutRef.current = setTimeout(() => {
      prefetchLeadDetails(entry.id);
    }, 150);
  };

  const handleMouseLeave = () => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "w-full min-w-0 max-w-full min-h-[80px] max-h-[100px]",
        "shadow-soft border-0 hover:shadow-medium transition-smooth",
        "cursor-pointer",
        "relative group overflow-hidden",
        "bg-card",
        isDragging || isSortableDragging ? 'shadow-2xl scale-105 border-2 border-primary rotate-2 animate-pulse z-50' : '',
        isSortableDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      aria-label={`${displayNumber}, ${lastName}, ${daysInStatus} days in status, last contact ${daysSinceLastComm} days ago`}
    >
      <CardContent className="p-1.5 h-full flex flex-col justify-between">
        {/* Row 1: Days Badge + Job Number + Comm Badge */}
        <div className="flex items-center justify-between w-full mb-0.5">
          {/* Days in Status Badge */}
          <Badge 
            className={cn(
              "text-[8px] px-1 py-0.5 border font-medium leading-none",
              getStatusBadgeColor()
            )}
          >
            {daysInStatus}d
          </Badge>

          {/* Display Number - Centered */}
          <div 
            className="flex-1 text-center px-0.5 min-w-0 flex items-center justify-center"
            title={displayNumber}
          >
            <CLJBadge 
              cljNumber={entry.clj_formatted_number} 
              variant="outline" 
              size="sm"
              className="text-[8px] px-1 py-0"
            />
          </div>

          {/* Communication Recency Badge */}
          <Badge 
            className="text-[8px] px-1 py-0.5 bg-muted/10 text-muted-foreground border-muted/20 flex items-center gap-0.5 leading-none"
            title={`Last contact ${daysSinceLastComm} days ago`}
          >
            <span role="img" aria-label="communication status" className="text-[7px]">{commEmoji}</span>
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
                "font-medium text-foreground block truncate px-0.5 text-[10px]",
                lastName.length > 15 ? "group-hover:text-clip" : ""
              )}
            >
              {lastName}
            </span>
          </div>
        </div>

        {/* Lead Details Button (bottom left) */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-0 left-0 h-3.5 w-3.5 p-0 text-primary/70 hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleLeadDetailsClick}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`View lead details for ${displayNumber}`}
        >
          <ArrowRight className="h-2.5 w-2.5" />
        </Button>

        {/* Quick Actions Menu (top right, next to drag handle) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-0 left-0 h-3.5 w-3.5 p-0 text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`Quick actions for ${displayNumber}`}
              disabled={generating}
            >
              <MoreVertical className="h-2.5 w-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={handleGeneratePDF} disabled={generating}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              {generating ? 'Generating...' : 'Download PDF Report'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleEmailPDF} disabled={generating || !contact?.email}>
              <Mail className="h-3.5 w-3.5 mr-2" />
              Email PDF Report
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLeadDetailsClick}>
              <ArrowRight className="h-3.5 w-3.5 mr-2" />
              View Lead Details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete Button (only visible to authorized users on hover) */}
        {canDelete && (
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-0.5 right-0.5 h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/20 opacity-70 group-hover:opacity-100 transition-opacity rounded-sm"
                onClick={handleDeleteClick}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Delete ${displayNumber}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {entry.status === 'project' ? 'Job' : 'Lead'}</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete {displayNumber} for {lastName}? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? 'Deleting...' : `Delete ${entry.status === 'project' ? 'Job' : 'Lead'}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Drag Handle - Visual indicator only */}
        <div
          className="absolute top-0 right-0 h-5 w-5 flex items-center justify-center pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity"
          aria-label="Draggable card"
        >
          <GripVertical 
            className="h-3 w-3 text-muted-foreground"
          />
        </div>
      </CardContent>
    </Card>
  );
};