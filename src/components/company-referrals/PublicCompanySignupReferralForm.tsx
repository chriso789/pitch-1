import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { submitCrmReferralCompanySignup } from "@/lib/companyReferrals/companyReferralApi";
import {
  getOrCreateCrmReferralVisitorId, getOrCreateCrmReferralSessionId, getCrmReferralTrackingParams,
} from "@/lib/companyReferrals/companyReferralTracking";

interface Props {
  partnerCode: string;
  onSubmitted?: () => void;
  onFirstFocus?: () => void;
}

const TRADES = ["Roofing", "Restoration", "General Contractor", "Solar", "Gutters", "Windows/Doors", "HVAC", "Other"];

export function PublicCompanySignupReferralForm({ partnerCode, onSubmitted, onFirstFocus }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [focused, setFocused] = useState(false);
  const [form, setForm] = useState({
    referred_company_name: "",
    referred_owner_first_name: "",
    referred_owner_last_name: "",
    referred_owner_email: "",
    referred_owner_phone: "",
    referred_company_website: "",
    referred_company_trade: "",
    referred_company_city: "",
    referred_company_state: "",
    current_crm: "",
    number_of_users: "",
    message: "",
    consent_to_contact: false,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const handleFirstFocus = () => {
    if (focused) return;
    setFocused(true);
    onFirstFocus?.();
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consent_to_contact) return toast.error("Please agree to be contacted.");
    if (!form.referred_company_name || !form.referred_owner_first_name || !form.referred_owner_email || !form.referred_owner_phone) {
      return toast.error("Please fill in required fields.");
    }
    setSubmitting(true);
    try {
      const tracking = getCrmReferralTrackingParams();
      await submitCrmReferralCompanySignup({
        partner_code: partnerCode,
        visitor_id: getOrCreateCrmReferralVisitorId(),
        session_id: getOrCreateCrmReferralSessionId(),
        ...form,
        referred_owner_name: `${form.referred_owner_first_name} ${form.referred_owner_last_name}`.trim(),
        ...tracking,
      });
      setDone(true);
      onSubmitted?.();
      toast.success("Thanks! We'll be in touch shortly.");
    } catch (err: any) {
      toast.error(err?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="py-10 text-center space-y-3">
          <h2 className="text-2xl font-semibold">You're on the list.</h2>
          <p className="text-muted-foreground">
            We'll reach out shortly to walk you through Pitch CRM.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="py-6">
        <form onSubmit={onSubmit} onFocus={handleFirstFocus} className="space-y-4">
          <div>
            <Label htmlFor="company">Company name *</Label>
            <Input id="company" required value={form.referred_company_name}
              onChange={(e) => set("referred_company_name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first">First name *</Label>
              <Input id="first" required value={form.referred_owner_first_name}
                onChange={(e) => set("referred_owner_first_name", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="last">Last name</Label>
              <Input id="last" value={form.referred_owner_last_name}
                onChange={(e) => set("referred_owner_last_name", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" required value={form.referred_owner_email}
                onChange={(e) => set("referred_owner_email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone *</Label>
              <Input id="phone" type="tel" required value={form.referred_owner_phone}
                onChange={(e) => set("referred_owner_phone", e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="website">Website</Label>
            <Input id="website" value={form.referred_company_website}
              onChange={(e) => set("referred_company_website", e.target.value)} />
          </div>
          <div>
            <Label>Trade</Label>
            <Select value={form.referred_company_trade} onValueChange={(v) => set("referred_company_trade", v)}>
              <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
              <SelectContent>
                {TRADES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={form.referred_company_city}
                onChange={(e) => set("referred_company_city", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" value={form.referred_company_state}
                onChange={(e) => set("referred_company_state", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="crm">Current CRM</Label>
              <Input id="crm" value={form.current_crm} onChange={(e) => set("current_crm", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="users">Number of users</Label>
              <Input id="users" type="number" min={1} value={form.number_of_users}
                onChange={(e) => set("number_of_users", e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="msg">Message</Label>
            <Textarea id="msg" value={form.message} onChange={(e) => set("message", e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox checked={form.consent_to_contact}
              onCheckedChange={(v) => set("consent_to_contact", v === true)} />
            <span>I agree to be contacted about Pitch CRM.</span>
          </label>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Submitting…" : "Start Company Signup"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default PublicCompanySignupReferralForm;
