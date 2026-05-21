import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { getRoleLevel } from "@/lib/roleUtils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  approveCrmReferralPayout, createCrmReferralLink, evaluateCrmReferralPayout,
  exportCrmReferralCsv, markCrmReferralPayoutPaid, resolveCrmReferralFlag,
  type CrmReferralDataset,
} from "@/lib/crmReferrals/api";
import { Download, Plus, Copy } from "lucide-react";

function StatusBadge({ status }: { status: string | null | undefined }) {
  const v = status || "—";
  const color = ({
    paid: "bg-green-500/15 text-green-700",
    approved: "bg-blue-500/15 text-blue-700",
    pending: "bg-amber-500/15 text-amber-700",
    rejected: "bg-red-500/15 text-red-700",
    active: "bg-green-500/15 text-green-700",
    suspended: "bg-red-500/15 text-red-700",
  } as Record<string, string>)[v] || "bg-muted text-foreground";
  return <Badge variant="outline" className={color}>{v}</Badge>;
}

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

// ---- Partners ----
function PartnersSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: partners, isLoading } = useQuery({
    queryKey: ["crm-referral-partners", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_referral_partners").select("*").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    partner_name: "", partner_email: "", partner_phone: "", company_name: "", partner_type: "affiliate",
  });

  const create = useMutation({
    mutationFn: async () => {
      const partner_code = "P" + Math.random().toString(36).slice(2, 9).toUpperCase();
      const { error } = await supabase.from("crm_referral_partners").insert({
        tenant_id: tenantId, partner_code, status: "active", tier: "standard",
        ...form,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Partner created");
      qc.invalidateQueries({ queryKey: ["crm-referral-partners", tenantId] });
      setOpen(false);
      setForm({ partner_name: "", partner_email: "", partner_phone: "", company_name: "", partner_type: "affiliate" });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  const createLink = useMutation({
    mutationFn: async (partner_id: string) => {
      const res = await createCrmReferralLink({ tenant_id: tenantId, partner_id });
      await navigator.clipboard.writeText(res.signup_url).catch(() => {});
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Link copied: ${res.signup_url}`);
      qc.invalidateQueries({ queryKey: ["crm-referral-partners", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Partners</CardTitle>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New partner</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New referral partner</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} /></div>
                <div><Label>Email</Label><Input type="email" value={form.partner_email} onChange={(e) => setForm({ ...form, partner_email: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.partner_phone} onChange={(e) => setForm({ ...form, partner_phone: e.target.value })} /></div>
                <div><Label>Company</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.partner_type} onValueChange={(v) => setForm({ ...form, partner_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="affiliate">Affiliate</SelectItem>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="agency">Agency</SelectItem>
                      <SelectItem value="internal">Internal user</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !form.partner_name || !form.partner_email}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? <div>Loading…</div> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Status</TableHead>
              <TableHead>Signups</TableHead><TableHead>Earned</TableHead><TableHead>Paid</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(partners || []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.partner_name}</div>
                    <div className="text-xs text-muted-foreground">{p.partner_email}</div>
                  </TableCell>
                  <TableCell><code className="text-xs">{p.partner_code}</code></TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell>{p.total_signups}</TableCell>
                  <TableCell>{fmtMoney(p.total_earned)}</TableCell>
                  <TableCell>{fmtMoney(p.total_paid_out)}</TableCell>
                  <TableCell>
                    {canManage && (
                      <Button size="sm" variant="outline" onClick={() => createLink.mutate(p.id)}>
                        <Copy className="h-3 w-3 mr-1" />Create link
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!partners || partners.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No partners yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Signups ----
function SignupsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: signups, isLoading } = useQuery({
    queryKey: ["crm-referral-signups", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_referral_company_signups")
        .select("*, crm_referral_partners(partner_name, partner_code)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const evaluate = useMutation({
    mutationFn: (id: string) => evaluateCrmReferralPayout(id),
    onSuccess: (r) => {
      toast.success(r.eligible ? `Payout ${fmtMoney(r.amount)} created` : `Not eligible: ${r.reason}`);
      qc.invalidateQueries({ queryKey: ["crm-referral-signups", tenantId] });
      qc.invalidateQueries({ queryKey: ["crm-referral-payouts", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  const updateStatus = useMutation({
    mutationFn: async (p: { id: string; status: string; paid_at?: string | null }) => {
      const update: any = { signup_status: p.status };
      if (p.paid_at !== undefined) update.paid_at = p.paid_at;
      const { error } = await supabase.from("crm_referral_company_signups").update(update).eq("id", p.id).eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["crm-referral-signups", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Referred Companies</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div>Loading…</div> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Company</TableHead><TableHead>Partner</TableHead><TableHead>Status</TableHead>
              <TableHead>1st Invoice</TableHead><TableHead>Eligible</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(signups || []).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.company_name}</div>
                    <div className="text-xs text-muted-foreground">{s.company_email}</div>
                  </TableCell>
                  <TableCell className="text-xs">{s.crm_referral_partners?.partner_name || "—"}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select value={s.signup_status} onValueChange={(v) => {
                        updateStatus.mutate({ id: s.id, status: v, paid_at: v === "paid" ? new Date().toISOString() : undefined });
                      }}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["pending","trial","active","paid","churned","rejected"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <StatusBadge status={s.signup_status} />}
                  </TableCell>
                  <TableCell>{fmtMoney(s.first_invoice_amount)}</TableCell>
                  <TableCell>{s.payout_eligible ? <Badge>Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                  <TableCell>
                    {canManage && !s.payout_id && (
                      <Button size="sm" variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate(s.id)}>
                        Evaluate payout
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!signups || signups.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No referred companies yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Payouts ----
function PayoutsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: payouts, isLoading } = useQuery({
    queryKey: ["crm-referral-payouts", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_referral_payouts")
        .select("*, crm_referral_partners(partner_name)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => approveCrmReferralPayout(id),
    onSuccess: () => { toast.success("Approved"); qc.invalidateQueries({ queryKey: ["crm-referral-payouts", tenantId] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const markPaid = useMutation({
    mutationFn: (p: { id: string; ref?: string }) => markCrmReferralPayoutPaid(p.id, p.ref),
    onSuccess: () => { toast.success("Marked paid"); qc.invalidateQueries({ queryKey: ["crm-referral-payouts", tenantId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Payouts</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div>Loading…</div> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Partner</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead>
              <TableHead>Basis</TableHead><TableHead>Reference</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(payouts || []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{p.crm_referral_partners?.partner_name || "—"}</TableCell>
                  <TableCell>{fmtMoney(p.payout_amount)}</TableCell>
                  <TableCell><StatusBadge status={p.payout_status} /></TableCell>
                  <TableCell className="text-xs">{p.calculation_basis}</TableCell>
                  <TableCell className="text-xs">{p.payment_reference || "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {canManage && p.payout_status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => approve.mutate(p.id)}>Approve</Button>
                    )}
                    {canManage && p.payout_status === "approved" && (
                      <Button size="sm" onClick={() => {
                        const r = window.prompt("Payment reference (optional):") || undefined;
                        markPaid.mutate({ id: p.id, ref: r });
                      }}>Mark paid</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!payouts || payouts.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No payouts yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Credits ----
function CreditsSection({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["crm-referral-credits", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_referral_account_credit_ledger")
        .select("*, crm_referral_partners(partner_name)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle>Account Credit Ledger</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div>Loading…</div> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Partner</TableHead><TableHead>Type</TableHead>
              <TableHead>Amount</TableHead><TableHead>Balance</TableHead><TableHead>Description</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(data || []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{r.crm_referral_partners?.partner_name || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.transaction_type}</Badge></TableCell>
                  <TableCell>{fmtMoney(r.amount)}</TableCell>
                  <TableCell>{fmtMoney(r.balance_after)}</TableCell>
                  <TableCell className="text-xs">{r.description}</TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No credit transactions</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Flags ----
function FlagsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["crm-referral-flags", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_referral_flags").select("*").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });
  const resolve = useMutation({
    mutationFn: (p: { id: string; notes: string }) => resolveCrmReferralFlag(p.id, p.notes),
    onSuccess: () => { toast.success("Resolved"); qc.invalidateQueries({ queryKey: ["crm-referral-flags", tenantId] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Fraud Flags</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div>Loading…</div> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Reason</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead>
              <TableHead>Details</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(data || []).map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell>{f.flag_reason}</TableCell>
                  <TableCell><Badge variant="outline">{f.severity}</Badge></TableCell>
                  <TableCell><StatusBadge status={f.status} /></TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{f.flag_details}</TableCell>
                  <TableCell>
                    {canManage && f.status !== "resolved" && (
                      <Button size="sm" variant="outline" onClick={() => {
                        const n = window.prompt("Resolution notes:") || "";
                        resolve.mutate({ id: f.id, notes: n });
                      }}>Resolve</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No flags</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Settings ----
function SettingsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: s } = useQuery({
    queryKey: ["crm-referral-settings", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_referral_program_settings")
        .select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [local, setLocal] = useState<any>(null);
  const cur = local ?? s ?? {};
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...cur, tenant_id: tenantId };
      delete payload.id; delete payload.created_at; delete payload.updated_at;
      const { error } = await supabase.from("crm_referral_program_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["crm-referral-settings", tenantId] }); setLocal(null); },
    onError: (e: any) => toast.error(e?.message),
  });
  const update = (patch: any) => setLocal({ ...cur, ...patch });
  return (
    <Card>
      <CardHeader><CardTitle>Program Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between"><Label>Program enabled</Label>
          <Switch checked={!!cur.program_enabled} onCheckedChange={(v) => update({ program_enabled: v })} disabled={!canManage} /></div>
        <div className="flex items-center justify-between"><Label>Auto-approve partners</Label>
          <Switch checked={!!cur.auto_approve_partners} onCheckedChange={(v) => update({ auto_approve_partners: v })} disabled={!canManage} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Default payout type</Label>
            <Select value={cur.default_payout_type || "flat_fee"} onValueChange={(v) => update({ default_payout_type: v })} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat_fee">Flat fee</SelectItem>
                <SelectItem value="first_invoice_percentage">% of first invoice</SelectItem>
                <SelectItem value="first_year_percentage">% of first year</SelectItem>
                <SelectItem value="stored_credit">Stored credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Default payout value</Label>
            <Input type="number" value={cur.default_payout_value ?? 0} onChange={(e) => update({ default_payout_value: Number(e.target.value) })} disabled={!canManage} /></div>
          <div><Label>Min payout threshold</Label>
            <Input type="number" value={cur.min_payout_threshold ?? 0} onChange={(e) => update({ min_payout_threshold: Number(e.target.value) })} disabled={!canManage} /></div>
          <div><Label>Payout schedule</Label>
            <Input value={cur.payout_schedule || ""} onChange={(e) => update({ payout_schedule: e.target.value })} disabled={!canManage} /></div>
        </div>
        <div className="flex items-center justify-between"><Label>Block self-referrals</Label>
          <Switch checked={!!cur.self_referral_block} onCheckedChange={(v) => update({ self_referral_block: v })} disabled={!canManage} /></div>
        <div className="flex items-center justify-between"><Label>Duplicate company check</Label>
          <Switch checked={!!cur.duplicate_company_check} onCheckedChange={(v) => update({ duplicate_company_check: v })} disabled={!canManage} /></div>
        <div><Label>Custom terms</Label>
          <Textarea value={cur.custom_terms || ""} onChange={(e) => update({ custom_terms: e.target.value })} disabled={!canManage} /></div>
        {canManage && <Button onClick={() => save.mutate()} disabled={!local || save.isPending}>Save settings</Button>}
      </CardContent>
    </Card>
  );
}

// ---- Main tab ----
export function CrmReferralProgramTab() {
  const tenantId = useEffectiveTenantId();
  const { profile } = useUserProfile();
  const canManage = getRoleLevel(profile?.role || "") <= 6;
  const canAdmin = getRoleLevel(profile?.role || "") <= 4;
  const [tab, setTab] = useState("partners");

  if (!tenantId) return <div className="text-muted-foreground">Loading tenant…</div>;

  async function doExport(dataset: CrmReferralDataset) {
    try { await exportCrmReferralCsv({ tenant_id: tenantId!, dataset }); }
    catch (e: any) { toast.error(e?.message || "Export failed"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">CRM Signup Referral Program</h2>
          <p className="text-sm text-muted-foreground">Reward partners who refer companies to sign up for Pitch CRM.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["partners","links","signups","payouts","credits","flags"] as CrmReferralDataset[]).map((d) => (
            <Button key={d} size="sm" variant="outline" onClick={() => doExport(d)}
              disabled={(d === "payouts" || d === "credits") && !canAdmin}>
              <Download className="h-3 w-3 mr-1" />{d}
            </Button>
          ))}
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="partners">Partners</TabsTrigger>
          <TabsTrigger value="signups">Signups</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="flags">Flags</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="partners" className="mt-4"><PartnersSection tenantId={tenantId} canManage={canManage} /></TabsContent>
        <TabsContent value="signups" className="mt-4"><SignupsSection tenantId={tenantId} canManage={canManage} /></TabsContent>
        <TabsContent value="payouts" className="mt-4"><PayoutsSection tenantId={tenantId} canManage={canAdmin} /></TabsContent>
        <TabsContent value="credits" className="mt-4"><CreditsSection tenantId={tenantId} /></TabsContent>
        <TabsContent value="flags" className="mt-4"><FlagsSection tenantId={tenantId} canManage={canManage} /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsSection tenantId={tenantId} canManage={canAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}
