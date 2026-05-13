import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { createReferralLink } from "@/lib/referrals/api";
import { Gift, Copy, Loader2, Mail, MessageSquare, Check } from "lucide-react";

interface Props {
  contactId: string;
  jobId?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
}

export function SendReferralLinkButton({
  contactId,
  jobId,
  variant = "outline",
  size = "sm",
  label = "Send Referral Link",
}: Props) {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<{
    referral_url: string;
    reward_url: string;
    share_message_sms: string;
    share_message_email_subject: string;
    share_message_email_body: string;
  } | null>(null);

  async function generate() {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await createReferralLink({
        tenant_id: activeTenantId,
        referrer_contact_id: contactId,
        source_job_id: jobId,
      });
      setLink({
        referral_url: res.referral_url,
        reward_url: res.reward_url,
        share_message_sms: res.share_message_sms,
        share_message_email_subject: res.share_message_email_subject,
        share_message_email_body: res.share_message_email_body,
      });
    } catch (e: any) {
      toast({
        title: "Could not create referral link",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: "Copied to clipboard" });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !link) generate();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <Gift className="h-4 w-4 mr-2" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a referral link</DialogTitle>
          <DialogDescription>
            Share this customer's unique referral link. They'll earn a reward when a referred lead becomes a sold job.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {link && (
          <Tabs defaultValue="link" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="link">Link</TabsTrigger>
              <TabsTrigger value="sms"><MessageSquare className="h-3 w-3 mr-1" />SMS</TabsTrigger>
              <TabsTrigger value="email"><Mail className="h-3 w-3 mr-1" />Email</TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="space-y-3">
              <div>
                <Label className="text-xs">Referral landing page</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly value={link.referral_url} />
                  <Button size="icon" variant="outline" onClick={() => copy(link.referral_url)}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Reward preference page (for the referrer)</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly value={link.reward_url} />
                  <Button size="icon" variant="outline" onClick={() => copy(link.reward_url)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="sms" className="space-y-3">
              <Textarea readOnly value={link.share_message_sms} rows={5} />
              <Button onClick={() => copy(link.share_message_sms)} variant="outline" size="sm" className="w-full">
                <Copy className="h-4 w-4 mr-2" /> Copy SMS message
              </Button>
            </TabsContent>

            <TabsContent value="email" className="space-y-3">
              <div>
                <Label className="text-xs">Subject</Label>
                <Input readOnly value={link.share_message_email_subject} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Body</Label>
                <Textarea readOnly value={link.share_message_email_body} rows={8} className="mt-1" />
              </div>
              <Button
                onClick={() => copy(link.share_message_email_body)}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Copy className="h-4 w-4 mr-2" /> Copy email body
              </Button>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
