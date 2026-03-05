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
  contactId?: string;
  initialValues: {
    priority: string | null;
    roof_type: string | null;
    roof_age_years: number | null;
    estimated_value: number | null;
  };
  initialContactValues?: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
  };
  initialLeadName?: string | null;
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
  contactId,
  initialValues,
  initialContactValues,
  initialLeadName,
  existingMetadata = {},
  onSave,
}: EditProjectDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [leadName, setLeadName] = useState(initialLeadName || '');
  const [email, setEmail] = useState(initialContactValues?.email || '');
  const [phone, setPhone] = useState(initialContactValues?.phone || '');
  const [priority, setPriority] = useState(initialValues.priority || 'medium');
  const [roofType, setRoofType] = useState(initialValues.roof_type || '');
  const [roofAge, setRoofAge] = useState(initialValues.roof_age_years?.toString() || '');
  const [estimatedValue, setEstimatedValue] = useState(
    initialValues.estimated_value?.toString() || ''
  );

  // Sync state when dialog opens with new values
  React.useEffect(() => {
    if (open) {
      setLeadName(initialLeadName || `${initialContactValues?.first_name || ''} ${initialContactValues?.last_name || ''}`.trim());
      setEmail(initialContactValues?.email || '');
      setPhone(initialContactValues?.phone || '');
      setPriority(initialValues.priority || 'medium');
      setRoofType(initialValues.roof_type || '');
      setRoofAge(initialValues.roof_age_years?.toString() || '');
      setEstimatedValue(initialValues.estimated_value?.toString() || '');
    }
  }, [open]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Update contact email/phone only (NOT name - name is on lead)
      if (contactId) {
        const { error: contactError } = await supabase
          .from('contacts')
          .update({
            email: email || null,
            phone: phone || null,
          })
          .eq('id', contactId);

        if (contactError) throw contactError;
      }

      // Update pipeline entry with lead_name
      const updateData: Record<string, unknown> = {
        lead_name: leadName.trim() || null,
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
        title: 'Lead details updated',
        description: 'All changes have been saved.',
      });

      onSave();
    } catch (error) {
      console.error('Error updating lead details:', error);
      toast({
        title: 'Error',
        description: 'Failed to update lead details.',
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
          <DialogTitle>Edit Lead Details</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Lead Name (stored on pipeline_entries, independent of contact) */}
          <div className="grid gap-2">
            <Label htmlFor="lead_name">Lead / Property Name</Label>
            <Input
              id="lead_name"
              placeholder="e.g. VCA Palm Beach, 123 Main St Roof"
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This name is specific to this lead. Changing it won't affect the contact record.
            </p>
          </div>

          {/* Contact fields (email/phone only) */}
          {contactId && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="border-t my-1" />
            </>
          )}

          {/* Project fields */}
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
