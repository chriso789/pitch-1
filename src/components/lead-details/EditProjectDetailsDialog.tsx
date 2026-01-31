import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface EditProjectDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  initialValues: {
    priority: string | null;
    roof_type: string | null;
    roof_age_years: number | null;
    estimated_value: number | null;
  };
  existingMetadata?: Record<string, unknown>;
  onSave: () => void;
}

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const ROOF_TYPE_OPTIONS = [
  { value: 'shingle', label: 'Shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'flat', label: 'Flat' },
  { value: 'slate', label: 'Slate' },
  { value: 'cedar', label: 'Cedar' },
  { value: 'other', label: 'Other' },
];

export function EditProjectDetailsDialog({
  open,
  onOpenChange,
  pipelineEntryId,
  initialValues,
  existingMetadata = {},
  onSave,
}: EditProjectDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [priority, setPriority] = useState(initialValues.priority || 'medium');
  const [roofType, setRoofType] = useState(initialValues.roof_type || '');
  const [roofAge, setRoofAge] = useState(initialValues.roof_age_years?.toString() || '');
  const [estimatedValue, setEstimatedValue] = useState(
    initialValues.estimated_value?.toString() || ''
  );

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const updateData: Record<string, unknown> = {
        priority,
        roof_type: roofType || null,
        estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
        metadata: {
          ...existingMetadata,
          roof_age_years: roofAge ? parseInt(roofAge, 10) : null,
        },
      };

      const { error } = await supabase
        .from('pipeline_entries')
        .update(updateData)
        .eq('id', pipelineEntryId);

      if (error) throw error;

      toast({
        title: 'Project details updated',
        description: 'The project information has been saved.',
      });

      onSave();
    } catch (error) {
      console.error('Error updating project details:', error);
      toast({
        title: 'Error',
        description: 'Failed to update project details.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Project Details</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="priority">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="roof_type">Roof Type</Label>
            <Select value={roofType} onValueChange={setRoofType}>
              <SelectTrigger id="roof_type">
                <SelectValue placeholder="Select roof type" />
              </SelectTrigger>
              <SelectContent>
                {ROOF_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="roof_age">Roof Age (years)</Label>
            <Input
              id="roof_age"
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 15"
              value={roofAge}
              onChange={(e) => setRoofAge(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="estimated_value">Estimated Value ($)</Label>
            <Input
              id="estimated_value"
              type="number"
              min="0"
              step="100"
              placeholder="e.g. 15000"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
