import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  link: {
    id: string;
    code: string;
    referral_url?: string;
    reward_url?: string;
    customer_id?: string;
    contact?: { first_name?: string; last_name?: string; phone?: string; email?: string };
  } | null;
  companyName?: string;
}

const buildUrls = (code: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { referral_url: `${origin}/ref/${code}`, reward_url: `${origin}/ref/${code}/reward` };
};

export function SendReferralLinkDialog({ open, onOpenChange, link, companyName = "" }: Props) {
  const tenantId = useEffectiveTenantId();
  const { profile } = useUserProfile();
  const { logSend } = useReferralActions();

  const urls = link ? (link.referral_url && link.reward_url ? { referral_url: link.referral_url, reward_url: link.reward_url } : buildUrls(link.code)) : null;
  const [channel, setChannel] = useState<"sms" | "email" | "copy">("sms");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("Your personal referral link");
  const [smsBody, setSmsBody] = useState("");
  const [emailBody, setEmailBody] = useState("");

  useEffect(() => {
    if (!link || !urls) return;
    const phone = link.contact?.phone || "";
    const email = link.contact?.email || "";
    setRecipient(channel === "email" ? email : phone);
    setSmsBody(
      `Thank you again for trusting us with your project. If you know anyone who needs roofing help, here's your personal referral link: ${urls.referral_url}. You can choose Venmo, Zelle, gift card, or future work credit here: ${urls.reward_url}.`,
    );
    setEmailBody(
      `Thank you again for trusting us with your project.\n\nIf you know a friend, family member, neighbor, or property owner who needs roofing help, you can send them your personal referral link:\n\n${urls.referral_url}\n\nIf a referral qualifies, you can choose how you would like your reward handled here:\n\n${urls.reward_url}\n\nAvailable options may include Venmo, Zelle, gift card, or future work credit.\n\nThank you,\n${companyName}`,
    );
  }, [link?.id, channel]);

  if (!link || !urls) return null;

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const onSend = async () => {
    if (!tenantId) return;
    const body = channel === "email" ? emailBody : smsBody;

    if (channel === "copy") {
      copy(body, "Message");
    } else {
      // No tenant-wide messaging provider wired in for arbitrary recipients here.
      toast.info("Messaging provider not connected. Copy the message and send manually.");
      copy(body, "Message");
    }

    await logSend.mutateAsync({
      tenant_id: tenantId,
      referral_link_id: link.id,
      referrer_contact_id: link.customer_id ?? null,
      channel,
      recipient,
      sent_by: profile?.id || "",
      message_subject: channel === "email" ? subject : undefined,
      message_body: body,
      status: channel === "copy" ? "copied" : "manual_pending",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Send referral link</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v: any) => setChannel(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="copy">Copy only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {channel !== "copy" && (
            <div>
              <Label>Recipient {channel === "sms" ? "phone" : "email"}</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </div>
          )}

          {channel === "email" && (
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}

          <div>
            <Label>Message</Label>
            <Textarea
              rows={channel === "email" ? 10 : 5}
              value={channel === "email" ? emailBody : smsBody}
              onChange={(e) => channel === "email" ? setEmailBody(e.target.value) : setSmsBody(e.target.value)}
            />
          </div>

          <div className="flex gap-2 text-xs">
            <Button size="sm" variant="outline" onClick={() => copy(urls.referral_url, "Referral link")}><Copy className="h-3 w-3 mr-1" />Referral</Button>
            <Button size="sm" variant="outline" onClick={() => copy(urls.reward_url, "Reward link")}><Copy className="h-3 w-3 mr-1" />Reward</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSend}>{channel === "copy" ? "Copy" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
