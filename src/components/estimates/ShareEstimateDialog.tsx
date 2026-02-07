import React, { useState } from 'react';
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
import { Loader2, Send, Mail, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface ShareEstimateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: string;
  pipelineEntryId?: string;  // Fallback for finding estimate
  contactId?: string;
  customerEmail?: string;
  customerName?: string;
  estimateNumber?: string;
}

export function ShareEstimateDialog({
  open,
  onOpenChange,
  estimateId,
  pipelineEntryId,
  contactId,
  customerEmail = '',
  customerName = '',
  estimateNumber,
}: ShareEstimateDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState(customerEmail);
  const [recipientName, setRecipientName] = useState(customerName);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setRecipientEmail(customerEmail);
      setRecipientName(customerName);
      setSubject('');
      setMessage('');
      setIsSent(false);
    }
  }, [open, customerEmail, customerName]);

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter the recipient email address',
        variant: 'destructive',
      });
      return;
    }

    if (!recipientName.trim()) {
      toast({
        title: 'Name Required',
        description: 'Please enter the recipient name',
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail.trim())) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-quote-email', {
        body: {
          estimate_id: estimateId || undefined,
          pipeline_entry_id: pipelineEntryId || undefined,  // Fallback for finding estimate
          tenant_id: effectiveTenantId || undefined,  // Hint for multi-tenant users
          contact_id: contactId || null,
          recipient_email: recipientEmail.trim(),
          recipient_name: recipientName.trim(),
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
        },
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to send email');
      }

      setIsSent(true);
      toast({
        title: 'Quote Sent! 📧',
        description: `Email sent to ${recipientEmail}. You'll get a text when they view it.`,
      });

      // Close dialog after a short delay
      setTimeout(() => {
        onOpenChange(false);
      }, 2000);

    } catch (error: any) {
      console.error('Error sending quote email:', error);
      toast({
        title: 'Send Failed',
        description: error.message || 'Failed to send quote email',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Share Estimate
          </DialogTitle>
          <DialogDescription>
            Send a trackable email with your estimate. You'll receive an SMS notification when they view it.
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Quote Sent Successfully!</h3>
            <p className="text-sm text-muted-foreground">
              You'll receive a text message when {recipientName.split(' ')[0]} opens the quote.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="recipient-name">Recipient Name</Label>
              <Input
                id="recipient-name"
                placeholder="John Smith"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipient-email">Recipient Email</Label>
              <Input
                id="recipient-email"
                type="email"
                placeholder="john@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">
                Subject <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="subject"
                placeholder={`Your Quote${estimateNumber ? ` #${estimateNumber}` : ''}`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">
                Personal Message <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="message"
                placeholder="Thanks for your interest! I've prepared a quote for your project..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {!isSent && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
                Cancel
              </Button>
              <Button onClick={handleSend} disabled={isSending}>
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Quote
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
