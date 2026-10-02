import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/commercial/engine";
import { COST_TYPES, COST_TYPE_LABEL } from "@/lib/commercial/budget";
import { label } from "@/lib/commercial/procurement";

const db = supabase as any;
type Kind = "po" | "subcontract";
const T = {
  po: { head: "commercial_purchase_orders", lines: "commercial_purchase_order_lines", fk: "po_id", num: "po_number", value: "original_amount", revised: "revised_amount" },
  subcontract: { head: "commercial_subcontracts", lines: "commercial_subcontract_lines", fk: "subcontract_id", num: "subcontract_number", value: "contract_value", revised: "revised_value" },
} as const;
const NEXT: Record<string, string[]> = {
  draft: ["pending_approval", "cancelled"], pending_approval: ["approved", "cancelled"], approved: ["issued", "cancelled"],
  issued: ["partially_received", "received", "closed"], partially_received: ["received", "closed"], received: ["closed"],
};

export function CommitmentsTab({ projectId, tenantId }: { projectId: string; tenantId: string | null }) {
  const [pos, setPos] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [open, setOpen] = useState<{ kind: Kind; id: string } | null>(null);
  const load = async () => {
    if (!tenantId) return;
    const [{ data: p }, { data: s }] = await Promise.all([
      db.from("commercial_purchase_orders").select("*").eq("project_id", projectId).eq("tenant_id", tenantId).order("created_at"),
      db.from("commercial_subcontracts").select("*").eq("project_id", projectId).eq("tenant_id", tenantId).order("created_at"),
    ]);
    setPos(p || []); setSubs(s || []);
  };
  useEffect(() => { load(); }, [projectId, tenantId]);

  const create = async (kind: Kind) => {
    const name = window.prompt(kind === "po" ? "Vendor / supplier name" : "Subcontractor name"); if (!name) return;
    const { data, error } = await db.from(T[kind].head).insert({ tenant_id: tenantId, project_id: projectId, vendor_name: name }).select("id").single();
    if (error) return toast.error(error.message);
    await load(); setOpen({ kind, id: data.id });
  };

  const list = (kind: Kind, rows: any[]) => (
    <Card><CardHeader className="py-3 flex-row items-center justify-between space-y-0"><CardTitle className="text-base">{kind === "po" ? "Purchase orders" : "Subcontracts"}</CardTitle>
      <Button size="sm" variant="outline" onClick={() => create(kind)}><Plus className="h-4 w-4 mr-1" />New</Button></CardHeader>
      <CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-muted/50 text-left"><tr><th className="p-2">Number</th><th className="p-2">Vendor</th><th className="p-2">Status</th>
          <th className="p-2 text-right">Original</th><th className="p-2 text-right">Changes</th><th className="p-2 text-right">Revised</th><th className="p-2 text-right">Invoiced</th><th className="p-2 text-right">Paid</th>
          {kind === "subcontract" && <th className="p-2 text-right">Retainage</th>}<th className="p-2 text-right">Remaining</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setOpen({ kind, id: r.id })}>
            <td className="p-2 font-medium text-primary">{r[T[kind].num]}</td><td className="p-2">{r.vendor_name}</td>
            <td className="p-2"><Badge variant={r.status === "cancelled" ? "destructive" : r.status === "draft" ? "outline" : "default"}>{label(r.status)}</Badge></td>
            <td className="p-2 text-right">{money(r[T[kind].value])}</td><td className="p-2 text-right">{money(kind === "po" ? r.approved_changes : r.change_value)}</td>
            <td className="p-2 text-right font-medium">{money(r[T[kind].revised])}</td><td className="p-2 text-right">{money(r.invoiced_amount)}</td><td className="p-2 text-right">{money(r.paid_amount)}</td>
            {kind === "subcontract" && <td className="p-2 text-right">{Number(r.retainage_pct)}% · {money(r.retainage_held)}</td>}
            <td className="p-2 text-right">{money(r.remaining_amount)}</td>
          </tr>))}
          {!rows.length && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">None yet. Create one here or from a buyout package with a carried quote.</td></tr>}
        </tbody></table></CardContent></Card>
  );

  return (
    <div className="space-y-4">
      {list("po", pos)}{list("subcontract", subs)}
      <p className="text-xs text-muted-foreground">Draft and pending commitments show as pending on the budget; approved and later count as committed. Totals come from the lines and update the budget and buyout automatically.</p>
      <CommitmentDialog target={open} tenantId={tenantId} onClose={() => setOpen(null)} onChange={load} />
    </div>
  );
}

