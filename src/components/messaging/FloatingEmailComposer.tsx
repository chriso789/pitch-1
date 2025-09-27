import React, { useState, useEffect } from "react";
import { Send, Paperclip, Users, Bold, Italic, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FloatingWindow } from "./FloatingWindow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EmailRecipient {
  id: string;
  name: string;
  email: string;
  type: 'contact' | 'job' | 'management';
}

interface FloatingEmailComposerProps {
  isOpen: boolean;
  onClose: () => void;
  recipients?: EmailRecipient[];
  defaultRecipient?: EmailRecipient;
  onSendEmail?: (emailData: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    attachments?: File[];
  }) => void;
}

export const FloatingEmailComposer: React.FC<FloatingEmailComposerProps> = ({
  isOpen,
  onClose,
  recipients = [],
  defaultRecipient,
  onSendEmail
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [to, setTo] = useState<string[]>(defaultRecipient ? [defaultRecipient.email] : []);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState("");

  useEffect(() => {
    if (defaultRecipient) {
      setTo([defaultRecipient.email]);
      setSubject(`Follow up - ${defaultRecipient.name}`);
    }
  }, [defaultRecipient]);

  const handleSendEmail = () => {
    if (to.length > 0 && subject.trim() && body.trim() && onSendEmail) {
      onSendEmail({
        to,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject: subject.trim(),
        body: body.trim(),
        attachments: attachments.length > 0 ? attachments : undefined
      });
      // Reset form
      setTo([]);
      setCc([]);
      setBcc([]);
      setSubject("");
      setBody("");
      setAttachments([]);
      onClose();
    }
  };

  const addRecipient = (email: string, field: 'to' | 'cc' | 'bcc') => {
    const setField = field === 'to' ? setTo : field === 'cc' ? setCc : setBcc;
    const currentField = field === 'to' ? to : field === 'cc' ? cc : bcc;
    
    if (!currentField.includes(email)) {
      setField([...currentField, email]);
    }
  };

  const removeRecipient = (email: string, field: 'to' | 'cc' | 'bcc') => {
    const setField = field === 'to' ? setTo : field === 'cc' ? setCc : setBcc;
    const currentField = field === 'to' ? to : field === 'cc' ? cc : bcc;
    
    setField(currentField.filter(e => e !== email));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments([...attachments, ...Array.from(e.target.files)]);
    }
  };

  const headerActions = (
    <Select value={selectedRecipient} onValueChange={(email) => {
      setSelectedRecipient(email);
      addRecipient(email, 'to');
    }}>
      <SelectTrigger className="w-8 h-6 p-0">
        <Users className="h-3 w-3" />
      </SelectTrigger>
      <SelectContent>
        {recipients.map((recipient) => (
          <SelectItem key={recipient.id} value={recipient.email}>
            {recipient.name} ({recipient.type})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <FloatingWindow
      title="New Email"
      isOpen={isOpen}
      onClose={onClose}
      onMinimize={() => setIsMinimized(!isMinimized)}
      isMinimized={isMinimized}
      width={500}
      height={600}
      headerActions={headerActions}
    >
      <div className="flex flex-col h-full">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Recipients */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="to" className="text-xs font-medium w-8">To:</Label>
                <div className="flex-1 flex flex-wrap gap-1">
                  {to.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 bg-accent text-accent-foreground px-2 py-1 rounded text-xs"
                    >
                      {email}
                      <button
                        onClick={() => removeRecipient(email, 'to')}
                        className="text-xs hover:text-destructive"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowCcBcc(!showCcBcc)}
                >
                  Cc/Bcc
                </Button>
              </div>

              {showCcBcc && (
                <>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium w-8">Cc:</Label>
                    <div className="flex-1 flex flex-wrap gap-1">
                      {cc.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 bg-accent text-accent-foreground px-2 py-1 rounded text-xs"
                        >
                          {email}
                          <button
                            onClick={() => removeRecipient(email, 'cc')}
                            className="text-xs hover:text-destructive"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium w-8">Bcc:</Label>
                    <div className="flex-1 flex flex-wrap gap-1">
                      {bcc.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 bg-accent text-accent-foreground px-2 py-1 rounded text-xs"
                        >
                          {email}
                          <button
                            onClick={() => removeRecipient(email, 'bcc')}
                            className="text-xs hover:text-destructive"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <Separator />

            {/* Subject */}
            <div className="flex items-center gap-2">
              <Label htmlFor="subject" className="text-xs font-medium w-16">Subject:</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="flex-1"
              />
            </div>

            <Separator />

            {/* Formatting toolbar */}
            <div className="flex items-center gap-1 py-2">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Bold className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Italic className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Underline className="h-3 w-3" />
              </Button>
              <Separator orientation="vertical" className="h-4 mx-2" />
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="email-attachments"
              />
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 w-6 p-0"
                onClick={() => document.getElementById('email-attachments')?.click()}
              >
                <Paperclip className="h-3 w-3" />
              </Button>
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Attachments:</Label>
                {attachments.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-accent/50 p-2 rounded text-xs">
                    <span>{file.name}</span>
                    <button
                      onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
                      className="text-destructive hover:text-destructive/70"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="space-y-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Compose your email..."
                className="min-h-[200px] resize-none"
              />
            </div>

            {/* Signature preview */}
            <div className="text-xs text-muted-foreground border-t pt-2">
              <p>Best regards,<br />
              [Your signature will be automatically added]</p>
            </div>
          </div>
        </ScrollArea>

        {/* Send button */}
        <div className="p-4 border-t border-border">
          <Button 
            onClick={handleSendEmail}
            disabled={!to.length || !subject.trim() || !body.trim()}
            className="w-full"
          >
            <Send className="mr-2 h-4 w-4" />
            Send Email
          </Button>
        </div>
      </div>
    </FloatingWindow>
  );
};