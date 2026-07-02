import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Mail, User, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportPhotoReport } from '@/lib/photos/exportPhotoReport';
import type { CustomerPhoto } from '@/hooks/usePhotos';

interface PhotoEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: CustomerPhoto[];
  contactId?: string;
  leadId?: string;
  propertyAddress?: string;
  reportTitle?: string;
}

interface ContactSummary {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tenant_id: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitEmails = (s: string) =>
  s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);

export const PhotoEmailDialog: React.FC<PhotoEmailDialogProps> = ({
  open,
  onOpenChange,
  photos,
  contactId,
  leadId,
  propertyAddress,
  reportTitle,
}) => {
  const [contact, setContact] = useState<ContactSummary | null>(null);
  const [teamEmails, setTeamEmails] = useState<string[]>([]);
  const [sendToHomeowner, setSendToHomeowner] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Load contact + tenant teammates when opened
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      if (!contactId) return;
      const { data: c } = await supabase
        .from('contacts')
        .select('email, first_name, last_name, tenant_id')
        .eq('id', contactId)
        .maybeSingle();
      if (cancelled || !c) return;
      setContact(c as ContactSummary);
      if (c.email && EMAIL_RE.test(c.email)) setSendToHomeowner(true);

      // Load own team (same tenant)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('email, first_name, last_name')
        .eq('tenant_id', c.tenant_id)
        .not('email', 'is', null)
        .limit(50);
      if (cancelled) return;
      const emails = (profiles || [])
        .map(p => (p.email || '').trim().toLowerCase())
        .filter(e => EMAIL_RE.test(e));
      setTeamEmails(Array.from(new Set(emails)));
    })();

    // Prefill subject/message
    setSubject(
      reportTitle
        ? `${reportTitle}`
        : `Photo Report${propertyAddress ? ` — ${propertyAddress}` : ''}`,
    );
    setMessage(
      `Attached is the photo report${propertyAddress ? ` for ${propertyAddress}` : ''}. Let us know if you have any questions.`,
    );

    return () => { cancelled = true; };
  }, [open, contactId, reportTitle, propertyAddress]);

  const homeownerName = useMemo(() => {
    if (!contact) return '';
    return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  }, [contact]);

  const resolvedRecipients = useMemo(() => {
    const set = new Set<string>();
    if (sendToHomeowner && contact?.email && EMAIL_RE.test(contact.email)) {
      set.add(contact.email.trim().toLowerCase());
    }
    selectedTeam.forEach(e => set.add(e));
    splitEmails(extra).forEach(e => {
      if (EMAIL_RE.test(e)) set.add(e.toLowerCase());
    });
    return Array.from(set);
  }, [sendToHomeowner, contact, selectedTeam, extra]);

  const toggleTeam = (email: string, checked: boolean) => {
    setSelectedTeam(prev => {
      const next = new Set(prev);
      if (checked) next.add(email); else next.delete(email);
      return next;
    });
  };

  const handleSend = async () => {
    if (resolvedRecipients.length === 0) {
      toast({ title: 'Add at least one recipient', variant: 'destructive' });
      return;
    }
    if (!contact?.tenant_id) {
      toast({ title: 'Missing tenant', description: 'Could not resolve your company.', variant: 'destructive' });
      return;
    }
    if (photos.length === 0) {
      toast({ title: 'No photos to send', variant: 'destructive' });
      return;
    }

    setIsSending(true);
    const buildingToast = toast({
      title: 'Building photo report…',
      description: 'Generating PDF, then sending email.',
    });

    try {
      const { base64, filename } = await exportPhotoReport({
        photos,
        title: reportTitle || 'Photo Report',
        propertyAddress,
        output: 'blob',
      });

      const { data, error } = await supabase.functions.invoke('send-photo-report-email', {
        body: {
          lead_id: leadId ?? null,
          contact_id: contactId ?? null,
          tenant_id: contact.tenant_id,
          recipients: resolvedRecipients,
          recipient_name: sendToHomeowner && homeownerName ? homeownerName : 'there',
          subject,
          message,
          property_address: propertyAddress,
          photo_count: photos.length,
          pdf_base64: base64,
          filename,
        },
      });

      buildingToast.dismiss();

      if (error || (data as any)?.success === false) {
        const msg = (data as any)?.error || error?.message || 'Email failed';
        throw new Error(msg);
      }

      toast({
        title: 'Photo report sent',
        description: `Sent to ${resolvedRecipients.length} recipient${resolvedRecipients.length !== 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
      setExtra('');
      setSelectedTeam(new Set());
    } catch (err) {
      buildingToast.dismiss();
      console.error('Photo report email failed', err);
      toast({
        title: 'Could not send photo report',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isSending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Photo Report
          </DialogTitle>
          <DialogDescription>
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
            {propertyAddress ? ` · ${propertyAddress}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Homeowner */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <User className="h-3.5 w-3.5" /> Homeowner
            </div>
            {contact?.email ? (
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={sendToHomeowner}
                  onCheckedChange={(c) => setSendToHomeowner(!!c)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{homeownerName || 'Homeowner'}</span>
                  <span className="text-muted-foreground"> · {contact.email}</span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">No email on file for this contact.</p>
            )}
          </div>

          {/* Team */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-3.5 w-3.5" /> Internal team
              <Badge variant="secondary" className="ml-auto">{selectedTeam.size} selected</Badge>
            </div>
            {teamEmails.length === 0 ? (
              <p className="text-xs text-muted-foreground">No teammates found.</p>
            ) : (
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {teamEmails.map(email => (
                  <label key={email} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedTeam.has(email)}
                      onCheckedChange={(c) => toggleTeam(email, !!c)}
                    />
                    <span>{email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-extra">Other recipients (comma-separated)</Label>
            <Input
              id="pr-extra"
              placeholder="name@example.com, someone@else.com"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-subject">Subject</Label>
            <Input id="pr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-message">Message</Label>
            <Textarea
              id="pr-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {resolvedRecipients.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Sending to: {resolvedRecipients.join(', ')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending || resolvedRecipients.length === 0}>
            {isSending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending…</>
            ) : (
              <><Mail className="h-4 w-4 mr-1.5" /> Send Report</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PhotoEmailDialog;
