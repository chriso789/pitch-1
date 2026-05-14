import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useReferralSettings } from "@/hooks/referrals/useReferralSettings";
import { AlertTriangle } from "lucide-react";

interface Props { canManage: boolean; }

export function ReferralSettingsPanel({ canManage }: Props) {
  const { data, isLoading, save, defaults } = useReferralSettings();
  const [form, setForm] = useState<Record<string, any>>(defaults);

  useEffect(() => {
    if (data) setForm({ ...defaults, ...data });
    else setForm(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {!data && (
        <Alert><AlertDescription>Referral settings have not been configured yet. Save defaults to activate the program.</AlertDescription></Alert>
      )}

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Referral rewards should be reviewed for state/local compliance before public advertising. Do not promise guaranteed payouts until eligibility rules are met.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle className="text-sm">Program</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Enable referral program</Label>
            <Switch checked={!!form.is_enabled} onCheckedChange={(v) => set("is_enabled", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Reward</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Reward type</Label>
            <Select value={form.default_reward_type} onValueChange={(v) => set("default_reward_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_amount">Fixed amount</SelectItem>
                <SelectItem value="percentage">Percentage of revenue</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Fixed amount ($)</Label><Input type="number" value={form.fixed_reward_amount ?? 0} onChange={(e) => set("fixed_reward_amount", Number(e.target.value))} /></div>
            <div><Label>Percentage rate (%)</Label><Input type="number" value={form.percentage_reward_rate ?? 0} onChange={(e) => set("percentage_reward_rate", Number(e.target.value))} /></div>
            <div><Label>Min collected revenue ($)</Label><Input type="number" value={form.minimum_collected_revenue ?? 0} onChange={(e) => set("minimum_collected_revenue", Number(e.target.value))} /></div>
          </div>
          <div>
            <Label>Payout trigger</Label>
            <Select value={form.payout_trigger} onValueChange={(v) => set("payout_trigger", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lead_submitted">Lead submitted</SelectItem>
                <SelectItem value="appointment_completed">Appointment completed</SelectItem>
                <SelectItem value="job_sold">Job sold</SelectItem>
                <SelectItem value="job_paid">Job paid</SelectItem>
                <SelectItem value="job_completed">Job completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Allowed payout methods</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[
            ["allow_venmo", "Venmo"],
            ["allow_zelle", "Zelle"],
            ["allow_gift_card", "Gift card"],
            ["allow_stored_balance", "Stored future-work credit"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between">
              <Label>{label}</Label>
              <Switch checked={!!form[k]} onCheckedChange={(v) => set(k, v)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Require admin approval</Label>
            <Switch checked={!!form.require_admin_approval} onCheckedChange={(v) => set("require_admin_approval", v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Block self-referrals</Label>
            <Switch checked={!!form.block_self_referrals} onCheckedChange={(v) => set("block_self_referrals", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Max rewards / referrer / year</Label><Input type="number" value={form.max_rewards_per_referrer_per_year ?? 0} onChange={(e) => set("max_rewards_per_referrer_per_year", Number(e.target.value))} /></div>
            <div><Label>Duplicate window (days)</Label><Input type="number" value={form.duplicate_window_days ?? 0} onChange={(e) => set("duplicate_window_days", Number(e.target.value))} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Terms</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={6} value={form.terms_text ?? ""} onChange={(e) => set("terms_text", e.target.value)} />
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
