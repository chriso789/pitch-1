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
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Send, Mail, CheckCircle, FileSignature, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface ShareEstimateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: string;
  pipelineEntryId?: string;
  contactId?: string;
  customerEmail?: string;
  customerName?: string;
  estimateNumber?: string;
  estimateDisplayName?: string;
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
  estimateDisplayName,
}: ShareEstimateDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState(customerEmail);
  const [recipientName, setRecipientName] = useState(customerName);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [requestSignature, setRequestSignature] = useState(false);
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
      setCcEmails('');
      setBccEmails('');
      setShowCcBcc(false);
      setRequestSignature(false);
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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail.trim())) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      });
      return;
    }

    // Parse and validate CC/BCC emails
    const parseCcList = (raw: string): string[] =>
      raw.split(',').map(e => e.trim()).filter(Boolean);

    const ccArray = parseCcList(ccEmails);
    const bccArray = parseCcList(bccEmails);

    for (const email of ccArray) {
      if (!emailRegex.test(email)) {
        toast({ title: 'Invalid CC Email', description: `"${email}" is not a valid email`, variant: 'destructive' });
        return;
      }
    }
    for (const email of bccArray) {
      if (!emailRegex.test(email)) {
        toast({ title: 'Invalid BCC Email', description: `"${email}" is not a valid email`, variant: 'destructive' });
        return;
      }
    }

    setIsSending(true);

    try {
      // If requesting signature, use the signature flow
      if (requestSignature) {
        const { data, error } = await supabase.functions.invoke('send-document-for-signature', {
          body: {
            document_id: estimateId,
            document_type: 'estimate',
            recipients: [{
              name: recipientName.trim(),
              email: recipientEmail.trim(),
              role: 'signer',
              routing_order: 1,
            }],
            email_subject: subject.trim() || `Please sign: ${estimateDisplayName || estimateNumber || 'Estimate'}`,
            email_message: message.trim() || undefined,
            expire_days: 30,
            pipeline_entry_id: pipelineEntryId || undefined,
            contact_id: contactId || undefined,
            ...(ccArray.length > 0 && { cc: ccArray }),
            ...(bccArray.length > 0 && { bcc: bccArray }),
          },
        });

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Failed to send signature request');

        setIsSent(true);
        toast({
          title: 'Signature Request Sent! ✍️',
          description: `${recipientName.split(' ')[0]} will receive a link to review and digitally sign the estimate.`,
        });
      } else {
        // Regular quote email (no signature)
        const { data, error } = await supabase.functions.invoke('send-quote-email', {
          body: {
            estimate_id: estimateId || undefined,
            pipeline_entry_id: pipelineEntryId || undefined,
            tenant_id: effectiveTenantId || undefined,
            contact_id: contactId || null,
            recipient_email: recipientEmail.trim(),
            recipient_name: recipientName.trim(),
            subject: subject.trim() || undefined,
            message: message.trim() || undefined,
            ...(ccArray.length > 0 && { cc: ccArray }),
            ...(bccArray.length > 0 && { bcc: bccArray }),
          },
        });

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Failed to send email');

        setIsSent(true);
        toast({
          title: 'Quote Sent! 📧',
          description: `Email sent to ${recipientEmail}. You'll get a text when they view it.`,
        });
      }

      setTimeout(() => {
        onOpenChange(false);
      }, 2000);

    } catch (error: any) {
      console.error('Error sending:', error);
      toast({
        title: 'Send Failed',
        description: error.message || 'Failed to send',
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
            {requestSignature ? <FileSignature className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
            {requestSignature ? 'Send for Signature' : 'Share Estimate'}
          </DialogTitle>
          <DialogDescription>
            {requestSignature
              ? 'Send a signing link so the homeowner can digitally sign the estimate — no printing needed.'
              : 'Send a trackable email with your estimate. You\'ll receive an SMS notification when they view it.'}
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {requestSignature ? 'Signature Request Sent!' : 'Quote Sent Successfully!'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {requestSignature
                ? `${recipientName.split(' ')[0]} will receive a link to review and sign the estimate digitally.`
                : `You'll receive a text message when ${recipientName.split(' ')[0]} opens the quote.`}
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

            {/* CC / BCC collapsible */}
            <Collapsible open={showCcBcc} onOpenChange={setShowCcBcc}>
              <CollapsibleTrigger asChild>
                <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${showCcBcc ? 'rotate-180' : ''}`} />
                  {showCcBcc ? 'Hide CC/BCC' : '+ Add CC/BCC'}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="cc-emails" className="text-xs">CC</Label>
                  <Input
                    id="cc-emails"
                    placeholder="adjuster@insurance.com, office@company.com"
                    value={ccEmails}
                    onChange={(e) => setCcEmails(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bcc-emails" className="text-xs">BCC</Label>
                  <Input
                    id="bcc-emails"
                    placeholder="manager@company.com"
                    value={bccEmails}
                    onChange={(e) => setBccEmails(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Separate multiple emails with commas</p>
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <Label htmlFor="subject">
                Subject <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="subject"
                placeholder={requestSignature
                  ? `Please sign: ${estimateDisplayName || estimateNumber || 'Estimate'}`
                  : `Your Quote${estimateNumber ? ` #${estimateNumber}` : ''}`}
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
                placeholder={requestSignature
                  ? "Please review and sign the attached estimate at your convenience..."
                  : "Thanks for your interest! I've prepared a quote for your project..."}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>

            {/* Signature request toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
              <div className="space-y-0.5">
                <Label htmlFor="request-signature" className="text-sm font-medium flex items-center gap-2">
                  <FileSignature className="h-4 w-4 text-primary" />
                  Request Digital Signature
                </Label>
                <p className="text-xs text-muted-foreground">
                  Homeowner will receive a signing link to digitally sign the estimate
                </p>
              </div>
              <Switch
                id="request-signature"
                checked={requestSignature}
                onCheckedChange={setRequestSignature}
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
                ) : requestSignature ? (
                  <>
                    <FileSignature className="mr-2 h-4 w-4" />
                    Send for Signature
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
