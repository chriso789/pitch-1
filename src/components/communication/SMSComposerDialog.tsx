import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Send, Loader2 } from 'lucide-react';

interface PhoneOption {
  label: string;
  number: string;
}

interface SMSComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber?: string; // Single phone (legacy support)
  phoneNumbers?: PhoneOption[]; // Multiple phones
  contactName: string;
  onSend: (message: string, selectedPhone: string) => Promise<void>;
}

export const SMSComposerDialog: React.FC<SMSComposerDialogProps> = ({
  open,
  onOpenChange,
  phoneNumber,
  phoneNumbers,
  contactName,
  onSend
}) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  
  // Build phone options from either prop
  const phoneOptions: PhoneOption[] = phoneNumbers?.length 
    ? phoneNumbers 
    : phoneNumber 
      ? [{ label: 'Primary', number: phoneNumber }]
      : [];
  
  const [selectedPhone, setSelectedPhone] = useState<string>(phoneOptions[0]?.number || '');

  // Reset selected phone when options change
  useEffect(() => {
    if (phoneOptions.length > 0 && !phoneOptions.find(p => p.number === selectedPhone)) {
      setSelectedPhone(phoneOptions[0].number);
    }
  }, [phoneOptions, selectedPhone]);

  const handleSend = async () => {
    if (!message.trim() || !selectedPhone) return;

    setSending(true);
    try {
      await onSend(message, selectedPhone);
      setMessage('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error sending SMS:', error);
    } finally {
      setSending(false);
    }
  };

  const characterCount = message.length;
  const messageCount = Math.ceil(characterCount / 160) || 1;

  const selectedPhoneLabel = phoneOptions.find(p => p.number === selectedPhone)?.label || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send SMS
          </DialogTitle>
          <DialogDescription>
            Send a text message to {contactName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Phone Number Selector */}
          {phoneOptions.length > 1 ? (
            <div className="space-y-2">
              <Label>Send to</Label>
              <Select value={selectedPhone} onValueChange={setSelectedPhone}>
                <SelectTrigger>
                  <SelectValue placeholder="Select phone number" />
                </SelectTrigger>
                <SelectContent>
                  {phoneOptions.map((option) => (
                    <SelectItem key={option.number} value={option.number}>
                      <span className="font-medium">{option.label}:</span>{' '}
                      <span className="text-muted-foreground">{option.number}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : phoneOptions.length === 1 ? (
            <div className="text-sm text-muted-foreground">
              Sending to: <span className="font-medium text-foreground">{phoneOptions[0].number}</span>
            </div>
          ) : (
            <div className="text-sm text-destructive">
              No phone number available
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sms-message">Message</Label>
            <Textarea
              id="sms-message"
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{characterCount} characters</span>
              <span>{messageCount} SMS message{messageCount > 1 ? 's' : ''}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!message.trim() || !selectedPhone || sending}
              className="flex-1"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send SMS
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
