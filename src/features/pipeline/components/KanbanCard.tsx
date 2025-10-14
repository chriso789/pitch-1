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
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [daysSinceLastComm, setDaysSinceLastComm] = useState<number>(0);
  const [generating, setGenerating] = useState(false);

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

  // Get job number - use the job_number field directly
  const getJobNumber = () => {
    return entry.job_number || entry.name || 'New Job';
  };

  // Get last name only
  const getLastName = () => {
    if (!contact) return 'Unknown';
    const lastName = contact.last_name || contact.first_name || 'Unknown';
    // Show assignment status for entries without assigned_to
    if (!entry.assigned_to) {
      return `${lastName}`;
    }
    return lastName;
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

  const handleLeadDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/lead/${entry.id}`);
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
            filename: `${entry.job_number || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`
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
            filename: `${entry.job_number || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`,
            to_email: contact.email,
            subject: `Your Roofing Report - ${entry.job_number}`,
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

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "w-full min-w-0 max-w-full min-h-[70px] max-h-[90px]",
        "shadow-soft border-0 hover:shadow-medium transition-smooth",
        "cursor-pointer",
        "relative group overflow-hidden",
        "bg-card",
        isDragging || isSortableDragging ? 'shadow-2xl scale-105 border-2 border-primary rotate-2 animate-pulse z-50' : '',
        isSortableDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={`Job ${jobNumber}, ${lastName}, ${daysInStatus} days in status, last contact ${daysSinceLastComm} days ago`}
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

          {/* Job Number - Centered */}
          <div 
            className="flex-1 text-center px-0.5 min-w-0"
            title={jobNumber}
          >
            <span 
              className="font-mono font-semibold text-foreground block truncate text-[9px]"
            >
              {jobNumber}
            </span>
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
          aria-label={`View lead details for ${jobNumber}`}
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
              aria-label={`Quick actions for ${jobNumber}`}
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
                className="absolute bottom-0 right-0 h-3.5 w-3.5 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleDeleteClick}
                aria-label={`Delete job ${jobNumber}`}
              >
                <X className="h-2.5 w-2.5" />
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

        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-0 right-0 h-5 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted/20 rounded"
          aria-label="Drag to move card"
        >
          <GripVertical 
            className="h-3 w-3 text-muted-foreground"
          />
        </div>
      </CardContent>
    </Card>
  );
};