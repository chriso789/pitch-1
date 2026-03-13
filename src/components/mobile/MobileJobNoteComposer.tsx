import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { markPendingSync, cacheRecord } from '@/lib/mobileCache';
import { logMobileActivity } from '@/lib/mobileActivityLogger';
import PendingSyncBadge from './PendingSyncBadge';
import { useToast } from '@/hooks/use-toast';
import { Send } from 'lucide-react';

const NOTE_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'sales', label: 'Sales' },
  { value: 'production', label: 'Production' },
  { value: 'supplement', label: 'Supplement' },
];

interface MobileJobNoteComposerProps {
  jobId: string;
  userId: string;
  tenantId: string;
  contactId?: string;
  onNoteSaved?: () => void;
}

const MobileJobNoteComposer = ({
  jobId,
  userId,
  tenantId,
  contactId,
  onNoteSaved,
}: MobileJobNoteComposerProps) => {
  const [body, setBody] = useState('');
  const [noteType, setNoteType] = useState('general');
  const [synced, setSynced] = useState<boolean | null>(null);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!body.trim()) return;

    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();

    const notePayload = {
      tenant_id: tenantId,
      job_id: jobId,
      contact_id: contactId || null,
      user_id: userId,
      note_type: noteType,
      body: body.trim(),
      created_at: now,
    };

    // Cache locally immediately
    await cacheRecord('notes', noteId, { id: noteId, ...notePayload, offline_created: true });

    // Queue for sync
    await markPendingSync('notes', noteId, 'create_note', notePayload);

    setSynced(false);
    logMobileActivity({ activity_type: 'offline_note_created', entity_type: 'job', entity_id: jobId });

    toast({ title: 'Note saved', description: 'Will sync when online' });
    setBody('');
    onNoteSaved?.();
  };

  return (
    <div className="space-y-3 p-4 bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Add Note</h3>
        {synced !== null && <PendingSyncBadge synced={synced} />}
      </div>

      <Select value={noteType} onValueChange={setNoteType}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NOTE_TYPES.map(t => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Textarea
        placeholder="Type your note..."
        value={body}
        onChange={e => setBody(e.target.value)}
        className="min-h-[80px] resize-none"
      />

      <Button onClick={handleSave} disabled={!body.trim()} size="sm" className="w-full">
        <Send className="h-4 w-4 mr-2" />
        Save Note
      </Button>
    </div>
  );
};

export default MobileJobNoteComposer;
