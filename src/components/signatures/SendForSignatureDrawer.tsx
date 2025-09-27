import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { FileText, Send, Plus, X, Users } from 'lucide-react';

interface SendForSignatureDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: string;
  pipelineEntryId?: string;
  contactId?: string;
  defaultTitle?: string;
}

interface Recipient {
  id: string;
  name: string;
  email: string;
  role: 'signer' | 'cc' | 'approver';
  signing_order: number;
}

export const SendForSignatureDrawer: React.FC<SendForSignatureDrawerProps> = ({
  isOpen,
  onOpenChange,
  estimateId,
  pipelineEntryId,
  contactId,
  defaultTitle
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [title, setTitle] = useState(defaultTitle || 'Roofing Estimate for Signature');
  const [emailSubject, setEmailSubject] = useState('Please sign your roofing estimate');
  const [emailMessage, setEmailMessage] = useState('Your roofing estimate is ready for signature. Please review and sign at your convenience.');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(30);

  // Load contact data if available
  const { data: contact } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      if (!contactId) return null;
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();
      return data;
    },
    enabled: !!contactId
  });

  // Auto-populate recipient from contact data
  useEffect(() => {
    if (contact && recipients.length === 0) {
      setRecipients([{
        id: crypto.randomUUID(),
        name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Customer',
        email: contact.email || '',
        role: 'signer',
        signing_order: 1
      }]);
    }
  }, [contact, recipients.length]);

  const addRecipient = () => {
    const newRecipient: Recipient = {
      id: crypto.randomUUID(),
      name: '',
      email: '',
      role: 'signer',
      signing_order: recipients.length + 1
    };
    setRecipients([...recipients, newRecipient]);
  };

  const updateRecipient = (id: string, field: keyof Recipient, value: string | number) => {
    setRecipients(recipients.map(r => 
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const removeRecipient = (id: string) => {
    setRecipients(recipients.filter(r => r.id !== id));
  };

  const createEnvelopeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('create-signature-envelope', {
        body: {
          title,
          estimate_id: estimateId,
          pipeline_entry_id: pipelineEntryId,
          contact_id: contactId,
          recipients: recipients.map(r => ({
            name: r.name,
            email: r.email,
            role: r.role,
            signing_order: r.signing_order
          })),
          expires_in_days: expiresInDays
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      // Send the envelope
      const { error: sendError } = await supabase.functions.invoke('send-signature-envelope', {
        body: {
          envelope_id: data.envelope.id,
          email_subject: emailSubject,
          email_message: emailMessage
        }
      });

      if (sendError) {
        toast({
          title: "Envelope created but sending failed",
          description: "The envelope was created but could not be sent. You can send it later.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Sent for signature!",
          description: `Document sent to ${recipients.length} recipient(s) for signature.`
        });
      }

      queryClient.invalidateQueries({ queryKey: ['signature-envelopes'] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create envelope",
        description: error.message || "An error occurred while creating the signature envelope.",
        variant: "destructive"
      });
    }
  });

  const isValid = title.trim() && recipients.length > 0 && recipients.every(r => r.name.trim() && r.email.trim());

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Send for Signature
          </SheetTitle>
          <SheetDescription>
            Create a signature envelope and send it to recipients for electronic signature.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {/* Document Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Document Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="title">Document Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter document title"
                />
              </div>
              
              <div>
                <Label htmlFor="expires">Expires In (Days)</Label>
                <Select value={expiresInDays.toString()} onValueChange={(value) => setExpiresInDays(parseInt(value))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Recipients */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Recipients ({recipients.length})
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRecipient}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Recipient
                </Button>
              </div>
              <CardDescription>
                Add people who need to sign this document
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recipients.map((recipient, index) => (
                <div key={recipient.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">#{recipient.signing_order}</Badge>
                    {recipients.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRecipient(recipient.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={recipient.name}
                        onChange={(e) => updateRecipient(recipient.id, 'name', e.target.value)}
                        placeholder="Recipient name"
                      />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={recipient.email}
                        onChange={(e) => updateRecipient(recipient.id, 'email', e.target.value)}
                        placeholder="recipient@example.com"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Role</Label>
                      <Select 
                        value={recipient.role} 
                        onValueChange={(value) => updateRecipient(recipient.id, 'role', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="signer">Signer</SelectItem>
                          <SelectItem value="approver">Approver</SelectItem>
                          <SelectItem value="cc">CC (View Only)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Signing Order</Label>
                      <Input
                        type="number"
                        min="1"
                        value={recipient.signing_order}
                        onChange={(e) => updateRecipient(recipient.id, 'signing_order', parseInt(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Email Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Email Settings</CardTitle>
              <CardDescription>
                Customize the email that will be sent to recipients
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="subject">Email Subject</Label>
                <Input
                  id="subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Please sign your roofing estimate"
                />
              </div>
              
              <div>
                <Label htmlFor="message">Email Message</Label>
                <Textarea
                  id="message"
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder="Enter a message for recipients"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div className="flex justify-end gap-3 pt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createEnvelopeMutation.mutate()}
            disabled={!isValid || createEnvelopeMutation.isPending}
            className="flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {createEnvelopeMutation.isPending ? 'Sending...' : 'Send for Signature'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};