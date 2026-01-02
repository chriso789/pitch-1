import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mail, MessageSquare, Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface MeasurementShareDialogProps {
  open: boolean;
  onClose: () => void;
  reportUrl: string;
  propertyAddress?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export const MeasurementShareDialog: React.FC<MeasurementShareDialogProps> = ({
  open,
  onClose,
  reportUrl,
  propertyAddress,
  customerEmail,
  customerPhone,
}) => {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'email' | 'sms'>('email');

  // Email state
  const [emailTo, setEmailTo] = useState(customerEmail || '');
  const [emailSubject, setEmailSubject] = useState(
    `Roof Measurement Report${propertyAddress ? ` - ${propertyAddress}` : ''}`
  );
  const [emailMessage, setEmailMessage] = useState(
    `Hello,\n\nPlease find your comprehensive roof measurement report at the link below:\n\n${reportUrl}\n\nThis report includes detailed measurements, facet breakdowns, and satellite imagery.\n\nThank you for your business!`
  );

  // SMS state
  const [smsTo, setSmsTo] = useState(customerPhone || '');
  const [smsMessage, setSmsMessage] = useState(
    `Your roof measurement report is ready: ${reportUrl}`
  );

  const handleSendEmail = async () => {
    if (!emailTo.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          to: emailTo,
          subject: emailSubject,
          text: emailMessage,
          html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1f2937;">Roof Measurement Report</h2>
            ${propertyAddress ? `<p style="color: #6b7280;">Property: ${propertyAddress}</p>` : ''}
            <p style="color: #374151; white-space: pre-wrap;">${emailMessage.replace(reportUrl, `<a href="${reportUrl}" style="color: #2563eb;">${reportUrl}</a>`)}</p>
          </div>`,
        },
      });

      if (error) throw error;

      toast({
        title: 'Email Sent',
        description: `Report sent to ${emailTo}`,
      });
      onClose();
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast({
        title: 'Failed to Send',
        description: error.message || 'Could not send email',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSendSMS = async () => {
    if (!smsTo.trim()) {
      toast({
        title: 'Phone Number Required',
        description: 'Please enter a phone number',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-sms', {
        body: {
          to: smsTo,
          message: smsMessage,
        },
      });

      if (error) throw error;

      toast({
        title: 'SMS Sent',
        description: `Report link sent to ${smsTo}`,
      });
      onClose();
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast({
        title: 'Failed to Send',
        description: error.message || 'Could not send SMS',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Share Measurement Report</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'email' | 'sms')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email
            </TabsTrigger>
            <TabsTrigger value="sms" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              SMS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="email-to">Recipient Email</Label>
              <Input
                id="email-to"
                type="email"
                placeholder="customer@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-message">Message</Label>
              <Textarea
                id="email-message"
                rows={6}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
              />
            </div>

            <Button 
              onClick={handleSendEmail} 
              disabled={isSending} 
              className="w-full"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Email
            </Button>
          </TabsContent>

          <TabsContent value="sms" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="sms-to">Recipient Phone</Label>
              <Input
                id="sms-to"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={smsTo}
                onChange={(e) => setSmsTo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sms-message">Message (160 chars recommended)</Label>
              <Textarea
                id="sms-message"
                rows={3}
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground text-right">
                {smsMessage.length}/300 characters
              </p>
            </div>

            <Button 
              onClick={handleSendSMS} 
              disabled={isSending} 
              className="w-full"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send SMS
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
