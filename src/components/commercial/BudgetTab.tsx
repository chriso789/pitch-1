import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Download, Settings2, Save } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/commercial/engine";
import { COST_TYPES, COST_TYPE_LABEL, groupByCostCode, margin, sumLines, type NumCol } from "@/lib/commercial/budget";
import { CostCodesDialog } from "./CostCodesDialog";

const db = supabase as any;
const COLS: { k: NumCol; l: string; drill?: string }[] = [
  { k: "original_budget", l: "Original", drill: "original" }, { k: "approved_budget_changes", l: "Approved chg" },
  { k: "revised_budget", l: "Revised" }, { k: "pending_commitments", l: "Pending commit", drill: "committed" },
  { k: "committed_cost", l: "Committed", drill: "committed" }, { k: "actual_cost", l: "Actual", drill: "actual" },
  { k: "projected_final_cost", l: "Projected final" }, { k: "variance", l: "Variance" },
  { k: "revised_revenue", l: "Revenue" }, { k: "projected_gross_profit", l: "Proj. GP" },
];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const VIEWS_KEY = "commercial-budget-views";

export function BudgetTab({ projectId, tenantId }: { projectId: string; tenantId: string | null }) {
  const [award, setAward] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [codes, setCodes] = useState<Record<string, any>>({});
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<{ kind: string; line: any } | null>(null);
  const [codesOpen, setCodesOpen] = useState(false);
  const [views, setViews] = useState<Record<string, any>>(() => { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "{}"); } catch { return {}; } });

  const load = async () => {
    if (!tenantId) return;
    const [{ data: a }, { data: c }] = await Promise.all([
      db.from("commercial_awards").select("*").eq("commercial_project_id", projectId).eq("tenant_id", tenantId).maybeSingle(),
      db.from("commercial_cost_codes").select("*").eq("tenant_id", tenantId),
    ]);
    setAward(a); setCodes(Object.fromEntries((c || []).map((x: any) => [x.id, x])));
    const { data: b } = await db.from("commercial_project_budgets").select("id").eq("project_id", projectId).eq("tenant_id", tenantId).eq("status", "active").maybeSingle();
    if (b) { const { data: l } = await db.from("commercial_budget_lines").select("*").eq("budget_id", b.id).eq("tenant_id", tenantId); setLines(l || []); }
    else setLines([]);
  };
  useEffect(() => { load(); }, [projectId, tenantId]);

  const shown = useMemo(() => lines.filter((l) => {
    if (type !== "all" && l.cost_type !== type) return false;
    if (!q) return true;
    const cc = codes[l.cost_code_id]; const s = `${cc?.code || ""} ${cc?.name || ""} ${l.description || ""} ${l.cost_type}`.toLowerCase();
    return s.includes(q.toLowerCase());
  }), [lines, type, q, codes]);
  const groups = useMemo(() => groupByCostCode(shown, codes), [shown, codes]);
  const total = useMemo(() => sumLines(shown), [shown]);

  const saveForecast = async (l: any, v: string) => {
    const val = v === "" ? null : Math.round(Number(v) * 100) / 100;
    if (val === (l.forecast_cost == null ? null : Number(l.forecast_cost))) return;
    const { error } = await db.from("commercial_budget_lines").update({ forecast_cost: val }).eq("id", l.id);
    if (error) return toast.error(error.message);
    load();
  };

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const rows = groups.flatMap((g) => g.lines.map((l) => ({
      "Cost Code": g.code, Description: l.description || g.name, "Cost Type": COST_TYPE_LABEL[l.cost_type] || l.cost_type,
      ...Object.fromEntries(COLS.map((c) => [c.l, Number(l[c.k] || 0)])),
      "Proj. Margin": Number(margin(Number(l.revised_revenue), Number(l.projected_gross_profit)).toFixed(4)),
    })));
    rows.push({ "Cost Code": "TOTAL", Description: "", "Cost Type": "", ...Object.fromEntries(COLS.map((c) => [c.l, total[c.k]])), "Proj. Margin": Number(margin(total.revised_revenue, total.projected_gross_profit).toFixed(4)) } as any);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Budget");
    XLSX.writeFile(wb, `budget-${projectId.slice(0, 8)}.xlsx`);
  };

  const saveView = () => {
    const name = window.prompt("Name this view"); if (!name) return;
    const v = { ...views, [name]: { type, q } }; setViews(v); localStorage.setItem(VIEWS_KEY, JSON.stringify(v));
  };

  if (!award) return (
    <Card><CardContent className="p-8 text-center space-y-3">
      <p className="font-medium">No budget yet</p>
      <p className="text-sm text-muted-foreground">Award a fully approved estimate version from the Estimate tab. The budget is built from it automatically, grouped by cost code and cost type.</p>
      <Button variant="outline" onClick={() => setCodesOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Manage cost codes</Button>
      <CostCodesDialog open={codesOpen} onOpenChange={setCodesOpen} tenantId={tenantId} onChange={load} />
    </CardContent></Card>
  );

  const unassigned = lines.filter((l) => !l.cost_code_id && l.source_estimate_line_ids?.length).length;

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-4 gap-3">
        {[["Awarded contract", money(award.awarded_contract_value)], ["Original cost", money(award.original_cost)], ["Original GP", money(award.original_gross_profit)], ["Original margin", pct(Number(award.original_gross_margin || 0))]].map(([l, v]) =>
          <Card key={l}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-semibold">{v}</div></CardContent></Card>)}
      </div>
      <p className="text-xs text-muted-foreground">Awarded {award.award_date}. The award and original budget are locked; future changes go through budget changes.{unassigned ? ` ${unassigned} line(s) had no cost code when awarded and sit under Unassigned.` : ""}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search code or description" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={type} onValueChange={setType}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All cost types</SelectItem>{COST_TYPES.map((t) => <SelectItem key={t} value={t}>{COST_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select>
        {Object.keys(views).length > 0 && <Select value="" onValueChange={(n) => { setType(views[n].type); setQ(views[n].q); }}><SelectTrigger className="w-40"><SelectValue placeholder="Saved views" /></SelectTrigger>
          <SelectContent>{Object.keys(views).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select>}
        <Button size="sm" variant="outline" onClick={saveView}><Save className="h-4 w-4 mr-1" />Save view</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(open.size ? new Set() : new Set(groups.map((g) => g.key)))}>{open.size ? "Collapse all" : "Expand all"}</Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setCodesOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Cost codes</Button>
        <Button size="sm" onClick={exportXlsx}><Download className="h-4 w-4 mr-1" />Export XLSX</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr>
            <th className="p-2">Cost code</th><th className="p-2">Cost type</th>
            {COLS.map((c) => <th key={c.k} className="p-2 text-right">{c.l}</th>)}
            <th className="p-2 text-right">Forecast</th><th className="p-2 text-right">Margin</th>
          </tr></thead>
          <tbody>
            {groups.map((g) => { const t = sumLines(g.lines); const isOpen = open.has(g.key); return (
              <Fragment key={g.key}>
                <tr className="border-t bg-muted/20 font-medium cursor-pointer" onClick={() => { const s = new Set(open); isOpen ? s.delete(g.key) : s.add(g.key); setOpen(s); }}>
                  <td className="p-2">{isOpen ? <ChevronDown className="inline h-4 w-4" /> : <ChevronRight className="inline h-4 w-4" />} <span className="font-mono">{g.code}</span> {g.name}</td>
                  <td className="p-2 text-muted-foreground">{g.lines.length} type(s)</td>
                  {COLS.map((c) => <td key={c.k} className="p-2 text-right">{money(t[c.k])}</td>)}
                  <td /><td className="p-2 text-right">{pct(margin(t.revised_revenue, t.projected_gross_profit))}</td>
                </tr>
                {isOpen && g.lines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2 pl-8 text-muted-foreground">{l.description || ""}</td>
                    <td className="p-2">{COST_TYPE_LABEL[l.cost_type] || l.cost_type}</td>
                    {COLS.map((c) => <td key={c.k} className="p-2 text-right">
                      {c.drill ? <button className="text-primary hover:underline" onClick={() => setDrill({ kind: c.drill!, line: l })}>{money(l[c.k])}</button> : money(l[c.k])}
                    </td>)}
                    <td className="p-2 w-32"><Input className="h-8 text-right" type="number" placeholder="= revised" defaultValue={l.forecast_cost ?? ""} onBlur={(e) => saveForecast(l, e.target.value)} /></td>
                    <td className="p-2 text-right">{pct(margin(Number(l.revised_revenue), Number(l.projected_gross_profit)))}</td>
                  </tr>
                ))}
              </Fragment>); })}
            <tr className="border-t-2 font-bold"><td className="p-2" colSpan={2}>Total</td>
              {COLS.map((c) => <td key={c.k} className="p-2 text-right">{money(total[c.k])}</td>)}
              <td /><td className="p-2 text-right">{pct(margin(total.revised_revenue, total.projected_gross_profit))}</td></tr>
          </tbody>
        </table>
      </CardContent></Card>
      {type === "all" && !q && Math.abs(total.revised_revenue - Number(award.awarded_contract_value)) > 0.005 &&
        <p className="text-sm text-destructive">Budget revenue does not match the awarded contract — contact support.</p>}
      <DrillDialog drill={drill} award={award} onClose={() => setDrill(null)} />
      <CostCodesDialog open={codesOpen} onOpenChange={setCodesOpen} tenantId={tenantId} onChange={load} />
    </div>
  );
}