function CommitmentDialog({ target, tenantId, onClose, onChange }: any) {
  const [h, setH] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [rels, setRels] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const kind: Kind | undefined = target?.kind; const t = kind ? T[kind] : null;
  const load = async () => {
    if (!target || !t) return;
    const [{ data: hh }, { data: ll }, { data: cc }] = await Promise.all([
      db.from(t.head).select("*").eq("id", target.id).single(),
      db.from(t.lines).select("*").eq(t.fk, target.id).eq("active", true).order("sort_order"),
      db.from("commercial_cost_codes").select("id, code, name").eq("tenant_id", tenantId).eq("active", true).order("code"),
    ]);
    setH(hh); setLines(ll || []); setCodes(cc || []);
    if (kind === "po") { const { data: rr } = await db.from("commercial_po_releases").select("*").eq("po_id", target.id).order("release_number"); setRels(rr || []); }
  };
  useEffect(() => { load(); }, [target?.id]);
  if (!target || !h || !t) return null;
  const editable = ["draft", "pending_approval"].includes(h.status);

  const patchH = async (patch: any) => { const { error } = await db.from(t.head).update(patch).eq("id", h.id); if (error) toast.error(error.message); await load(); onChange(); };
  const patchL = async (l: any, patch: any) => { const { error } = await db.from(t.lines).update(patch).eq("id", l.id); if (error) toast.error(error.message); await load(); onChange(); };
  const addL = async () => { const { error } = await db.from(t.lines).insert({ tenant_id: tenantId, [t.fk]: h.id, description: "New line", cost_type: kind === "po" ? "material" : "subcontract", sort_order: lines.length }); if (error) toast.error(error.message); await load(); onChange(); };
  const addRel = async () => { const { error } = await db.from("commercial_po_releases").insert({ tenant_id: tenantId, po_id: h.id, release_number: (rels.at(-1)?.release_number || 0) + 1, description: "Release", delivery_address: h.shipping_location }); if (error) toast.error(error.message); load(); };
  const patchRel = async (r: any, patch: any) => { const { error } = await db.from("commercial_po_releases").update(patch).eq("id", r.id); if (error) toast.error(error.message); load(); };
  const fld = (k: string, l: string, type = "text") => <div><Label className="text-xs">{l}</Label><Input className="h-8" type={type} defaultValue={h[k] || ""} onBlur={(e) => e.target.value !== (h[k] || "") && patchH({ [k]: e.target.value || null })} /></div>;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>{h[t.num]} · {h.vendor_name}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{label(h.status)}</Badge>
          {(NEXT[h.status] || []).filter((s) => kind === "po" || !["partially_received", "received"].includes(s)).map((s) =>
            <Button key={s} size="sm" variant={s === "cancelled" ? "outline" : "default"} onClick={() => (s !== "cancelled" || window.confirm("Cancel this commitment?")) && patchH({ status: s })}>{s === "pending_approval" ? "Submit for approval" : s === "cancelled" ? "Cancel" : `Mark ${label(s).toLowerCase()}`}</Button>)}
          <div className="flex-1" /><span className="text-sm">Revised: <b>{money(h[t.revised])}</b> · Remaining: {money(h.remaining_amount)}</span>
        </div>
        <div className="grid md:grid-cols-4 gap-2">
          {fld("vendor_name", kind === "po" ? "Vendor" : "Subcontractor")}
          {kind === "po" ? <>{fld("issue_date", "Issue date", "date")}{fld("required_date", "Required date", "date")}{fld("shipping_location", "Ship to")}</>
            : <>{fld("start_date", "Start", "date")}{fld("completion_date", "Completion", "date")}{fld("retainage_pct", "Retainage %", "number")}</>}
          {fld("terms", "Terms")}
          {kind === "subcontract" && <div className="md:col-span-3"><Label className="text-xs">Scope</Label><Textarea defaultValue={h.scope || ""} onBlur={(e) => e.target.value !== (h.scope || "") && patchH({ scope: e.target.value })} /></div>}
        </div>
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Description</th><th className="p-2">Cost code</th><th className="p-2">Type</th><th className="p-2 text-right">Qty</th><th className="p-2">UOM</th><th className="p-2 text-right">Unit cost</th><th className="p-2 text-right">Extended</th><th /></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-1"><Input className="h-8" disabled={!editable} defaultValue={l.description} onBlur={(e) => e.target.value !== l.description && patchL(l, { description: e.target.value })} /></td>
                <td className="p-1 w-48"><Select disabled={!editable} value={l.cost_code_id || "none"} onValueChange={(v) => patchL(l, { cost_code_id: v === "none" ? null : v })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No cost code</SelectItem>{codes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} {c.name}</SelectItem>)}</SelectContent></Select></td>
                <td className="p-1 w-36"><Select disabled={!editable} value={l.cost_type} onValueChange={(v) => patchL(l, { cost_type: v })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{COST_TYPES.map((c) => <SelectItem key={c} value={c}>{COST_TYPE_LABEL[c]}</SelectItem>)}</SelectContent></Select></td>
                <td className="p-1 w-24"><Input className="h-8 text-right" type="number" disabled={!editable} defaultValue={l.quantity} onBlur={(e) => Number(e.target.value) !== Number(l.quantity) && patchL(l, { quantity: Number(e.target.value) })} /></td>
                <td className="p-1 w-20"><Input className="h-8" disabled={!editable} defaultValue={l.uom || ""} onBlur={(e) => e.target.value !== (l.uom || "") && patchL(l, { uom: e.target.value })} /></td>
                <td className="p-1 w-32"><Input className="h-8 text-right" type="number" disabled={!editable} defaultValue={l.unit_cost} onBlur={(e) => Number(e.target.value) !== Number(l.unit_cost) && patchL(l, { unit_cost: Number(e.target.value) })} /></td>
                <td className="p-2 text-right font-medium">{money(l.extended_cost)}</td>
                <td className="p-1">{editable && <Button size="sm" variant="ghost" onClick={() => patchL(l, { active: false })}>Remove</Button>}</td>
              </tr>))}</tbody></table>
          {editable ? <div className="p-2"><Button size="sm" variant="outline" onClick={addL}><Plus className="h-4 w-4 mr-1" />Line</Button></div>
            : <p className="p-2 text-xs text-muted-foreground">Lines are locked after approval. Changes will go through change orders.</p>}
        </div>
        {kind === "po" && <div className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="font-medium text-sm">Material releases</h3><Button size="sm" variant="outline" onClick={addRel}><Plus className="h-4 w-4 mr-1" />Release</Button></div>
          <div className="border rounded overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><thead className="bg-muted/50 text-left"><tr>
            <th className="p-2">#</th><th className="p-2">What</th><th className="p-2">Qty</th><th className="p-2">Requested</th><th className="p-2">Confirmed</th><th className="p-2">Deliver to</th><th className="p-2">Site contact</th><th className="p-2">Status</th><th className="p-2">Packing slip</th><th className="p-2">Received</th><th className="p-2">Damaged</th></tr></thead>
            <tbody>{rels.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.release_number}</td>
                {[["description", "text", "w-40"], ["quantity", "number", "w-20"], ["requested_delivery", "date", "w-36"], ["confirmed_delivery", "date", "w-36"], ["delivery_address", "text", "w-40"], ["site_contact", "text", "w-32"]].map(([k, ty, w]) =>
                  <td key={k} className="p-1"><Input className={`h-8 ${w}`} type={ty} defaultValue={r[k] ?? ""} onBlur={(e) => e.target.value !== String(r[k] ?? "") && patchRel(r, { [k]: e.target.value === "" ? null : ty === "number" ? Number(e.target.value) : e.target.value })} /></td>)}
                <td className="p-1"><Select value={r.status} onValueChange={(v) => patchRel(r, { status: v })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{["requested", "confirmed", "shipped", "delivered", "received", "cancelled"].map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent></Select></td>
                {[["packing_slip", "text", "w-28"], ["received_quantity", "number", "w-20"], ["damaged_quantity", "number", "w-20"]].map(([k, ty, w]) =>
                  <td key={k} className="p-1"><Input className={`h-8 ${w}`} type={ty} defaultValue={r[k] ?? ""} onBlur={(e) => e.target.value !== String(r[k] ?? "") && patchRel(r, { [k]: e.target.value === "" ? null : ty === "number" ? Number(e.target.value) : e.target.value })} /></td>)}
              </tr>))}
              {!rels.length && <tr><td colSpan={11} className="p-3 text-center text-muted-foreground">No releases yet.</td></tr>}</tbody></table></div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
