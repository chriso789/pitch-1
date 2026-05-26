import { useEffect, useState } from "react";
import { edgeApi } from "@/lib/edgeApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

type StatusKind = "good" | "watch" | "bad" | "losing_money";
type CompanyRow = {
  tenant_id: string; name: string; plan_name: string;
  monthly_price: number; cost_mtd: number; gross_profit: number; gross_margin_percent: number;
  status: StatusKind;
  sms_used: number; sms_limit: number;
  ai_prompts_used: number; ai_prompts_limit: number;
  ai_tokens_used: number; ai_tokens_limit: number;
  storage_used: number; storage_limit: number;
  roof_reports_used: number; roof_reports_limit: number;
};
type Dashboard = {
  month: string; revenue_mtd: number; cost_mtd: number; gross_profit: number; gross_margin_percent: number;
  by_provider: Record<string, number>;
  most_expensive_company: { name: string; cost: number } | null;
  most_expensive_user: { user_id: string; cost: number } | null;
};
type ProviderCost = { id: string; provider: string; event_type: string; unit: string; cost_per_unit: number; markup_percent: number; is_active: boolean };

const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;

const STATUS_STYLE: Record<StatusKind, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  watch: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  losing_money: "bg-destructive/15 text-destructive",
};

export default function CostTrackerPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [providers, setProviders] = useState<ProviderCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function loadAll() {
    setLoading(true);
    const [d, c, p] = await Promise.all([
      edgeApi<Dashboard>("platform-api", "/dashboard"),
      edgeApi<{ rows: CompanyRow[] }>("platform-api", "/companies"),
      edgeApi<{ rows: ProviderCost[] }>("platform-api", "/provider-costs"),
    ]);
    if (d.error) toast.error(`Dashboard: ${d.error}`); else setDashboard(d.data);
    if (c.error) toast.error(`Companies: ${c.error}`); else setCompanies(c.data?.rows ?? []);
    if (p.error) toast.error(`Providers: ${p.error}`); else setProviders(p.data?.rows ?? []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  async function recalc() {
    const { error } = await edgeApi("platform-api", "/recalculate-rollups", {});
    if (error) toast.error(error); else { toast.success("Rollups recalculated"); loadAll(); }
  }
  async function seedTest(event_type: string, provider = "openai", quantity = 1) {
    const { error } = await edgeApi("platform-api", "/seed-test-event", { event_type, provider, quantity });
    if (error) toast.error(error); else toast.success(`Logged ${provider}/${event_type}`);
  }
  async function updateProvider(id: string, patch: Partial<ProviderCost>) {
    const { error } = await edgeApi("platform-api", "/provider-costs/update", { id, ...patch });
    if (error) toast.error(error); else { toast.success("Updated"); loadAll(); }
  }

  const filtered = companies.filter((c) => c.name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cost Tracker</h1>
          <p className="text-sm text-muted-foreground">Platform infrastructure spend & per-company profitability — {dashboard?.month}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={recalc}>Recalculate Rollups</Button>
          <Button variant="outline" size="sm" onClick={() => seedTest("ai_generation")}>Test AI Event</Button>
          <Button variant="outline" size="sm" onClick={() => seedTest("sms_outbound", "telnyx")}>Test SMS Event</Button>
          <Button variant="outline" size="sm" onClick={() => seedTest("storage_mb", "supabase", 100)}>Test Upload Event</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi title="MTD Revenue" value={fmt(dashboard?.revenue_mtd ?? 0)} />
        <Kpi title="MTD Cost" value={fmt(dashboard?.cost_mtd ?? 0)} />
        <Kpi title="Gross Profit" value={fmt(dashboard?.gross_profit ?? 0)} />
        <Kpi title="Gross Margin" value={pct(dashboard?.gross_margin_percent ?? 0)} />
      </div>

      {/* Provider spend */}
      <Card>
        <CardHeader><CardTitle>Provider Spend (MTD)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(dashboard?.by_provider ?? {}).map(([p, v]) => (
              <div key={p} className="rounded-md border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{p}</div>
                <div className="text-lg font-semibold">{fmt(v)}</div>
              </div>
            ))}
            {!Object.keys(dashboard?.by_provider ?? {}).length && (
              <div className="col-span-full text-sm text-muted-foreground">No usage events yet this month.</div>
            )}
          </div>
          {(dashboard?.most_expensive_company || dashboard?.most_expensive_user) && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {dashboard?.most_expensive_company && (
                <div className="rounded-md border p-3">
                  <div className="text-xs uppercase text-muted-foreground">Most Expensive Company</div>
                  <div className="font-medium">{dashboard.most_expensive_company.name} — {fmt(dashboard.most_expensive_company.cost)}</div>
                </div>
              )}
              {dashboard?.most_expensive_user && (
                <div className="rounded-md border p-3">
                  <div className="text-xs uppercase text-muted-foreground">Most Expensive User</div>
                  <div className="font-mono text-xs">{dashboard.most_expensive_user.user_id}</div>
                  <div className="font-medium">{fmt(dashboard.most_expensive_user.cost)}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Companies */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Companies</CardTitle>
          <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>SMS</TableHead>
                <TableHead>AI Prompts</TableHead>
                <TableHead>Storage MB</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow> :
                filtered.map((r) => (
                  <TableRow key={r.tenant_id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.plan_name}</TableCell>
                    <TableCell className="text-right">{fmt(r.monthly_price)}</TableCell>
                    <TableCell className="text-right">{fmt(r.cost_mtd)}</TableCell>
                    <TableCell className="text-right">{pct(r.gross_margin_percent)}</TableCell>
                    <TableCell><UsageBar used={r.sms_used} limit={r.sms_limit} /></TableCell>
                    <TableCell><UsageBar used={r.ai_prompts_used} limit={r.ai_prompts_limit} /></TableCell>
                    <TableCell><UsageBar used={r.storage_used} limit={r.storage_limit} /></TableCell>
                    <TableCell><Badge className={STATUS_STYLE[r.status]}>{r.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No companies match.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Provider pricing editor */}
      <Card>
        <CardHeader><CardTitle>Provider Costs</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Cost / Unit</TableHead>
                <TableHead className="text-right">Markup %</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{p.event_type}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" step="0.0000001" defaultValue={p.cost_per_unit}
                      className="w-32 ml-auto"
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== p.cost_per_unit) updateProvider(p.id, { cost_per_unit: v }); }} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input type="number" step="1" defaultValue={p.markup_percent}
                      className="w-20 ml-auto"
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
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  if (!limit) return <span className="text-xs text-muted-foreground">{used} / —</span>;
  const pctVal = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="space-y-1 min-w-[100px]">
      <div className="text-xs">{used} / {limit}</div>
      <Progress value={pctVal} className="h-1.5" />
    </div>
  );
}
