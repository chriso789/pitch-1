import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicCrmReferralLink, registerCrmReferralSignup, trackCrmReferralClick } from "@/lib/crmReferrals/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function PublicCrmReferralSignup() {
  const { partnerCode } = useParams<{ partnerCode: string }>();
  const [link, setLink] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ company_name: "", company_email: "", company_phone: "" });

  useEffect(() => {
    if (!partnerCode) return;
    (async () => {
      try {
        const data = await getPublicCrmReferralLink(partnerCode);
        setLink(data);
        if (data?.is_active) {
          const sp = new URLSearchParams(window.location.search);
          await trackCrmReferralClick({
            partner_code: partnerCode,
            event_type: "click",
            referrer_url: document.referrer,
            utm_source: sp.get("utm_source") || undefined,
            utm_medium: sp.get("utm_medium") || undefined,
            utm_campaign: sp.get("utm_campaign") || undefined,
          }).catch(() => {});
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to load referral link");
      } finally {
        setLoading(false);
      }
    })();
  }, [partnerCode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerCode) return;
    setSubmitting(true);
    try {
      await registerCrmReferralSignup({ partner_code: partnerCode, ...form });
      setDone(true);
      toast.success("Thanks! We'll be in touch shortly.");
    } catch (err: any) {
      toast.error(err?.message || "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!link || !link.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>Referral link not active</CardTitle></CardHeader>
          <CardContent>This referral link is invalid or no longer active.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>You were referred by {link.partner_display_name}</CardTitle>
          <p className="text-sm text-muted-foreground">Get started with Pitch CRM — the all-in-one platform for roofing &amp; construction companies.</p>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="text-sm">Thanks! Our team will reach out to {form.company_email} within 1 business day to finish setting up your account.</div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <Input placeholder="Company name" required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              <Input placeholder="Work email" type="email" required value={form.company_email} onChange={(e) => setForm({ ...form, company_email: e.target.value })} />
              <Input placeholder="Phone (optional)" value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} />
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Submitting…" : "Get started"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                By submitting you agree to be contacted about Pitch CRM.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
