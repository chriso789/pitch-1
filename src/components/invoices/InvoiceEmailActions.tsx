import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MailCheck, MailWarning, Send, ShieldOff, RefreshCcw, Clock } from "lucide-react";

interface InvoiceEmailActionsProps {
  invoiceId: string;
  tenantId: string;
  projectId: string | null;
  invoiceLabel: string;
  isVoid?: boolean;
}

interface Delivery {
  id: string;
  recipient_email: string;
  from_email: string;
  sender_kind: string;
  status: string;
  is_resend: boolean;
  created_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  send_request_id: string | null;
}

interface ProjectContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

const STATUS_META: Record<string, { label: string; tone: "default" | "secondary" | "outline" | "destructive"; icon?: JSX.Element }> = {
  queued: { label: "Queued", tone: "secondary", icon: <Clock className="h-3 w-3" /> },
  accepted: { label: "Sending…", tone: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  sent: { label: "Sent", tone: "outline", icon: <Send className="h-3 w-3" /> },
  delivered: { label: "Delivered", tone: "default", icon: <MailCheck className="h-3 w-3" /> },
  delayed: { label: "Delayed", tone: "outline", icon: <Clock className="h-3 w-3" /> },
  bounced: { label: "Bounced", tone: "destructive", icon: <MailWarning className="h-3 w-3" /> },
  complained: { label: "Complained", tone: "destructive", icon: <MailWarning className="h-3 w-3" /> },
  failed: { label: "Failed", tone: "destructive", icon: <MailWarning className="h-3 w-3" /> },
};

function randomId() {
  return `sr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function InvoiceEmailActions({
  invoiceId,
  tenantId,
  projectId,
  invoiceLabel,
  isVoid,
}: InvoiceEmailActionsProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ProjectContact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [overrideRecipient, setOverrideRecipient] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [overrideSuppression, setOverrideSuppression] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendReqId, setSendReqId] = useState<string>(randomId());

  const loadDeliveries = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from("invoice_email_deliveries")
        .select(
          "id, recipient_email, from_email, sender_kind, status, is_resend, created_at, accepted_at, sent_at, delivered_at, bounced_at, complained_at, failed_at, failure_reason, send_request_id",
        )
        .eq("tenant_id", tenantId)
        .eq("pitch_invoice_id", invoiceId)
        .order("created_at", { ascending: false })
        .limit(20);
      setDeliveries((data as Delivery[] | null) ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, invoiceId]);

  const loadContacts = useCallback(async () => {
    if (!projectId) return;
    const { data: project } = await supabase
      .from("projects")
      .select("pipeline_entry_id")
      .eq("id", projectId)
      .maybeSingle();
    const pipelineEntryId = (project as any)?.pipeline_entry_id;
    if (!pipelineEntryId) return;
    const { data: pe } = await supabase
      .from("pipeline_entries")
      .select("contact_id")
      .eq("id", pipelineEntryId)
      .maybeSingle();
    const cid = (pe as any)?.contact_id;
    if (!cid) return;
    const { data: c } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("id", cid)
      .maybeSingle();
    if (c) {
      const contact = c as ProjectContact;
      setContacts([contact]);
      setSelectedContactId(contact.id);
      setRecipient((contact.email ?? "").trim());
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      loadContacts();
      loadDeliveries();
      setSendReqId(randomId());
    }
  }, [open, loadContacts, loadDeliveries]);

  const contactEmail = useMemo(() => {
    const c = contacts.find((x) => x.id === selectedContactId);
    return (c?.email ?? "").trim().toLowerCase();
  }, [contacts, selectedContactId]);

  const recipientDiffers =
    !!contactEmail && recipient.trim().toLowerCase() !== contactEmail;

  const canSend =
    !!selectedContactId &&
    !!recipient.trim() &&
    (!recipientDiffers || (overrideRecipient && confirmOverride)) &&
    !busy;

  const send = async (isResend: boolean) => {
    if (!selectedContactId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("invoice-email-send", {
        body: {
          invoice_id: invoiceId,
          contact_id: selectedContactId,
          recipient_email: recipient.trim(),
          send_request_id: sendReqId,
          is_resend: isResend,
          override_suppression: overrideSuppression || undefined,
          confirm_recipient_override: recipientDiffers ? true : undefined,
        },
      });
      if (error) {
        const details =
          (error as any)?.context && typeof (error as any).context.text === "function"
            ? await (error as any).context.text()
            : (error as Error).message;
        toast({ title: "Send failed", description: String(details).slice(0, 300), variant: "destructive" });
        return;
      }
      const payload = data as any;
      if (payload?.ok === false) {
        toast({
          title: payload?.error === "recipient_suppressed" ? "Recipient suppressed" : "Send failed",
          description: payload?.reason ?? payload?.error ?? "Provider rejected the send",
          variant: "destructive",
        });
        return;
      }
      if (payload?.deduplicated) {
        toast({ title: "Already sent", description: "Duplicate send suppressed by idempotency key." });
      } else {
        toast({ title: isResend ? "Resent" : "Email queued", description: `${recipient}` });
      }
      setSendReqId(randomId());
      await loadDeliveries();
    } catch (e) {
      toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke all active portal links for this invoice? Existing recipients will no longer be able to open them.")) return;
    setRevoking(true);
    try {
      const { data, error } = await supabase.functions.invoke("invoice-portal-revoke", {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
      const p = data as any;
      toast({
        title: "Portal links revoked",
        description: `${p?.revoked_count ?? 0} active link(s) revoked.`,
      });
      await loadDeliveries();
    } catch (e) {
      toast({ title: "Revoke failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  };

  const latest = deliveries[0];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={isVoid}
        >
          <Send className="h-4 w-4 mr-1.5" /> Email Invoice
        </Button>
        {latest && (
          <Badge variant={STATUS_META[latest.status]?.tone ?? "secondary"} className="text-[11px] gap-1">
            {STATUS_META[latest.status]?.icon}
            {STATUS_META[latest.status]?.label ?? latest.status}
            <span className="opacity-70">• {latest.recipient_email}</span>
          </Badge>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email {invoiceLabel}</DialogTitle>
            <DialogDescription>
              Sends a Pitch-branded email with a secure link to the invoice portal. The recipient never sees the QuickBooks URL.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {contacts.length > 0 && (
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                  <SelectTrigger><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed"}
                        {c.email ? ` • ${c.email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Recipient email</Label>
                {contactEmail && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => {
                      setRecipient(contactEmail);
                      setOverrideRecipient(false);
                      setConfirmOverride(false);
                    }}
                  >
                    Use contact email
                  </button>
                )}
              </div>
              <Input
                type="email"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setOverrideRecipient(true);
                }}
                placeholder="name@example.com"
              />
              {recipientDiffers && (
                <label className="flex items-start gap-2 text-xs text-orange-700">
                  <Checkbox
                    checked={confirmOverride}
                    onCheckedChange={(v) => setConfirmOverride(!!v)}
                    className="mt-0.5"
                  />
                  <span>
                    This differs from the contact's on-file email ({contactEmail}). I confirm sending to the address above; the contact record will not be modified.
                  </span>
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Optional internal note (not shown to recipient)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={overrideSuppression}
                onCheckedChange={(v) => setOverrideSuppression(!!v)}
                className="mt-0.5"
              />
              <span>Override suppression (only use if the recipient asked you to retry after fixing their mailbox).</span>
            </label>

            {deliveries.length > 0 && (
              <div className="rounded-md border p-2 text-xs space-y-1 max-h-40 overflow-auto">
                <p className="font-medium mb-1">Recent deliveries</p>
                {deliveries.slice(0, 6).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {new Date(d.created_at).toLocaleString()} — {d.recipient_email}
                    </span>
                    <Badge variant={STATUS_META[d.status]?.tone ?? "secondary"} className="text-[10px]">
                      {STATUS_META[d.status]?.label ?? d.status}
                    </Badge>
                  </div>
                ))}
                {loading && <p className="text-muted-foreground">Loading…</p>}
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <Button
              variant="ghost"
              onClick={revoke}
              disabled={revoking}
              className="text-destructive"
            >
              {revoking ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ShieldOff className="h-4 w-4 mr-1.5" />}
              Revoke portal links
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!canSend || !latest}
                onClick={() => send(true)}
              >
                <RefreshCcw className="h-4 w-4 mr-1.5" /> Resend
              </Button>
              <Button disabled={!canSend} onClick={() => send(false)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
                Send
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
