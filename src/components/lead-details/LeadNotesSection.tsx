import React, { useState, useEffect, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Save, StickyNote } from 'lucide-react';
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
  
  const debouncedNotes = useDebounce(notes, 1500);

  // Sync with initial notes when they change
  useEffect(() => {
    if (initialNotes !== undefined && initialNotes !== null) {
      setNotes(initialNotes);
    }
  }, [initialNotes]);

  // Auto-save when debounced notes change
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StickyNote className="h-4 w-4" />
          <span>Lead Notes</span>
        </div>
        {hasUnsavedChanges && (
          <span className="text-xs text-muted-foreground">
            {isSaving ? 'Saving...' : 'Unsaved changes'}
          </span>
        )}
      </div>
      
      <Textarea
        value={notes}
        onChange={(e) => handleNotesChange(e.target.value)}
        placeholder="Add notes about this lead..."
        className="min-h-[120px] resize-none text-sm"
      />
      
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="h-7 text-xs"
        >
          {isSaving ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Save className="h-3 w-3 mr-1" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