function DrillDialog({ drill, award, onClose }: any) {
  const src = drill?.kind === "original"
    ? (award?.snapshot_json?.lines || []).filter((l: any) => drill.line.source_estimate_line_ids?.includes(l.id))
    : [];
  return (
    <Dialog open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{drill?.kind === "original" ? "Awarded estimate lines" : drill?.kind === "committed" ? "Commitments" : "Actual costs"}</DialogTitle></DialogHeader>
        {drill?.kind === "original" ? (
          src.length ? <table className="w-full text-sm"><thead className="text-left text-muted-foreground"><tr><th className="p-1">Description</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Unit</th><th className="p-1 text-right">Total</th></tr></thead>
            <tbody>{src.map((l: any) => <tr key={l.id} className="border-t"><td className="p-1">{l.description}</td><td className="p-1 text-right">{l.quantity} {l.uom}</td><td className="p-1 text-right">{money(l.unit_cost)}</td><td className="p-1 text-right">{money(l.total)}</td></tr>)}
              <tr className="border-t font-semibold"><td className="p-1" colSpan={3}>Total</td><td className="p-1 text-right">{money(src.reduce((a: number, l: any) => a + Number(l.total || 0), 0))}</td></tr></tbody></table>
          : <p className="text-sm text-muted-foreground">This amount comes from the estimate's {drill?.line.description?.toLowerCase() || "summary"} (from the awarded version's totals), not individual lines.</p>
        ) : <p className="text-sm text-muted-foreground">Nothing recorded yet. {drill?.kind === "committed" ? "Purchase orders and subcontracts" : "Vendor invoices, labor and equipment costs"} will list here once those steps are built.</p>}
      </DialogContent>
    </Dialog>
  );
}
