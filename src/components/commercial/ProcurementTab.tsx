import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PROCUREMENT_STATUSES, daysAtRisk, expectedDelivery, label } from "@/lib/commercial/procurement";

const db = supabase as any;
const DATES: [string, string][] = [["required_onsite_date", "Required onsite"], ["quote_date", "Quote"], ["po_date", "PO"], ["release_date", "Release"], ["manufacturing_start_date", "Mfg start"], ["expected_ship_date", "Exp. ship"], ["ship_date", "Shipped"], ["expected_delivery_date", "Exp. delivery"], ["delivery_date", "Delivered"], ["received_date", "Received"]];

export function ProcurementTab({ projectId, tenantId }: { projectId: string; tenantId: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [view, setView] = useState<"tracker" | "long_lead">("tracker");
  const load = async () => {
    if (!tenantId) return;
    const [{ data: r }, { data: p }] = await Promise.all([
      db.from("commercial_procurement_items").select("*").eq("project_id", projectId).eq("tenant_id", tenantId).order("required_onsite_date", { ascending: true, nullsFirst: false }),
      db.from("commercial_purchase_orders").select("id, po_number, vendor_name").eq("project_id", projectId).eq("tenant_id", tenantId).neq("status", "cancelled"),
    ]);
    setRows(r || []); setPos(p || []);
  };
  useEffect(() => { load(); }, [projectId, tenantId]);
  const add = async () => {
    const material = window.prompt("Material (e.g. 60 mil TPO rolls)"); if (!material) return;
    const { error } = await db.from("commercial_procurement_items").insert({ tenant_id: tenantId, project_id: projectId, material }); if (error) return toast.error(error.message); load();
  };
  const upd = async (r: any, patch: any) => { const { error } = await db.from("commercial_procurement_items").update(patch).eq("id", r.id); if (error) toast.error(error.message); load(); };
  const setPo = (r: any, id: string) => { const p = pos.find((x) => x.id === id); upd(r, { po_id: id === "none" ? null : id, supplier_name: r.supplier_name || p?.vendor_name || null }); };
  const withRisk = useMemo(() => rows.map((r) => ({ ...r, risk: daysAtRisk(r), exp: expectedDelivery(r) })), [rows]);
  const late = withRisk.filter((r) => (r.risk ?? 0) > 0).length;
  const longLead = withRisk.filter((r) => r.status !== "complete" && r.status !== "cancelled").sort((a, b) => (b.risk ?? -9999) - (a.risk ?? -9999));
  const poName = (id: string) => pos.find((p) => p.id === id)?.po_number || "—";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={view === "tracker" ? "default" : "outline"} onClick={() => setView("tracker")}>Tracker</Button>
        <Button size="sm" variant={view === "long_lead" ? "default" : "outline"} onClick={() => setView("long_lead")}>Long lead</Button>
        <Button size="sm" variant="outline" onClick={add}><Plus className="h-4 w-4 mr-1" />Item</Button>
        {late > 0 && <span className="text-sm text-destructive font-medium">{late} item(s) late</span>}
        <p className="text-xs text-muted-foreground ml-auto">Risk uses only stored dates: delivered → vendor's expected delivery → PO date + lead time.</p>
      </div>
      {view === "tracker" ? (
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">Material</th><th className="p-2">Manufacturer</th><th className="p-2">Supplier</th><th className="p-2">PO</th><th className="p-2">Submittal</th><th className="p-2">Lead (d)</th>
            {DATES.map(([, l]) => <th key={l} className="p-2">{l}</th>)}<th className="p-2">Status</th><th className="p-2 text-right">Days at risk</th></tr></thead>
          <tbody>{withRisk.map((r) => (
            <tr key={r.id} className={`border-t ${(r.risk ?? 0) > 0 ? "bg-destructive/10" : ""}`}>
              {["material", "manufacturer", "supplier_name"].map((k) => <td key={k} className="p-1"><Input className="h-8 w-36" defaultValue={r[k] || ""} onBlur={(e) => e.target.value !== (r[k] || "") && upd(r, { [k]: e.target.value || null })} /></td>)}
              <td className="p-1"><Select value={r.po_id || "none"} onValueChange={(v) => setPo(r, v)}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">—</SelectItem>{pos.map((p) => <SelectItem key={p.id} value={p.id}>{p.po_number}</SelectItem>)}</SelectContent></Select></td>
              <td className="p-2 text-center"><input type="checkbox" checked={r.submittal_required} onChange={(e) => upd(r, { submittal_required: e.target.checked })} /></td>
              <td className="p-1"><Input className="h-8 w-16" type="number" defaultValue={r.lead_time_days ?? ""} onBlur={(e) => upd(r, { lead_time_days: e.target.value === "" ? null : Number(e.target.value) })} /></td>
              {DATES.map(([k]) => <td key={k} className="p-1"><Input className="h-8 w-36" type="date" defaultValue={r[k] || ""} onBlur={(e) => e.target.value !== (r[k] || "") && upd(r, { [k]: e.target.value || null })} /></td>)}
              <td className="p-1"><Select value={r.status} onValueChange={(v) => upd(r, { status: v })}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{PROCUREMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent></Select></td>
              <td className={`p-2 text-right font-medium ${(r.risk ?? 0) > 0 ? "text-destructive" : ""}`}>{r.risk == null ? "—" : r.risk > 0 ? `+${r.risk}` : r.risk}</td>
            </tr>))}
            {!rows.length && <tr><td colSpan={20} className="p-6 text-center text-muted-foreground">No procurement items yet.</td></tr>}</tbody></table></CardContent></Card>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">Item</th><th className="p-2">Required onsite</th><th className="p-2">Status</th><th className="p-2">Vendor</th><th className="p-2">Lead time</th><th className="p-2">PO date</th><th className="p-2">Expected ship</th><th className="p-2">Expected delivery</th><th className="p-2 text-right">Days at risk</th></tr></thead>
          <tbody>{longLead.map((r) => (
            <tr key={r.id} className={`border-t ${(r.risk ?? 0) > 0 ? "bg-destructive/10" : ""}`}>
              <td className="p-2 font-medium">{r.material}</td><td className="p-2">{r.required_onsite_date || "—"}</td><td className="p-2">{label(r.status)}</td>
              <td className="p-2">{r.supplier_name || poName(r.po_id)}</td><td className="p-2">{r.lead_time_days != null ? `${r.lead_time_days} d` : "—"}</td>
              <td className="p-2">{r.po_date || "—"}</td><td className="p-2">{r.ship_date || r.expected_ship_date || "—"}</td>
              <td className="p-2">{r.exp ? `${r.exp.date}${r.exp.basis === "lead_time" ? " (PO + lead)" : ""}` : "—"}</td>
              <td className={`p-2 text-right font-semibold ${(r.risk ?? 0) > 0 ? "text-destructive" : ""}`}>{r.risk == null ? "Unknown" : r.risk > 0 ? `+${r.risk}` : r.risk}</td>
            </tr>))}
            {!longLead.length && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Nothing open.</td></tr>}</tbody></table></CardContent></Card>
      )}
    </div>
  );
}
