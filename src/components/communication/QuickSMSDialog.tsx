import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { useSendSMS } from "@/hooks/useSendSMS";

interface QuickSMSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: {
    id: string;
    name: string;
    phone?: string;
  } | null;
}

const SMS_TEMPLATES = [
  {
    name: "Appointment Reminder",
    message: "Hi! This is a friendly reminder about your upcoming appointment. Please let us know if you need to reschedule.",
  },
  {
    name: "Follow Up",
    message: "Hi! I wanted to follow up on our recent conversation. Do you have any questions about the estimate we provided?",
  },
  {
    name: "Thank You",
    message: "Thank you for choosing us! We appreciate your business. Please don't hesitate to reach out if you need anything.",
  },
];

export function QuickSMSDialog({ open, onOpenChange, contact }: QuickSMSDialogProps) {
  const [message, setMessage] = useState("");
  const { sendSMS, sending } = useSendSMS();

  const characterCount = message.length;
  const messageCount = Math.ceil(characterCount / 160) || 1;

  const handleSend = async () => {
    if (!message.trim() || !contact?.phone) return;

    try {
      await sendSMS({
        to: contact.phone,
        message: message.trim(),
        contactId: contact.id,
      });
      setMessage("");
      onOpenChange(false);
    } catch (error) {
      // Error is handled by the hook with toast
    }
  };

  const applyTemplate = (template: typeof SMS_TEMPLATES[0]) => {
    setMessage(template.message);
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send SMS
          </DialogTitle>
          <DialogDescription>
            Send a text message to {contact.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient Info */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div>
              <p className="font-medium">{contact.name}</p>
              <p className="text-sm text-muted-foreground">{contact.phone}</p>
            </div>
            <Badge variant="outline">SMS</Badge>
          </div>

          {/* Quick Templates */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Templates</Label>
            <div className="flex flex-wrap gap-2">
              {SMS_TEMPLATES.map((template) => (
                <Button
                  key={template.name}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template)}
                  className="text-xs"
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Message Input */}
          <div className="space-y-2">
            <Label htmlFor="sms-message">Message</Label>
            <Textarea
              id="sms-message"
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{characterCount} characters</span>
              <span>
                {messageCount} SMS segment{messageCount > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
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
              disabled={!message.trim() || sending}
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
}
