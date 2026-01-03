import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Send, Plus, Trash2, UserPlus, Mail, FileSignature } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Recipient {
  name: string;
  email: string;
  role: string;
}

interface RequestSignatureDialogProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentType: 'smart_doc_instance' | 'estimate' | 'proposal';
  documentTitle?: string;
  defaultRecipient?: {
    name: string;
    email: string;
  };
  onSuccess?: (envelopeId: string) => void;
}

export function RequestSignatureDialog({
  open,
  onClose,
  documentId,
  documentType,
  documentTitle,
  defaultRecipient,
  onSuccess
}: RequestSignatureDialogProps) {
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>(
    defaultRecipient 
      ? [{ ...defaultRecipient, role: 'signer' }]
      : [{ name: '', email: '', role: 'signer' }]
  );
  const [subject, setSubject] = useState(`Please sign: ${documentTitle || 'Document'}`);
  const [message, setMessage] = useState(
    'Please review and sign the attached document. If you have any questions, feel free to reach out.'
  );

  const addRecipient = () => {
    setRecipients([...recipients, { name: '', email: '', role: 'signer' }]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
  };

  const validateRecipients = (): boolean => {
    for (const recipient of recipients) {
      if (!recipient.name.trim()) {
        toast.error('All recipients must have a name');
        return false;
      }
      if (!recipient.email.trim() || !recipient.email.includes('@')) {
        toast.error('All recipients must have a valid email');
        return false;
      }
    }
    return true;
  };

  const handleSend = async () => {
    if (!validateRecipients()) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-document-for-signature', {
        body: {
          document_id: documentId,
          document_type: documentType,
          recipients: recipients.map((r, i) => ({
            ...r,
            routing_order: i + 1
          })),
          email_subject: subject,
          email_message: message
        }
      });

      if (error) throw error;

      toast.success(`Signature request sent to ${recipients.length} recipient(s)`);
      onSuccess?.(data.envelope_id);
      onClose();
    } catch (error) {
      console.error('Error sending signature request:', error);
      toast.error('Failed to send signature request');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Request Signature
          </DialogTitle>
          <DialogDescription>
            Send this document for electronic signature
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 p-1">
            {/* Document Info */}
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{documentTitle || 'Document'}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {documentType.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <Badge variant="outline">Ready to send</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Recipients */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Recipients</Label>
                <Button variant="outline" size="sm" onClick={addRecipient}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Recipient
                </Button>
              </div>

              {recipients.map((recipient, index) => (
                <Card key={index}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Name</Label>
                          <Input
                            placeholder="John Smith"
                            value={recipient.name}
                            onChange={(e) => updateRecipient(index, 'name', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            placeholder="john@example.com"
                            value={recipient.email}
                            onChange={(e) => updateRecipient(index, 'email', e.target.value)}
                          />
                        </div>
                      </div>
                      {recipients.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="mt-8"
                          onClick={() => removeRecipient(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {index + 1}. {recipient.role}
                      </Badge>
                      {index === 0 && (
                        <span className="text-xs text-muted-foreground">Primary signer</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Email Settings */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Email Settings</Label>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Subject Line</Label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Please sign: Document Name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Message</Label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Add a personal message..."
                    rows={4}
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send for Signature
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
