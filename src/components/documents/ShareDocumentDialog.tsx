import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Send, Mail, CheckCircle, ChevronDown, User, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ShareDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  filename: string;
  defaultRecipientEmail?: string;
  defaultRecipientName?: string;
  contactId?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactEmail {
  email: string;
  label: string; // "Primary", "Secondary", "Additional"
}

export function ShareDocumentDialog({
  open, onOpenChange, documentId, filename,
  defaultRecipientEmail = "", defaultRecipientName = "", contactId,
}: ShareDocumentDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [ccEmails, setCcEmails] = useState("");
  const [bccEmails, setBccEmails] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [availableEmails, setAvailableEmails] = useState<ContactEmail[]>([]);
  const [contactName, setContactName] = useState<string>("");
  const [loadingContact, setLoadingContact] = useState(false);
  const { toast } = useToast();

  // Fetch contact emails when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchContact = async () => {
      setLoadingContact(true);
      try {
        // 1. Resolve contact_id from document if not provided
        let resolvedContactId = contactId;
        if (!resolvedContactId) {
          const { data: doc } = await supabase
            .from("documents")
            .select("contact_id, pipeline_entry_id")
            .eq("id", documentId)
            .maybeSingle();
          resolvedContactId = doc?.contact_id ?? null;
          if (!resolvedContactId && doc?.pipeline_entry_id) {
            const { data: pe } = await supabase
              .from("pipeline_entries")
              .select("contact_id")
              .eq("id", doc.pipeline_entry_id)
              .maybeSingle();
            resolvedContactId = pe?.contact_id ?? null;
          }
        }
        if (!resolvedContactId) return;

        const { data: contact } = await supabase
          .from("contacts")
          .select("first_name, last_name, email, secondary_email, additional_emails")
          .eq("id", resolvedContactId)
          .maybeSingle();
        if (!contact) return;

        const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
        setContactName(name);

        const emails: ContactEmail[] = [];
        const seen = new Set<string>();
        const push = (raw: string | null | undefined, label: string) => {
          const e = raw?.trim();
          if (e && EMAIL_RE.test(e) && !seen.has(e.toLowerCase())) {
            seen.add(e.toLowerCase());
            emails.push({ email: e, label });
          }
        };
        push(contact.email, "Primary");
        push(contact.secondary_email, "Secondary");
        if (Array.isArray(contact.additional_emails)) {
          contact.additional_emails.forEach((e: string) => push(e, "Additional"));
        }
        setAvailableEmails(emails);

        // Autofill name + primary email only if not already overridden
        if (name && !defaultRecipientName) setRecipientName(name);
        if (emails[0] && !defaultRecipientEmail) setRecipientEmail(emails[0].email);
      } catch (err) {
        console.warn("[ShareDocumentDialog] contact fetch failed", err);
      } finally {
        setLoadingContact(false);
      }
    };
    fetchContact();
  }, [open, documentId, contactId, defaultRecipientEmail, defaultRecipientName]);

  useEffect(() => {
    if (open) {
      setRecipientEmail(defaultRecipientEmail);
      setRecipientName(defaultRecipientName);
      setSubject("");
      setMessage("");
      setCcEmails("");
      setBccEmails("");
      setShowCcBcc(false);
      setIsSent(false);
    }
  }, [open, defaultRecipientEmail, defaultRecipientName]);

  const parseList = (raw: string) => raw.split(",").map(e => e.trim()).filter(Boolean);

  const ccList = parseList(ccEmails);
  const isEmailSelected = (e: string) =>
    recipientEmail.trim().toLowerCase() === e.toLowerCase() ||
    ccList.some(c => c.toLowerCase() === e.toLowerCase());

  const toggleEmail = (e: string) => {
    const lower = e.toLowerCase();
    // If empty recipient, set as primary
    if (!recipientEmail.trim()) {
      setRecipientEmail(e);
      return;
    }
    // If it's the current primary, remove it (promote first CC if any)
    if (recipientEmail.trim().toLowerCase() === lower) {
      if (ccList.length) {
        setRecipientEmail(ccList[0]);
        setCcEmails(ccList.slice(1).join(", "));
      } else {
        setRecipientEmail("");
      }
      return;
    }
    // If it's in CC, remove from CC
    if (ccList.some(c => c.toLowerCase() === lower)) {
      setCcEmails(ccList.filter(c => c.toLowerCase() !== lower).join(", "));
      return;
    }
    // Otherwise add to CC and reveal section
    setCcEmails([...ccList, e].join(", "));
    setShowCcBcc(true);
  };

  const handleSend = async () => {
    if (!EMAIL_RE.test(recipientEmail.trim())) {
      toast({ title: "Invalid email", description: "Enter a valid recipient email", variant: "destructive" });
      return;
    }
    if (!recipientName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const cc = parseList(ccEmails);
    const bcc = parseList(bccEmails);
    for (const e of [...cc, ...bcc]) {
      if (!EMAIL_RE.test(e)) {
        toast({ title: "Invalid CC/BCC", description: e, variant: "destructive" });
        return;
      }
    }

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-document-email", {
        body: {
          document_id: documentId,
          contact_id: contactId || null,
          recipient_email: recipientEmail.trim(),
          recipient_name: recipientName.trim(),
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          ...(cc.length ? { cc } : {}),
          ...(bcc.length ? { bcc } : {}),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Send failed");

      setIsSent(true);
      const total = 1 + cc.length + bcc.length;
      toast({
        title: "Email sent 📧",
        description: `Delivered to ${total} recipient${total > 1 ? "s" : ""}. You'll be notified when it's opened.`,
      });
      setTimeout(() => onOpenChange(false), 1800);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Send failed", description: err.message || "Try again", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email Document
          </DialogTitle>
          <DialogDescription>
            Send <span className="font-medium text-foreground">{filename}</span> via email. You'll get a notification when it's opened.
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Email sent!</h3>
            <p className="text-sm text-muted-foreground">
              Logged to communications. You'll be notified when {recipientName.split(" ")[0]} opens it.
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {availableEmails.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  {contactName ? `${contactName}'s emails` : "Contact emails"}
                  <span className="text-muted-foreground/70 font-normal">— tap to add</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableEmails.map(({ email, label }) => {
                    const selected = isEmailSelected(email);
                    const isPrimary = recipientEmail.trim().toLowerCase() === email.toLowerCase();
                    return (
                      <button
                        key={email}
                        type="button"
                        onClick={() => toggleEmail(email)}
                        className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent border-border"
                        }`}
                      >
                        {selected ? <CheckCircle className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        <span className="font-medium">{email}</span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 h-4 ${
                            selected ? "bg-primary-foreground/20 text-primary-foreground" : ""
                          }`}
                        >
                          {isPrimary ? "To" : selected ? "Cc" : label}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {loadingContact && availableEmails.length === 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading contact emails…
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="rn">Recipient Name</Label>
              <Input id="rn" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Smith" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="re">Recipient Email</Label>
              <Input
                id="re"
                type="email"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                placeholder="john@example.com"
              />
              <p className="text-xs text-muted-foreground">You can edit the address or type a different one.</p>
            </div>

            <Collapsible open={showCcBcc} onOpenChange={setShowCcBcc}>
              <CollapsibleTrigger asChild>
                <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${showCcBcc ? "rotate-180" : ""}`} />
                  {showCcBcc ? "Hide CC/BCC" : `+ Add CC/BCC${ccList.length ? ` (${ccList.length})` : ""}`}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="cc" className="text-xs">CC</Label>
                  <Input id="cc" value={ccEmails} onChange={e => setCcEmails(e.target.value)} placeholder="adjuster@..." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bcc" className="text-xs">BCC</Label>
                  <Input id="bcc" value={bccEmails} onChange={e => setBccEmails(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">Separate multiple emails with commas</p>
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <Label htmlFor="sub">Subject <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="sub" value={subject} onChange={e => setSubject(e.target.value)} placeholder={filename} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="msg">Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea id="msg" rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Please find your document attached..." />
            </div>
          </div>
        )}

        <DialogFooter>
          {!isSent && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
              <Button onClick={handleSend} disabled={isSending}>
                {isSending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : <><Send className="mr-2 h-4 w-4" />Send Email</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
