import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface CallDispositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callLog: any;
  onSaved: () => void;
}

export const CallDispositionDialog: React.FC<CallDispositionDialogProps> = ({
  open,
  onOpenChange,
  callLog,
  onSaved
}) => {
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!disposition) {
      toast({
        title: 'Missing disposition',
        description: 'Please select a call outcome.',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('call_logs')
        .update({
          disposition,
          disposition_notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', callLog.id);

      if (error) throw error;

      toast({
        title: 'Disposition saved',
        description: 'Call disposition has been recorded.'
      });

      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving disposition:', error);
      toast({
        title: 'Save failed',
        description: error.message || 'Unable to save disposition.',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Call Summary</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{callLog.status}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Duration</p>
              <p className="font-medium">{formatDuration(callLog.duration_seconds)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="disposition">Call Outcome *</Label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger>
                <SelectValue placeholder="Select outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="connected">Connected - Spoke with contact</SelectItem>
                <SelectItem value="voicemail">Voicemail left</SelectItem>
                <SelectItem value="no_answer">No answer</SelectItem>
                <SelectItem value="busy">Line busy</SelectItem>
                <SelectItem value="wrong_number">Wrong number</SelectItem>
                <SelectItem value="callback_requested">Callback requested</SelectItem>
                <SelectItem value="not_interested">Not interested</SelectItem>
                <SelectItem value="interested">Interested - Follow up needed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this call..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
