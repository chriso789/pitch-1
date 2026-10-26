import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Send, Loader2, CalendarIcon } from 'lucide-react';
import { meetingSlotsFromRanges, type AvailabilityWindow } from '@/lib/demoBookingAvailability';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfDay } from 'date-fns';

export function DemoBookingAvailabilityDialog({ recipient, busy, onClose, onSend }: {
  recipient: string; busy: boolean; onClose: () => void; onSend: (slots: string[]) => Promise<void>;
}) {
  const [windows, setWindows] = useState<AvailabilityWindow[]>([{ startTime: '09:00', endTime: '17:00' }]);
  const [error, setError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function update(index: number, values: Partial<AvailabilityWindow>) {
    setWindows(old => old.map((window, i) => i === index ? { ...window, ...values } : window));
    setError('');
  }
  let count = 0;
  let validation = '';
  try { count = meetingSlotsFromRanges(windows).length; }
  catch (e) { validation = e instanceof Error ? e.message : 'Choose availability.'; }
  async function submit() {
    try {
      const slots = meetingSlotsFromRanges(windows);
      setError('');
      await onSend(slots);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send booking link.'); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Availability for {recipient}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">30-minute meetings · {timezone}</p>
      <div className="space-y-3">
        {windows.map((window, index) => <div key={index} className="flex items-start gap-2 border-b pb-4">
          <div className="flex-1 min-w-0 space-y-3">
            <Label htmlFor={`demo-range-${index}`}>Date range {index + 1}</Label>
            <Popover>
              <PopoverTrigger asChild><Button id={`demo-range-${index}`} variant="outline" disabled={busy} className="w-full justify-start h-auto min-h-10 text-left whitespace-normal">
                <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
                {window.from ? `${format(window.from, 'MMM d, yyyy')}${window.to ? ` – ${format(window.to, 'MMM d, yyyy')}` : ' – End date'}` : 'Choose dates'}
              </Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={{ from: window.from, to: window.to }}
                  onSelect={range => update(index, { from: range?.from, to: range?.to })}
                  disabled={{ before: startOfDay(new Date()) }} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor={`demo-start-${index}`}>Daily start time</Label>
                <Input id={`demo-start-${index}`} type="time" value={window.startTime} disabled={busy} onChange={e => update(index, { startTime: e.target.value })} /></div>
              <div><Label htmlFor={`demo-end-${index}`}>Daily end time</Label>
                <Input id={`demo-end-${index}`} type="time" value={window.endTime} disabled={busy} onChange={e => update(index, { endTime: e.target.value })} /></div>
            </div>
          </div>
          <Button variant="ghost" size="icon" title="Remove availability range" aria-label="Remove availability range" disabled={busy || windows.length === 1}
            onClick={() => setWindows(old => old.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button variant="outline" disabled={busy || windows.length >= 500} onClick={() => setWindows(old => [...old, { startTime: '09:00', endTime: '17:00' }])}><Plus className="h-4 w-4 mr-2" />Add another range</Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">{count ? `${count} available 30-minute meetings` : validation}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy || count === 0} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Send Booking Link</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}