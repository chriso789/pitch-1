import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getPublicReferralPage } from "@/lib/referrals/api";
import { useReferralTracking } from "@/hooks/referrals/useReferralTracking";
import { useSubmitReferralLead } from "@/hooks/referrals/useSubmitReferralLead";
import { Loader2, CheckCircle2, Gift } from "lucide-react";

export default function PublicReferralLanding() {
  const { referralCode } = useParams<{ referralCode: string }>();
  const { toast } = useToast();
  const [page, setPage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { track } = useReferralTracking(referralCode);
  const { submit, loading: submitting, success } = useSubmitReferralLead(referralCode);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    project_type: "",
    notes: "",
    consent: false,
  });

  useEffect(() => {
    if (!referralCode) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getPublicReferralPage(referralCode);
        if (cancelled) return;
        if (!data || data.is_active === false) {
          setNotFound(true);
        } else {
          setPage(data);
          track("page_view");
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [referralCode, track]);

  const brandColor = useMemo(() => page?.brand_primary_color || "hsl(var(--primary))", [page]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consent) {
      toast({ title: "Consent required", description: "Please confirm you agree to be contacted.", variant: "destructive" });
      return;
    }
    try {
      await submit({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zip_code: form.zip_code,
        project_type: form.project_type,
        notes: form.notes,
        consent: form.consent,
      });
      toast({ title: "Thanks!", description: "We'll reach out shortly." });
    } catch (e: any) {
      toast({ title: "Submission failed", description: e?.message ?? "Try again later", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Referral link not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            This referral link is no longer active. Please check the URL or contact the person who shared it with you.
          </CardContent>
        </Card>
      </div>
    );
  }

  const headline = page?.landing_headline || `${page?.referrer_first_name || "A friend"} recommends us`;
  const message =
    page?.landing_message ||
    `${page?.referrer_first_name || "Your friend"} thought you'd love working with our team. Tell us about your project and we'll be in touch.`;

  return (
    <div className="min-h-screen bg-background">
      <header
        className="w-full py-12 px-6 text-primary-foreground"
        style={{ background: brandColor }}
      >
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-background/15 backdrop-blur-sm rounded-full px-3 py-1 text-sm mb-4">
            <Gift className="h-4 w-4" /> Referred by {page?.referrer_first_name}
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-3">{headline}</h1>
          <p className="text-lg opacity-90 max-w-2xl">{message}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 grid md:grid-cols-5 gap-8">
        {(page?.landing_hero_image_url || page?.hero_image_url) && (
          <div className="md:col-span-2">
            <img
              src={page.landing_hero_image_url || page.hero_image_url}
              alt="Featured project"
              className="rounded-lg w-full object-cover aspect-[4/5]"
              loading="lazy"
            />
          </div>
        )}

        <div className={page?.landing_hero_image_url || page?.hero_image_url ? "md:col-span-3" : "md:col-span-5"}>
          <Card>
            <CardHeader>
              <CardTitle>Tell us about your project</CardTitle>
            </CardHeader>
            <CardContent>
              {success ? (
                <div className="text-center py-8 space-y-4">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
                  <h2 className="text-xl font-semibold">{success.message || "Thanks for reaching out!"}</h2>
                  <p className="text-muted-foreground">We've notified the team and will follow up soon.</p>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="first_name">First name</Label>
                      <Input id="first_name" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="last_name">Last name</Label>
                      <Input id="last_name" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="address">Property address</Label>
                    <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                    <Input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                    <Input placeholder="ZIP" value={form.zip_code} onChange={(e) => setForm({ ...form, zip_code: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="project_type">Project type</Label>
                    <Input id="project_type" placeholder="Roof, Siding, Storm damage…" value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                  <label className="flex items-start gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.consent}
                      onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                    />
                    <span>
                      I agree to be contacted by phone, SMS, or email about my project. Message and data rates may apply.
                    </span>
                  </label>
                  <Button type="submit" className="w-full" disabled={submitting} style={{ background: brandColor }}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Get my free quote
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Are you {page?.referrer_first_name}?{" "}
            <Link to={`/ref/${referralCode}/reward`} className="underline">
              Choose your reward
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
