import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Send, Mail, CheckCircle, ChevronDown, User, Plus, MessageSquare, Phone } from "lucide-react";
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
const PHONE_RE = /^[\d\s()+\-.]{7,}$/;

interface ContactEmail { email: string; label: string; }
interface ContactPhone { phone: string; label: string; }

function formatPhoneDisplay(p: string) {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return p;
}

export function ShareDocumentDialog({
  open, onOpenChange, documentId, filename,
  defaultRecipientEmail = "", defaultRecipientName = "", contactId,
}: ShareDocumentDialogProps) {
  const [mode, setMode] = useState<"email" | "sms">("email");
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [smsMessage, setSmsMessage] = useState("");
  const [ccEmails, setCcEmails] = useState("");
  const [bccEmails, setBccEmails] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [availableEmails, setAvailableEmails] = useState<ContactEmail[]>([]);
  const [availablePhones, setAvailablePhones] = useState<ContactPhone[]>([]);
  const [contactName, setContactName] = useState<string>("");
  const [loadingContact, setLoadingContact] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    const fetchContact = async () => {
      setLoadingContact(true);
      try {
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
          .select("first_name, last_name, email, secondary_email, additional_emails, phone, secondary_phone, additional_phones")
          .eq("id", resolvedContactId)
          .maybeSingle();
        if (!contact) return;

        const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
        setContactName(name);

        const emails: ContactEmail[] = [];
        const seenE = new Set<string>();
        const pushE = (raw: string | null | undefined, label: string) => {
          const e = raw?.trim();
          if (e && EMAIL_RE.test(e) && !seenE.has(e.toLowerCase())) {
            seenE.add(e.toLowerCase()); emails.push({ email: e, label });
          }
        };
        pushE(contact.email, "Primary");
        pushE(contact.secondary_email, "Secondary");
        if (Array.isArray(contact.additional_emails)) {
          contact.additional_emails.forEach((e: string) => pushE(e, "Additional"));
        }
        setAvailableEmails(emails);

        const phones: ContactPhone[] = [];
        const seenP = new Set<string>();
        const pushP = (raw: string | null | undefined, label: string) => {
          const p = raw?.trim();
          if (p && PHONE_RE.test(p)) {
            const key = p.replace(/\D/g, "");
            if (key && !seenP.has(key)) { seenP.add(key); phones.push({ phone: p, label }); }
          }
        };
        pushP(contact.phone, "Primary");
        pushP(contact.secondary_phone, "Secondary");
        if (Array.isArray(contact.additional_phones)) {
          contact.additional_phones.forEach((p: string) => pushP(p, "Additional"));
        }
        setAvailablePhones(phones);

        if (name && !defaultRecipientName) setRecipientName(name);
        if (emails[0] && !defaultRecipientEmail) setRecipientEmail(emails[0].email);
        if (phones[0]) setRecipientPhone(phones[0].phone);
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
      setMode("email");
      setRecipientEmail(defaultRecipientEmail);
      setRecipientPhone("");
      setRecipientName(defaultRecipientName);
      setSubject("");
      setMessage("");
      setSmsMessage("");
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
    if (!recipientEmail.trim()) { setRecipientEmail(e); return; }
    if (recipientEmail.trim().toLowerCase() === lower) {
      if (ccList.length) { setRecipientEmail(ccList[0]); setCcEmails(ccList.slice(1).join(", ")); }
      else setRecipientEmail("");
      return;
    }
    if (ccList.some(c => c.toLowerCase() === lower)) {
      setCcEmails(ccList.filter(c => c.toLowerCase() !== lower).join(", "));
      return;
    }
    setCcEmails([...ccList, e].join(", "));
    setShowCcBcc(true);
  };

  const handleSendEmail = async () => {
    if (!EMAIL_RE.test(recipientEmail.trim())) {
      toast({ title: "Invalid email", description: "Enter a valid recipient email", variant: "destructive" }); return;
    }
    if (!recipientName.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const cc = parseList(ccEmails);
    const bcc = parseList(bccEmails);
    for (const e of [...cc, ...bcc]) {
      if (!EMAIL_RE.test(e)) { toast({ title: "Invalid CC/BCC", description: e, variant: "destructive" }); return; }
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
      toast({ title: "Email sent 📧", description: `Delivered to ${total} recipient${total > 1 ? "s" : ""}.` });
      setTimeout(() => onOpenChange(false), 1800);
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message || "Try again", variant: "destructive" });
    } finally { setIsSending(false); }
  };

  const handleSendSms = async () => {
    if (!PHONE_RE.test(recipientPhone.trim())) {
      toast({ title: "Invalid phone", description: "Enter a valid recipient phone number", variant: "destructive" }); return;
    }
    if (!recipientName.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-document-sms", {
        body: {
          document_id: documentId,
          contact_id: contactId || null,
          recipient_phone: recipientPhone.trim(),
          recipient_name: recipientName.trim(),
          message: smsMessage.trim() || undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Send failed");
      setIsSent(true);
      toast({ title: "Text sent 📱", description: `Sent to ${formatPhoneDisplay(recipientPhone)}.` });
      setTimeout(() => onOpenChange(false), 1800);
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message || "Try again", variant: "destructive" });
    } finally { setIsSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" /> Share Document
          </DialogTitle>
          <DialogDescription>
            Send <span className="font-medium text-foreground">{filename}</span> via email or text.
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">{mode === "email" ? "Email sent!" : "Text sent!"}</h3>
            <p className="text-sm text-muted-foreground">
              Logged to communications.
            </p>
          </div>
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "email" | "sms")} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email"><Mail className="h-4 w-4 mr-2" />Email</TabsTrigger>
              <TabsTrigger value="sms"><MessageSquare className="h-4 w-4 mr-2" />Text</TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-3 pt-3">
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
                        <button key={email} type="button" onClick={() => toggleEmail(email)}
                          className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"
                          }`}>
                          {selected ? <CheckCircle className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          <span className="font-medium">{email}</span>
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${selected ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}>
                            {isPrimary ? "To" : selected ? "Cc" : label}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="rn">Recipient Name</Label>
                <Input id="rn" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Smith" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="re">Recipient Email</Label>
                <Input id="re" type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="john@example.com" />
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
            </TabsContent>

            <TabsContent value="sms" className="space-y-3 pt-3">
              {availablePhones.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {contactName ? `${contactName}'s phones` : "Contact phones"}
                    <span className="text-muted-foreground/70 font-normal">— tap to use</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {availablePhones.map(({ phone, label }) => {
                      const selected = recipientPhone.replace(/\D/g, "") === phone.replace(/\D/g, "");
                      return (
                        <button key={phone} type="button" onClick={() => setRecipientPhone(phone)}
                          className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"
                          }`}>
                          {selected ? <CheckCircle className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          <span className="font-medium">{formatPhoneDisplay(phone)}</span>
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${selected ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}>
                            {label}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {loadingContact && availablePhones.length === 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading contact phones…
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="rn-sms">Recipient Name</Label>
                <Input id="rn-sms" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Smith" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rp">Recipient Phone</Label>
                <Input id="rp" type="tel" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="(555) 123-4567" />
                <p className="text-xs text-muted-foreground">A secure link to the document will be included in the text.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sms-msg">Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea id="sms-msg" rows={3} value={smsMessage} onChange={e => setSmsMessage(e.target.value)}
                  placeholder={`Hi ${(recipientName || "there").split(" ")[0]}, here is your document.`} maxLength={300} />
                <p className="text-xs text-muted-foreground">{smsMessage.length}/300 — link is appended automatically.</p>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          {!isSent && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
              <Button onClick={mode === "email" ? handleSendEmail : handleSendSms} disabled={isSending}>
                {isSending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                  : mode === "email"
                    ? <><Mail className="mr-2 h-4 w-4" />Send Email</>
                    : <><MessageSquare className="mr-2 h-4 w-4" />Send Text</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
