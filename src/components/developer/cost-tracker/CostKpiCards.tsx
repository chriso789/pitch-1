import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { Dashboard, CompanyRow } from "@/lib/developer/costTrackerApi";
import { fmtMoney, fmtPct } from "./status";
import { targetInfraCost } from "@/lib/developer/planTemplates";

type Props = { dashboard: Dashboard | null; companies: CompanyRow[] };

function Kpi({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className={`mt-1 text-xl font-bold ${tone ?? ""}`}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function CostKpiCards({ dashboard, companies }: Props) {
  const bp = dashboard?.by_provider ?? {};
  const losing = companies.filter((c) => c.gross_margin_percent < 0).length;
  const unassignedHint = "Unassigned events need company resolution";

  // $50 viability
  const fifty = companies.filter((c) => Number(c.monthly_price) === 50);
  const above10 = fifty.filter((c) => c.cost_mtd > 10).length;
  const above25 = fifty.filter((c) => c.cost_mtd > 25).length;
  const above50 = fifty.filter((c) => c.cost_mtd > 50).length;
  const fiftyAvg = fifty.length ? fifty.reduce((s, c) => s + c.cost_mtd, 0) / fifty.length : 0;

  const profitTone = (dashboard?.gross_profit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive";
  const marginTone = (dashboard?.gross_margin_percent ?? 0) >= 40 ? "text-emerald-600" :
    (dashboard?.gross_margin_percent ?? 0) >= 0 ? "text-amber-600" : "text-destructive";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi title="MTD Revenue" value={fmtMoney(dashboard?.revenue_mtd)} />
        <Kpi title="MTD Cost" value={fmtMoney(dashboard?.cost_mtd)} />
        <Kpi title="Gross Profit" value={fmtMoney(dashboard?.gross_profit)} tone={profitTone} />
        <Kpi title="Gross Margin" value={fmtPct(dashboard?.gross_margin_percent)} tone={marginTone} />
        <Kpi title="Losing Money" value={String(losing)} tone={losing > 0 ? "text-destructive" : undefined} hint="Margin < 0%" />
        <Kpi title="Most Expensive Co." value={dashboard?.most_expensive_company?.name ?? "—"}
             hint={dashboard?.most_expensive_company ? fmtMoney(dashboard.most_expensive_company.cost) : undefined} />
        <Kpi title="OpenAI / Lovable AI" value={fmtMoney((bp["openai"] ?? 0) + (bp["lovable-ai"] ?? 0) + (bp["anthropic"] ?? 0) + (bp["gemini"] ?? 0))} />
        <Kpi title="Telnyx" value={fmtMoney(bp["telnyx"] ?? 0)} />
        <Kpi title="Supabase" value={fmtMoney(bp["supabase"] ?? 0)} />
        <Kpi title="Mapbox" value={fmtMoney(bp["mapbox"] ?? 0)} />
        <Kpi title="Scraping" value={fmtMoney((bp["firecrawl"] ?? 0) + (bp["serpapi"] ?? 0))} />
        <Kpi title="Roof Reports" value={fmtMoney((bp["eagleview"] ?? 0) + (bp["roofr"] ?? 0))} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">$50 Plan Viability</div>
              <p className="text-xs text-muted-foreground">
                Target max infra cost per $50 customer: <strong>{fmtMoney(targetInfraCost(50))}</strong>.
                Any $50/month company costing more than $10/month should be reviewed. Above $50/month is losing money.
              </p>
            </div>
            {(above10 > 0 || above25 > 0 || above50 > 0) && (
              <Badge className="bg-destructive/15 text-destructive border-destructive/30">
                <AlertTriangle className="mr-1 h-3 w-3" /> Action needed
              </Badge>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Avg cost / $50 company</div>
              <div className="text-lg font-semibold">{fmtMoney(fiftyAvg)}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Above $10</div>
              <div className={`text-lg font-semibold ${above10 ? "text-amber-600" : ""}`}>{above10}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Above $25</div>
              <div className={`text-lg font-semibold ${above25 ? "text-orange-600" : ""}`}>{above25}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Above $50</div>
              <div className={`text-lg font-semibold ${above50 ? "text-destructive" : ""}`}>{above50}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
