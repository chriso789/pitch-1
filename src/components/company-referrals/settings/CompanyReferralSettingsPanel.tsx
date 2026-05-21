import { useState } from "react";
import { useCompanyReferralSettings, useSaveCompanyReferralSettings } from "@/hooks/companyReferrals/useCompanyReferralSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const DEFAULTS = {
  is_enabled: true,
  public_signup_page_enabled: true,
  default_reward_type: "fixed_signup_fee",
  fixed_signup_fee: 500,
  percentage_first_payment_rate: 0,
  recurring_percentage_rate: 0,
  recurring_months: 0,
  minimum_paid_amount: 0,
  payout_trigger: "active_paid",
  require_admin_approval: true,
  duplicate_window_days: 365,
  cookie_attribution_days: 90,
  allow_account_credit: true,
  allow_ach: true,
  allow_venmo: true,
  allow_zelle: true,
  allow_paypal: true,
  allow_check: true,
  max_rewards_per_partner_per_year: null as number | null,
  terms_text: "",
  internal_notes: "",
};

export function CompanyReferralSettingsPanel({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useCompanyReferralSettings(tenantId);
  const save = useSaveCompanyReferralSettings(tenantId);
  const [form, setForm] = useState<any>(null);

  const value = form ?? { ...DEFAULTS, ...(data ?? {}) };
  const set = (k: string, v: any) => setForm({ ...(value as any), [k]: v });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading settings…</div>;

  return (
    <Card>
      <CardHeader><CardTitle>Program Settings</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center justify-between p-3 border rounded-md">
            <span>Enable program</span>
            <Switch checked={!!value.is_enabled} onCheckedChange={(v) => set("is_enabled", v)} />
          </label>
          <label className="flex items-center justify-between p-3 border rounded-md">
            <span>Public signup page enabled</span>
            <Switch checked={!!value.public_signup_page_enabled} onCheckedChange={(v) => set("public_signup_page_enabled", v)} />
          </label>
          <label className="flex items-center justify-between p-3 border rounded-md">
            <span>Require admin approval</span>
            <Switch checked={!!value.require_admin_approval} onCheckedChange={(v) => set("require_admin_approval", v)} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Default reward type</Label>
            <Input value={value.default_reward_type ?? ""} onChange={(e) => set("default_reward_type", e.target.value)} />
          </div>
          <div>
            <Label>Payout trigger</Label>
            <Input value={value.payout_trigger ?? ""} onChange={(e) => set("payout_trigger", e.target.value)} />
          </div>
          <div>
            <Label>Fixed signup fee ($)</Label>
            <Input type="number" value={value.fixed_signup_fee ?? 0} onChange={(e) => set("fixed_signup_fee", Number(e.target.value))} />
          </div>
          <div>
            <Label>Minimum paid amount</Label>
            <Input type="number" value={value.minimum_paid_amount ?? 0} onChange={(e) => set("minimum_paid_amount", Number(e.target.value))} />
          </div>
          <div>
            <Label>% first payment</Label>
            <Input type="number" step="0.01" value={value.percentage_first_payment_rate ?? 0} onChange={(e) => set("percentage_first_payment_rate", Number(e.target.value))} />
          </div>
          <div>
            <Label>Recurring %</Label>
            <Input type="number" step="0.01" value={value.recurring_percentage_rate ?? 0} onChange={(e) => set("recurring_percentage_rate", Number(e.target.value))} />
          </div>
          <div>
            <Label>Recurring months</Label>
            <Input type="number" value={value.recurring_months ?? 0} onChange={(e) => set("recurring_months", Number(e.target.value))} />
          </div>
          <div>
            <Label>Duplicate window (days)</Label>
            <Input type="number" value={value.duplicate_window_days ?? 365} onChange={(e) => set("duplicate_window_days", Number(e.target.value))} />
          </div>
          <div>
            <Label>Cookie attribution (days)</Label>
            <Input type="number" value={value.cookie_attribution_days ?? 90} onChange={(e) => set("cookie_attribution_days", Number(e.target.value))} />
          </div>
          <div>
            <Label>Max rewards / partner / year</Label>
            <Input type="number" value={value.max_rewards_per_partner_per_year ?? ""} onChange={(e) => set("max_rewards_per_partner_per_year", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(["allow_ach", "allow_venmo", "allow_zelle", "allow_paypal", "allow_check", "allow_account_credit"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between p-2 border rounded-md text-sm">
              <span>{k.replace("allow_", "").toUpperCase()}</span>
              <Switch checked={!!value[k]} onCheckedChange={(v) => set(k, v)} />
            </label>
          ))}
        </div>

        <div>
          <Label>Terms text</Label>
          <Textarea rows={3} value={value.terms_text ?? ""} onChange={(e) => set("terms_text", e.target.value)} />
        </div>
        <div>
          <Label>Internal notes</Label>
          <Textarea rows={2} value={value.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={save.isPending || form == null}
            onClick={async () => {
              try { await save.mutateAsync(value); toast.success("Settings saved"); }
              catch (e: any) { toast.error(e?.message || "Save failed"); }
            }}
          >
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default CompanyReferralSettingsPanel;
