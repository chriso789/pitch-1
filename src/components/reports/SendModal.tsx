import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Send, X, Plus, Clock } from 'lucide-react';

interface SendModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packetId: string | null;
  subjectData: any;
  title: string;
}

export function SendModal({ 
  open, 
  onOpenChange, 
  packetId, 
  subjectData,
  title 
}: SendModalProps) {
  const contact = subjectData?.contacts || subjectData;
  
  const [toEmails, setToEmails] = useState<string[]>(
    contact?.email ? [contact.email] : []
  );
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newCcEmail, setNewCcEmail] = useState('');
  const [subject, setSubject] = useState(`Your Report & Estimate - ${title}`);
  const [body, setBody] = useState(
    `Hi ${contact?.first_name || 'there'},\n\nPlease find your personalized report and estimate attached. You can view it online and sign electronically when ready.\n\nIf you have any questions, please don't hesitate to reach out.\n\nBest regards`
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!packetId) throw new Error('No packet ID');
      if (toEmails.length === 0) throw new Error('At least one recipient is required');

      const { data, error } = await supabase.functions.invoke('report-packet-send-resend', {
        body: {
          packet_id: packetId,
          to: toEmails,
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          subject,
          body,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Report Sent!',
        description: `Email sent to ${toEmails.join(', ')}`,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to send',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const addEmail = (type: 'to' | 'cc') => {
    const email = type === 'to' ? newEmail : newCcEmail;
    if (!email || !email.includes('@')) return;
    
    if (type === 'to') {
      if (!toEmails.includes(email)) {
        setToEmails([...toEmails, email]);
      }
      setNewEmail('');
    } else {
      if (!ccEmails.includes(email)) {
        setCcEmails([...ccEmails, email]);
      }
      setNewCcEmail('');
    }
  };

  const removeEmail = (email: string, type: 'to' | 'cc') => {
    if (type === 'to') {
      setToEmails(toEmails.filter(e => e !== email));
    } else {
      setCcEmails(ccEmails.filter(e => e !== email));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Report Packet</DialogTitle>
          <DialogDescription>
            Send the report to your client via email with a secure viewing link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* To Recipients */}
          <div className="space-y-2">
            <Label>To</Label>
            <div className="flex flex-wrap gap-1 mb-2">
              {toEmails.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1">
                  {email}
                  <button onClick={() => removeEmail(email, 'to')}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Add recipient email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmail('to'))}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => addEmail('to')}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* CC Recipients */}
          <div className="space-y-2">
            <Label>CC (optional)</Label>
            <div className="flex flex-wrap gap-1 mb-2">
              {ccEmails.map((email) => (
                <Badge key={email} variant="outline" className="gap-1">
                  {email}
                  <button onClick={() => removeEmail(email, 'cc')}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Add CC email"
                value={newCcEmail}
                onChange={(e) => setNewCcEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmail('cc'))}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => addEmail('cc')}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject line"
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Email message body"
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              A secure link to view the report will be automatically included.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || toEmails.length === 0}
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
