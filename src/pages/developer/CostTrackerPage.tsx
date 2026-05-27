import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/UserProfileContext";
import {
  costTrackerApi, type Dashboard, type CompanyRow, type CompanyDetail,
  type ProviderCost, type UserRow, type FeatureRow, type ProviderBreakdownRow,
  type UnassignedEvent, type CoverageRow, type RollupStatus, type ZeroCostRow,
} from "@/lib/developer/costTrackerApi";
import { PLAN_TEMPLATES, PLAN_TEMPLATE_LIST, targetInfraCost } from "@/lib/developer/planTemplates";
import { STATUS_STYLE, STATUS_LABEL, resolveStatus, fmtMoney, fmtPct, fmtNum } from "@/components/developer/cost-tracker/status";
import CostTrackerHeader from "@/components/developer/cost-tracker/CostTrackerHeader";
import CostKpiCards from "@/components/developer/cost-tracker/CostKpiCards";

function UsageBar({ used, limit }: { used: number; limit: number }) {
  if (!limit) return <span className="text-xs text-muted-foreground">{fmtNum(used)} / —</span>;
  const pct = Math.min(150, Math.round((used / limit) * 100));
  return (
    <div className="min-w-[110px] space-y-1">
      <div className="text-xs">{fmtNum(used)} / {fmtNum(limit)}</div>
      <Progress value={Math.min(100, pct)} className="h-1.5" />
    </div>
  );
}

