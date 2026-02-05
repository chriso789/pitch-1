import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface QuickEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

const EMAIL_TEMPLATES = [
  {
    name: "Estimate Follow-up",
    subject: "Following up on your estimate",
    body: "Hi,\n\nI wanted to follow up on the estimate we provided for your project. Please let me know if you have any questions or would like to schedule a time to discuss.\n\nBest regards",
  },
  {
    name: "Appointment Confirmation",
    subject: "Appointment Confirmation",
    body: "Hi,\n\nThis email confirms your upcoming appointment with our team. Please let us know if you need to reschedule.\n\nWe look forward to seeing you!",
  },
  {
    name: "Project Update",
    subject: "Update on Your Project",
    body: "Hi,\n\nI wanted to give you a quick update on your project. Everything is progressing well, and we're on track to meet our timeline.\n\nPlease don't hesitate to reach out if you have any questions.",
  },
];

export function QuickEmailDialog({ open, onOpenChange, contact }: QuickEmailDialogProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const handleSend = async () => {
    if (!subject.trim() || !body.trim() || !contact?.email) return;

    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-email", {
        body: {
          to: contact.email,
          subject: subject.trim(),
          body: body.trim(),
          contactId: contact.id,
        },
      });

      if (error) throw error;

      toast({
        title: "Email Sent",
        description: `Email sent to ${contact.email}`,
      });
      
      setSubject("");
      setBody("");
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending email:", error);
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const applyTemplate = (template: typeof EMAIL_TEMPLATES[0]) => {
    setSubject(template.subject);
    setBody(template.body);
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Email
          </DialogTitle>
          <DialogDescription>
            Send an email to {contact.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient Info */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div>
              <p className="font-medium">{contact.name}</p>
              <p className="text-sm text-muted-foreground">{contact.email}</p>
            </div>
            <Badge variant="outline">Email</Badge>
          </div>

          {/* Quick Templates */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Templates</Label>
            <div className="flex flex-wrap gap-2">
              {EMAIL_TEMPLATES.map((template) => (
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

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              placeholder="Email subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="email-body">Message</Label>
            <Textarea
              id="email-body"
              placeholder="Type your message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="resize-none"
            />
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
              disabled={!subject.trim() || !body.trim() || sending}
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
                  Send Email
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
