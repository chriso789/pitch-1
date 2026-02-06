/**
 * EstimateAttachmentsManager - Manage attachments for an estimate
 * 
 * Allows users to:
 * - View template-linked attachments
 * - Add additional PDF attachments from company documents
 * - Remove attachments from the current estimate
 * - Reorder attachments via drag-and-drop
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Plus,
  X,
  FileText,
  Paperclip,
  FileUp,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TemplateAttachment {
  document_id: string;
  file_path: string;
  filename: string;
  attachment_order: number;
  isFromTemplate?: boolean;
}

interface CompanyDocument {
  id: string;
  filename: string;
  file_path: string;
  document_type: string;
}

interface EstimateAttachmentsManagerProps {
  templateAttachments: TemplateAttachment[];
  additionalAttachments: TemplateAttachment[];
  onAddAttachment: (attachment: TemplateAttachment) => void;
  onRemoveAttachment: (documentId: string) => void;
  onReorderAttachments: (allAttachments: TemplateAttachment[]) => void;
}

// Sortable attachment item component
function SortableAttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: TemplateAttachment;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: attachment.document_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border bg-background hover:bg-muted/50 ${
        isDragging ? 'shadow-lg' : ''
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      
      <FileText className="h-4 w-4 text-blue-500 shrink-0" />
      
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{attachment.filename}</p>
        {attachment.isFromTemplate && (
          <Badge variant="secondary" className="text-[10px] py-0 px-1 mt-0.5">
            From Template
          </Badge>
        )}
      </div>
      
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function EstimateAttachmentsManager({
  templateAttachments,
  additionalAttachments,
  onAddAttachment,
  onRemoveAttachment,
  onReorderAttachments,
}: EstimateAttachmentsManagerProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Combine all attachments for display/reordering
  const allAttachments: TemplateAttachment[] = [
    ...templateAttachments.map(a => ({ ...a, isFromTemplate: true })),
    ...additionalAttachments.map(a => ({ ...a, isFromTemplate: false })),
  ];

  // Fetch company documents for the picker
  const fetchCompanyDocs = async () => {
    setLoadingDocs(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return;

      const { data, error } = await supabase
        .from('documents')
        .select('id, filename, file_path, document_type')
        .eq('tenant_id', tenantId)
        .eq('document_type', 'company_resource')
        .ilike('filename', '%.pdf')
        .order('filename');

      if (error) throw error;
      setCompanyDocs(data || []);
    } catch (err) {
      console.error('Error fetching company docs:', err);
      toast({
        title: 'Error',
        description: 'Failed to load company documents',
        variant: 'destructive',
      });
    } finally {
      setLoadingDocs(false);
    }
  };

  const handleOpenPicker = () => {
    setIsPickerOpen(true);
    fetchCompanyDocs();
  };

  const handleSelectDocument = (doc: CompanyDocument) => {
    // Check if already attached
    const isAlreadyAttached = allAttachments.some(a => a.document_id === doc.id);
    if (isAlreadyAttached) {
      toast({
        title: 'Already Attached',
        description: 'This document is already attached to the estimate',
      });
      return;
    }

    const newAttachment: TemplateAttachment = {
      document_id: doc.id,
      file_path: doc.file_path,
      filename: doc.filename,
      attachment_order: allAttachments.length,
      isFromTemplate: false,
    };

    onAddAttachment(newAttachment);
    setIsPickerOpen(false);

    toast({
      title: 'Attachment Added',
      description: `${doc.filename} will be appended to the estimate PDF`,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = allAttachments.findIndex(a => a.document_id === active.id);
      const newIndex = allAttachments.findIndex(a => a.document_id === over.id);

      const reordered = arrayMove(allAttachments, oldIndex, newIndex).map((a, idx) => ({
        ...a,
        attachment_order: idx,
      }));

      onReorderAttachments(reordered);
    }
  };

  if (allAttachments.length === 0) {
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Paperclip className="h-3 w-3" />
          Attachments
        </h4>
        <div className="p-3 border border-dashed rounded-md text-center">
          <p className="text-xs text-muted-foreground mb-2">No attachments</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenPicker}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Document
          </Button>
        </div>
        
        <DocumentPickerDialog
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          documents={companyDocs}
          loading={loadingDocs}
          onSelect={handleSelectDocument}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        <Paperclip className="h-3 w-3" />
        Attachments ({allAttachments.length})
      </h4>
      
      <div className="space-y-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={allAttachments.map(a => a.document_id)}
            strategy={verticalListSortingStrategy}
          >
            {allAttachments.map(attachment => (
              <SortableAttachmentItem
                key={attachment.document_id}
                attachment={attachment}
                onRemove={() => onRemoveAttachment(attachment.document_id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleOpenPicker}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add Document
      </Button>

      <DocumentPickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        documents={companyDocs}
        loading={loadingDocs}
        onSelect={handleSelectDocument}
      />
    </div>
  );
}

// Document picker dialog component
function DocumentPickerDialog({
  open,
  onOpenChange,
  documents,
  loading,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: CompanyDocument[];
  loading: boolean;
  onSelect: (doc: CompanyDocument) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Add Attachment
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-3">
            Select a PDF from your company documents to append to this estimate.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No PDF documents found</p>
              <p className="text-xs mt-1">Upload PDFs to your Company Documents first</p>
            </div>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {documents.map(doc => (
                  <button
                    key={doc.id}
                    type="button"
                    className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted text-left"
                    onClick={() => onSelect(doc)}
                  >
                    <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="text-sm truncate">{doc.filename}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EstimateAttachmentsManager;
