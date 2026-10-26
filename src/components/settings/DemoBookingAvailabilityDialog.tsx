import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Send, Loader2 } from 'lucide-react';
import { offeredMeetingSlots } from '@/lib/demoBookingAvailability';

export function DemoBookingAvailabilityDialog({ recipient, busy, onClose, onSend }: {
  recipient: string; busy: boolean; onClose: () => void; onSend: (slots: string[]) => Promise<void>;
}) {
  const [times, setTimes] = useState<string[]>(['']);
  const [error, setError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function submit() {
    try {
      const slots = offeredMeetingSlots(times);
      setError('');
      await onSend(slots);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send booking link.'); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Availability for {recipient}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">30-minute meetings · {timezone}</p>
      <div className="space-y-3">
        {times.map((value, index) => <div key={index} className="flex items-end gap-2">
          <div className="flex-1 min-w-0"><Label htmlFor={`demo-time-${index}`}>Available meeting {index + 1}</Label>
            <Input id={`demo-time-${index}`} type="datetime-local" value={value} disabled={busy}
              onChange={e => setTimes(old => old.map((v, i) => i === index ? e.target.value : v))} /></div>
          <Button variant="ghost" size="icon" title="Remove meeting time" aria-label="Remove meeting time" disabled={busy || times.length === 1}
            onClick={() => setTimes(old => old.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button variant="outline" disabled={busy || times.length >= 500} onClick={() => setTimes(old => [...old, ''])}><Plus className="h-4 w-4 mr-2" />Add another time</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Send Booking Link</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}