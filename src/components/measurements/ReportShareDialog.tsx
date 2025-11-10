import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Mail, Link as LinkIcon, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface ReportShareDialogProps {
  open: boolean;
  onClose: () => void;
  reportId: string;
  shareUrl: string;
  propertyAddress: string;
  customerEmail?: string;
}

export function ReportShareDialog({
  open,
  onClose,
  reportId,
  shareUrl,
  propertyAddress,
  customerEmail = '',
}: ReportShareDialogProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [emailTo, setEmailTo] = useState(customerEmail);
  const [emailSubject, setEmailSubject] = useState(
    `Roof Measurement Report - ${propertyAddress}`
  );
  const [emailMessage, setEmailMessage] = useState(
    `Hello,\n\nPlease find your professional roof measurement report attached.\n\nYou can view and download the report here: ${shareUrl}\n\nIf you have any questions, feel free to reach out.\n\nBest regards`
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      toast.error('Please enter recipient email');
      return;
    }

    setIsSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          to: [emailTo],
          subject: emailSubject,
          body: emailMessage,
        },
      });

      if (error) throw error;

      toast.success('Report sent via email!');
      onClose();
    } catch (error: any) {
      console.error('Failed to send email:', error);
      toast.error(error.message || 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Measurement Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Share Link Section */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4" />
              Shareable Link
            </Label>
            <div className="flex gap-2">
              <Input value={shareUrl} readOnly className="font-mono text-sm" />
              <Button onClick={handleCopyLink} variant="outline" size="icon">
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can view and download the report
            </p>
          </div>

          {/* Email Section */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send via Email
            </Label>

            <div className="space-y-3">
              <div>
                <Label htmlFor="email-to" className="text-sm">To</Label>
                <Input
                  id="email-to"
                  type="email"
                  placeholder="customer@example.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="email-subject" className="text-sm">Subject</Label>
                <Input
                  id="email-subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="email-message" className="text-sm">Message</Label>
                <Textarea
                  id="email-message"
                  rows={6}
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                />
              </div>

              <Button
                onClick={handleSendEmail}
                disabled={isSending || !emailTo}
                className="w-full"
              >
                <Mail className="h-4 w-4 mr-2" />
                {isSending ? 'Sending...' : 'Send Email'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