function csvDownload(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return toast.error("Nothing to export");
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function CostTrackerPage() {
  const { profile } = useUserProfile();
  const isMaster = profile?.role === "master";

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [providers, setProviders] = useState<ProviderCost[]>([]);
  const [providerBd, setProviderBd] = useState<ProviderBreakdownRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedEvent[]>([]);
  const [zeroCost, setZeroCost] = useState<ZeroCostRow[]>([]);
  const [rollupStatus, setRollupStatus] = useState<RollupStatus | null>(null);
  const [secretConfigured, setSecretConfigured] = useState<boolean | null>(null);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [drawerTenant, setDrawerTenant] = useState<string | null>(null);
  const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
  const [tab, setTab] = useState("overview");
  const [limitsTenant, setLimitsTenant] = useState<string>("");
  const [limitsDraft, setLimitsDraft] = useState<Record<string, any>>({});

  async function loadAll() {
    setLoading(true);
    const [d, c, p, s, cov, u, fb, pb, ua, rs, zc] = await Promise.all([
      costTrackerApi.getDashboard(),
      costTrackerApi.getCompanies(),
      costTrackerApi.getProviderCosts(),
      costTrackerApi.getInternalSecretStatus(),
      costTrackerApi.getCoverageChecklist(),
      costTrackerApi.getUsers(),
      costTrackerApi.getFeatureBreakdown(),
      costTrackerApi.getProviderBreakdown(),
      costTrackerApi.getUnassignedEvents(),
      costTrackerApi.getRollupStatus(),
      costTrackerApi.getZeroCostEvents(),
    ]);
    if (d.data) setDashboard(d.data); else if (d.error) toast.error(`Dashboard: ${d.error}`);
    if (c.data) setCompanies(c.data.rows ?? []);
    if (p.data) setProviders(p.data.rows ?? []);
    if (s.data) setSecretConfigured(s.data.configured);
    if (cov.data) setCoverage(cov.data.rows ?? []);
    if (u.data) setUsers(u.data.rows ?? []);
    if (fb.data) setFeatures(fb.data.rows ?? []);
    if (pb.data) setProviderBd(pb.data.rows ?? []);
    if (ua.data) setUnassigned(ua.data.rows ?? []);
    if (rs.data) setRollupStatus(rs.data);
    if (zc.data) setZeroCost(zc.data.rows ?? []);
    setLoading(false);
  }

  useEffect(() => { if (isMaster) loadAll(); }, [isMaster]);

  async function openCompany(tenantId: string) {
    setDrawerTenant(tenantId);
    setCompanyDetail(null);
    const { data, error } = await costTrackerApi.getCompanyDetail(tenantId);
    if (error) toast.error(error); else setCompanyDetail(data);
  }
  async function recalc() {
    const { error } = await costTrackerApi.recalculateRollups();
    if (error) toast.error(error); else { toast.success("Rollups recalculated"); loadAll(); }
  }
  async function seedTest(event_type: string, provider: string, qty = 1, extra: any = {}) {
    const { error } = await costTrackerApi.seedTestEvent(event_type, provider, qty, extra);
    if (error) toast.error(error); else toast.success(`Logged ${provider}/${event_type}`);
  }
  async function updateProvider(id: string, patch: Partial<ProviderCost>) {
    const { error } = await costTrackerApi.updateProviderCost({ id, ...patch });
    if (error) toast.error(error); else { toast.success("Updated"); loadAll(); }
  }
  async function assignUnassigned(eventId: string) {
    const tenantId = prompt("Tenant ID to assign:");
    if (!tenantId) return;
    const reason = prompt("Reason (optional):") ?? undefined;
    const { error } = await costTrackerApi.assignUsageEventCompany(eventId, tenantId, reason);
    if (error) toast.error(error); else { toast.success("Assigned"); loadAll(); }
  }
  function applyTemplate(key: string) {
    const t = PLAN_TEMPLATES[key];
    if (!t) return;
    setLimitsDraft({ ...limitsDraft, ...t });
    toast.success(`Applied ${t.plan_name} template — review then Save`);
  }
  async function saveLimits() {
    if (!limitsTenant) return toast.error("Pick a company first");
    const { error } = await costTrackerApi.updateCompanyUsageLimits({ tenant_id: limitsTenant, ...limitsDraft });
    if (error) toast.error(error); else { toast.success("Limits saved"); loadAll(); }
  }

  function generateSecret() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setGeneratedSecret(`PITCH_INTERNAL_WORKER_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  }

  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      if (filter && !c.name?.toLowerCase().includes(filter.toLowerCase())) return false;
      if (statusFilter !== "all") {
        const status = resolveStatus(c.gross_margin_percent, c.cost_mtd, c.monthly_price, 1);
        if (statusFilter === "losing" && status !== "losing_money") return false;
        if (statusFilter === "over_cost" && status !== "over_cost") return false;
        if (statusFilter === "watch" && status !== "watch") return false;
        if (statusFilter === "good" && status !== "good") return false;
      }
      return true;
    });
  }, [companies, filter, statusFilter]);

  if (!profile) {
    return <div className="container mx-auto p-6"><Skeleton className="h-32 w-full" /></div>;
  }
  if (!isMaster) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader><CardTitle>Access denied</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This page is restricted to platform administrators.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <CostTrackerHeader
        month={dashboard?.month ?? null}
        rollupStale={rollupStatus?.stale ?? true}
        rollupAt={rollupStatus?.last_recalc_at ?? null}
        onRefresh={loadAll}
        onRecalculate={recalc}
        onExport={() => csvDownload(`companies-${dashboard?.month}.csv`, filteredCompanies)}
        onSeedFocus={() => setTab("settings")}
        onSecretFocus={() => setTab("settings")}
        busy={loading}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="limits">Limits</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned {unassigned.length > 0 && <Badge variant="secondary" className="ml-1">{unassigned.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* ===== Overview ===== */}
        <TabsContent value="overview" className="space-y-4">
          <CostKpiCards dashboard={dashboard} companies={companies} />
          {zeroCost.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Zero-cost event warnings</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">
                  These provider/event_type combos logged events at $0 — likely missing or inactive in <code>provider_costs</code>.
                </p>
                <Table>
                  <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Event type</TableHead><TableHead className="text-right">Count</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {zeroCost.map((z) => (
                      <TableRow key={`${z.provider}::${z.event_type}`}>
                        <TableCell>{z.provider}</TableCell>
                        <TableCell className="font-mono text-xs">{z.event_type}</TableCell>
                        <TableCell className="text-right">{z.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Companies ===== */}
        <TabsContent value="companies">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>Companies</CardTitle>
              <div className="flex gap-2">
                <Input placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="watch">Watch</SelectItem>
                    <SelectItem value="over_cost">Over plan cost</SelectItem>
                    <SelectItem value="losing">Losing money</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">GP</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead>SMS</TableHead>
                      <TableHead>AI prompts</TableHead>
                      <TableHead>AI tokens</TableHead>
                      <TableHead>Storage</TableHead>
                      <TableHead>Roof reports</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && <TableRow><TableCell colSpan={13}><Skeleton className="h-6 w-full" /></TableCell></TableRow>}
                    {!loading && filteredCompanies.map((r) => {
                      const status = resolveStatus(r.gross_margin_percent, r.cost_mtd, r.monthly_price, 1);
                      return (
                        <TableRow key={r.tenant_id} className="cursor-pointer" onClick={() => openCompany(r.tenant_id)}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell>{r.plan_name}</TableCell>
                          <TableCell className="text-right">{fmtMoney(r.monthly_price)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(r.cost_mtd)}</TableCell>
                          <TableCell className={`text-right ${r.gross_profit < 0 ? "text-destructive" : ""}`}>{fmtMoney(r.gross_profit)}</TableCell>
                          <TableCell className="text-right">{fmtPct(r.gross_margin_percent)}</TableCell>
                          <TableCell><UsageBar used={r.sms_used} limit={r.sms_limit} /></TableCell>
                          <TableCell><UsageBar used={r.ai_prompts_used} limit={r.ai_prompts_limit} /></TableCell>
                          <TableCell><UsageBar used={r.ai_tokens_used} limit={r.ai_tokens_limit} /></TableCell>
                          <TableCell><UsageBar used={r.storage_used} limit={r.storage_limit} /></TableCell>
                          <TableCell><UsageBar used={r.roof_reports_used} limit={r.roof_reports_limit} /></TableCell>
                          <TableCell><Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge></TableCell>
                          <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setLimitsTenant(r.tenant_id); setTab("limits"); }}>Edit</Button></TableCell>
                        </TableRow>
                      );
                    })}
                    {!loading && !filteredCompanies.length && (
                      <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground">No companies match.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Users ===== */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Users</CardTitle>
              <Button size="sm" variant="outline" onClick={() => csvDownload(`users-${dashboard?.month}.csv`, users)}>Export CSV</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">SMS</TableHead>
                    <TableHead className="text-right">AI prompts</TableHead>
                    <TableHead className="text-right">AI tokens</TableHead>
                    <TableHead className="text-right">Voice min</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.user_id}>
                      <TableCell><div className="text-sm">{u.full_name ?? "—"}</div><div className="text-xs text-muted-foreground">{u.email ?? u.user_id}</div></TableCell>
                      <TableCell>{u.company_name ?? <span className="text-xs text-muted-foreground">unassigned</span>}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.event_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.sms_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.ai_prompt_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.ai_token_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.voice_minutes)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(u.estimated_cost)}</TableCell>
                    </TableRow>
                  ))}
                  {!users.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No user usage yet this month.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Providers ===== */}
        <TabsContent value="providers" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Provider breakdown (MTD)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Provider</TableHead><TableHead>Event type</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {providerBd.map((r) => (
                    <TableRow key={`${r.provider}::${r.event_type}`}>
                      <TableCell>{r.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{r.event_type}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.event_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.total_quantity)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.total_cost)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.total_billable)}</TableCell>
                    </TableRow>
                  ))}
                  {!providerBd.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No events yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Provider pricing editor</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Changes affect future calculations only unless rollups are recalculated.</p>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Provider</TableHead><TableHead>Event type</TableHead><TableHead>Unit</TableHead>
                  <TableHead className="text-right">Cost / unit</TableHead><TableHead className="text-right">Markup %</TableHead><TableHead>Active</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{p.event_type}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" step="0.0000001" defaultValue={p.cost_per_unit} className="ml-auto w-32"
                          onBlur={(e) => { const v = Number(e.target.value); if (v !== p.cost_per_unit) updateProvider(p.id, { cost_per_unit: v }); }} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" step="1" defaultValue={p.markup_percent} className="ml-auto w-20"
                          onBlur={(e) => { const v = Number(e.target.value); if (v !== p.markup_percent) updateProvider(p.id, { markup_percent: v }); }} />
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant={p.is_active ? "default" : "outline"} onClick={() => updateProvider(p.id, { is_active: !p.is_active })}>
                          {p.is_active ? "Active" : "Disabled"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Features ===== */}
        <TabsContent value="features">
          <Card>
            <CardHeader><CardTitle>Feature breakdown (MTD)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Feature area</TableHead><TableHead>Event types</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Top tenant</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {features.map((f) => (
                    <TableRow key={f.feature_area}>
                      <TableCell className="font-medium">{f.feature_area}</TableCell>
                      <TableCell className="font-mono text-xs">{f.event_types.join(", ")}</TableCell>
                      <TableCell className="text-right">{fmtNum(f.event_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(f.total_quantity)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(f.total_cost)}</TableCell>
                      <TableCell className="text-xs">{f.top_tenant_id ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!features.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No events yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Limits ===== */}
        <TabsContent value="limits">
          <Card>
            <CardHeader><CardTitle>Usage limits</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Company</label>
                  <Select value={limitsTenant} onValueChange={(v) => { setLimitsTenant(v); const cur = companies.find((c) => c.tenant_id === v); if (cur) setLimitsDraft({ plan_name: cur.plan_name, monthly_price: cur.monthly_price, sms_monthly_limit: cur.sms_limit, ai_prompt_monthly_limit: cur.ai_prompts_limit, ai_token_monthly_limit: cur.ai_tokens_limit, storage_mb_limit: cur.storage_limit, roof_report_monthly_limit: cur.roof_reports_limit }); }}>
                    <SelectTrigger className="w-72"><SelectValue placeholder="Choose company…" /></SelectTrigger>
                    <SelectContent>{companies.map((c) => <SelectItem key={c.tenant_id} value={c.tenant_id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Apply template</label>
                  <div className="flex gap-2">
                    {PLAN_TEMPLATE_LIST.map((t) => (
                      <Button key={t.key} size="sm" variant="outline" onClick={() => applyTemplate(t.key)}>{t.plan_name}</Button>
                    ))}
                  </div>
                </div>
                <div className="ml-auto"><Button onClick={saveLimits} disabled={!limitsTenant}>Save limits</Button></div>
              </div>

              {limitsTenant && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {[
                    ["plan_name", "Plan name", "text"],
                    ["monthly_price", "Monthly price ($)", "number"],
                    ["sms_monthly_limit", "SMS limit", "number"],
                    ["ai_prompt_monthly_limit", "AI prompts limit", "number"],
                    ["ai_token_monthly_limit", "AI tokens limit", "number"],
                    ["storage_mb_limit", "Storage MB", "number"],
                    ["map_load_monthly_limit", "Map loads", "number"],
                    ["scrape_monthly_limit", "Scrapes", "number"],
                    ["roof_report_monthly_limit", "Roof reports", "number"],
                    ["voice_minute_monthly_limit", "Voice minutes", "number"],
                    ["warning_threshold_percent", "Warning % threshold", "number"],
                  ].map(([k, label, type]) => (
                    <div key={k} className="space-y-1">
                      <label className="text-xs text-muted-foreground">{label}</label>
                      <Input type={type as string} value={(limitsDraft as any)[k as string] ?? ""}
                        onChange={(e) => setLimitsDraft({ ...limitsDraft, [k as string]: type === "number" ? Number(e.target.value) : e.target.value })} />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Hard stop on limit</label>
                    <Select value={String(limitsDraft.hard_stop_enabled ?? true)} onValueChange={(v) => setLimitsDraft({ ...limitsDraft, hard_stop_enabled: v === "true" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="true">Enabled</SelectItem><SelectItem value="false">Disabled</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                Do not offer unlimited SMS, AI, roof reports, or storage without overage billing.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Coverage ===== */}
        <TabsContent value="coverage">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Hot-path tracking coverage (last 30 days)</CardTitle>
              <Button size="sm" variant="outline" onClick={async () => { const { data, error } = await costTrackerApi.getCoverageChecklist(); if (error) toast.error(error); else { setCoverage(data?.rows ?? []); toast.success("Coverage refreshed"); } }}>Run audit</Button>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                {coverage.map((row) => (
                  <li key={row.key} className="flex items-center justify-between rounded-md border p-2">
                    <span>{row.label}</span>
                    <Badge className={row.status === "green" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : row.status === "yellow" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-destructive/15 text-destructive"}>
                      {row.status === "green" ? "Wired" : row.status === "yellow" ? "Pending" : "Not wired"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Unassigned ===== */}
        <TabsContent value="unassigned">
          <Card>
            <CardHeader><CardTitle>Unassigned usage events</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Time</TableHead><TableHead>Provider</TableHead><TableHead>Event</TableHead>
                  <TableHead>Feature</TableHead><TableHead>User</TableHead><TableHead className="text-right">Cost</TableHead>
                  <TableHead>Suggestion</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {unassigned.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell>{e.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
                      <TableCell>{e.feature_area ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{e.user_id?.slice(0, 8) ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmtMoney(e.estimated_cost)}</TableCell>
                      <TableCell className="text-xs">{e.suggested_resolution}</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => assignUnassigned(e.id)}>Assign</Button></TableCell>
                    </TableRow>
                  ))}
                  {!unassigned.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">All events are assigned.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Settings ===== */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Internal worker secret</CardTitle>
              {secretConfigured === null ? <Badge variant="outline">Checking…</Badge>
                : secretConfigured ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Configured</Badge>
                : <Badge className="bg-destructive/15 text-destructive">Missing</Badge>}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {secretConfigured ? (
                <p className="text-muted-foreground">trackUsage() and checkUsageLimit() can authenticate server-to-server. Value never displayed.</p>
              ) : (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>Click Generate below.</li>
                    <li>Copy the secret.</li>
                    <li>Supabase → Project Settings → Edge Functions → Secrets, add <code className="rounded bg-muted px-1">INTERNAL_WORKER_SECRET</code>.</li>
                    <li>Reload — status turns green.</li>
                  </ol>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={generateSecret}>Generate</Button>
                    {generatedSecret && <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(generatedSecret); toast.success("Copied"); }}>Copy</Button>}
                  </div>
                  {generatedSecret && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-400">Shown once — paste into Supabase Secrets now.</div>
                      <code className="mt-2 block break-all rounded bg-background p-2 font-mono text-xs">{generatedSecret}</code>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Rollups</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>Last recalc: {rollupStatus?.last_recalc_at ? new Date(rollupStatus.last_recalc_at).toLocaleString() : "never"}{rollupStatus?.stale && <Badge className="ml-2 bg-amber-500/15 text-amber-700 dark:text-amber-400">stale</Badge>}</div>
              <Button size="sm" onClick={recalc}>Manual recalculate</Button>
              <p className="text-xs text-muted-foreground">Schedule via Supabase pg_cron hitting <code>/recalculate-rollups</code> with <code>x-internal-secret</code>. Do not hardcode secrets in migrations.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Test events</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => seedTest("ai_generation", "lovable-ai", 1, { feature_area: "estimate_generation" })}>Test AI</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("sms_outbound", "telnyx", 1, { feature_area: "communications" })}>Test SMS</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("storage_mb", "supabase", 100, { feature_area: "storage" })}>Test Upload</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("map_load", "mapbox", 1, { feature_area: "canvassing" })}>Test Map Load</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("scrape_credit", "firecrawl", 1, { feature_area: "permits" })}>Test Scrape</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("roof_report", "eagleview", 1, { feature_area: "measurements" })}>Test Roof Report</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("edge_invocation", "supabase", 1, { feature_area: "infrastructure" })}>Test Edge Invocation</Button>
              <Button size="sm" variant="outline" onClick={() => seedTest("sms_outbound", "telnyx", 1, { status: "blocked_limit", feature_area: "bulk_sms" })}>Test Blocked Limit</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Company drawer */}
      <Sheet open={!!drawerTenant} onOpenChange={(o) => { if (!o) { setDrawerTenant(null); setCompanyDetail(null); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader><SheetTitle>{companyDetail?.tenant?.name ?? "Company"}</SheetTitle></SheetHeader>
          {!companyDetail ? <Skeleton className="mt-4 h-40 w-full" /> : (
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Revenue</div><div className="font-semibold">{fmtMoney(companyDetail.totals.revenue)}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Cost MTD</div><div className="font-semibold">{fmtMoney(companyDetail.totals.cost_mtd)}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Projected end-of-month</div><div className="font-semibold">{fmtMoney(companyDetail.totals.projected_month_end)}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Projected margin</div><div className="font-semibold">{fmtPct(companyDetail.totals.projected_margin_percent)}</div></div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">By provider</div>
                <div className="space-y-1">
                  {Object.entries(companyDetail.by_provider).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded border px-2 py-1"><span>{k}</span><span>{fmtMoney(v)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">By feature</div>
                <div className="space-y-1">
                  {Object.entries(companyDetail.by_feature).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded border px-2 py-1"><span>{k}</span><span>{fmtMoney(v)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Recent events</div>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {companyDetail.events.slice(0, 50).map((e: any) => (
                    <div key={e.id} className="flex justify-between rounded border px-2 py-1 text-xs">
                      <span className="truncate">{new Date(e.created_at).toLocaleString()} · {e.provider}/{e.event_type}</span>
                      <span>{fmtMoney(e.estimated_cost)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
