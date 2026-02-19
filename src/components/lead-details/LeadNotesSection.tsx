import React, { useState, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';

interface LeadNotesSectionProps {
  pipelineEntryId: string;
  initialNotes?: string | null;
  onNotesUpdate?: () => void;
}

export function LeadNotesSection({ 
  pipelineEntryId, 
  initialNotes,
  onNotesUpdate 
}: LeadNotesSectionProps) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const debouncedNotes = useDebounce(notes, 1500);

  useEffect(() => {
    if (initialNotes !== undefined && initialNotes !== null) {
      setNotes(initialNotes);
    }
  }, [initialNotes]);

  useEffect(() => {
    if (hasUnsavedChanges && debouncedNotes !== initialNotes) {
      handleSave();
    }
  }, [debouncedNotes]);

  const handleSave = async () => {
    if (notes === initialNotes) {
      setHasUnsavedChanges(false);
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ notes })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      setHasUnsavedChanges(false);
      onNotesUpdate?.();
    } catch (error) {
      console.error('Error saving notes:', error);
      toast({
        title: 'Error saving notes',
        description: 'Please try again',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasUnsavedChanges(true);
  };

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleBlur = () => {
    // Collapse back to one-liner after a short delay (allow save to trigger)
    setTimeout(() => setIsExpanded(false), 200);
  };

  if (!isExpanded) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          type="button"
          onClick={handleExpand}
          className="flex-1 min-w-0 text-left text-sm truncate px-2 py-1 rounded border border-transparent hover:border-border hover:bg-muted/50 transition-colors cursor-text"
        >
          {notes ? (
            <span className="text-foreground">{notes}</span>
          ) : (
            <span className="text-muted-foreground">Add notes...</span>
          )}
        </button>
        {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <Textarea
        ref={textareaRef}
        value={notes}
        onChange={(e) => handleNotesChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add notes about this lead..."
        className="min-h-[80px] resize-none text-sm"
      />
      {hasUnsavedChanges && (
        <span className="text-[10px] text-muted-foreground">
          {isSaving ? 'Saving...' : 'Auto-saves'}
        </span>
      )}
    </div>
  );
}
