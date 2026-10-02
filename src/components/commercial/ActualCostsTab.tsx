import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/commercial/engine";
import { COST_TYPES, COST_TYPE_LABEL } from "@/lib/commercial/budget";
import { label } from "@/lib/commercial/procurement";

const db = supabase as any;
const NEXT: Record<string, string[]> = { draft: ["pending_approval", "void"], pending_approval: ["approved", "void"], approved: ["void"], paid: [] };
const ENTRY_DEFAULT: Record<string, { cost_type: string; uom: string }> = { labor: { cost_type: "labor", uom: "HR" }, equipment: { cost_type: "equipment", uom: "DAY" }, other: { cost_type: "other", uom: "EA" } };

export function ActualCostsTab({ projectId, tenantId }: { projectId: string; tenantId: string | null }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [commitments, setCommitments] = useState<{ id: string; kind: "po" | "sc"; num: string; vendor: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [entryType, setEntryType] = useState<"all" | "labor" | "equipment" | "other">("all");

  const load = async () => {
    if (!tenantId) return;
    const [{ data: i }, { data: e }, { data: c }, { data: p }, { data: s }] = await Promise.all([
      db.from("commercial_vendor_invoices").select("*").eq("project_id", projectId).eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      db.from("commercial_cost_entries").select("*").eq("project_id", projectId).eq("tenant_id", tenantId).eq("active", true).order("work_date", { ascending: false }),
      db.from("commercial_cost_codes").select("id, code, name").eq("tenant_id", tenantId).eq("active", true).order("code"),
      db.from("commercial_purchase_orders").select("id, po_number, vendor_name, status").eq("project_id", projectId).eq("tenant_id", tenantId),
      db.from("commercial_subcontracts").select("id, subcontract_number, vendor_name, status").eq("project_id", projectId).eq("tenant_id", tenantId),
    ]);
    setInvoices(i || []); setEntries(e || []); setCodes(c || []);
    const live = (x: any) => !["draft", "pending_approval", "cancelled"].includes(x.status);
    setCommitments([...(p || []).filter(live).map((x: any) => ({ id: x.id, kind: "po" as const, num: x.po_number, vendor: x.vendor_name })),
      ...(s || []).filter(live).map((x: any) => ({ id: x.id, kind: "sc" as const, num: x.subcontract_number, vendor: x.vendor_name }))]);
  };
  useEffect(() => { load(); }, [projectId, tenantId]);
  const loadLines = async (id: string) => { const { data } = await db.from("commercial_vendor_invoice_lines").select("*").eq("invoice_id", id).eq("active", true).order("created_at"); setLines(data || []); };
  useEffect(() => { if (open) loadLines(open); }, [open]);

  const inv = invoices.find((x) => x.id === open);
  const editable = inv && ["draft", "pending_approval"].includes(inv.status);
  const codeLabel = (id: string | null) => { const c = codes.find((x) => x.id === id); return c ? `${c.code} ${c.name}` : "Uncoded"; };
  const commitmentLabel = (r: any) => { const c = commitments.find((x) => x.id === (r.po_id || r.subcontract_id)); return c ? c.num : "—"; };

  const createInvoice = async () => {
    const vendor = window.prompt("Vendor name"); if (!vendor) return;
    const num = window.prompt("Vendor invoice number"); if (!num) return;
    const { data, error } = await db.from("commercial_vendor_invoices").insert({ tenant_id: tenantId, project_id: projectId, vendor_name: vendor, invoice_number: num, invoice_date: new Date().toISOString().slice(0, 10) }).select("id").single();
    if (error) return toast.error(error.message);
    await load(); setOpen(data.id);
  };
  const updInv = async (patch: any) => { const { error } = await db.from("commercial_vendor_invoices").update(patch).eq("id", open); if (error) toast.error(error.message); await load(); };
  const setCommitment = (v: string) => {
    if (v === "none") return updInv({ po_id: null, subcontract_id: null });
    const c = commitments.find((x) => x.id === v)!;
    updInv(c.kind === "po" ? { po_id: v, subcontract_id: null, vendor_name: inv.vendor_name || c.vendor } : { subcontract_id: v, po_id: null, vendor_name: inv.vendor_name || c.vendor });
  };
  const addLine = async () => { const { error } = await db.from("commercial_vendor_invoice_lines").insert({ tenant_id: tenantId, invoice_id: open, description: "New line", cost_type: "material", amount: 0 }); if (error) toast.error(error.message); loadLines(open!); load(); };
  const updLine = async (l: any, patch: any) => { const { error } = await db.from("commercial_vendor_invoice_lines").update(patch).eq("id", l.id); if (error) toast.error(error.message); loadLines(open!); load(); };
  const recordPayment = () => {
    const v = window.prompt(`Total paid to date (net due ${money(inv.net_due)})`, String(inv.net_due)); if (v == null) return;
    updInv({ paid_amount: Number(v), paid_date: new Date().toISOString().slice(0, 10) });
  };

  const addEntry = async (type: "labor" | "equipment" | "other") => {
    const description = window.prompt(type === "labor" ? "Crew / trade (e.g. Roofing crew A)" : type === "equipment" ? "Equipment (e.g. 60' boom lift)" : "Description"); if (!description) return;
    const { error } = await db.from("commercial_cost_entries").insert({ tenant_id: tenantId, project_id: projectId, entry_type: type, description, ...ENTRY_DEFAULT[type] });
    if (error) toast.error(error.message); load();
  };
  const updEntry = async (r: any, patch: any) => { const { error } = await db.from("commercial_cost_entries").update(patch).eq("id", r.id); if (error) toast.error(error.message); load(); };

  const totals = useMemo(() => {
    const approved = invoices.filter((i) => ["approved", "paid"].includes(i.status));
    const sum = (a: any[], k: string) => a.reduce((s, x) => s + Number(x[k] || 0), 0);
    return { invoiced: sum(approved, "gross_amount"), paid: sum(approved, "paid_amount"), retainage: sum(approved, "retainage_amount"),
      labor: sum(entries.filter((e) => e.entry_type === "labor"), "amount"), equipment: sum(entries.filter((e) => e.entry_type === "equipment"), "amount"), other: sum(entries.filter((e) => e.entry_type === "other"), "amount"),
      pending: sum(invoices.filter((i) => ["draft", "pending_approval"].includes(i.status)), "gross_amount") };
  }, [invoices, entries]);
  const shownEntries = entryType === "all" ? entries : entries.filter((e) => e.entry_type === entryType);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {[["Approved invoices", totals.invoiced], ["Paid", totals.paid], ["Retainage held", totals.retainage], ["Awaiting approval", totals.pending], ["Labor", totals.labor], ["Equipment", totals.equipment], ["Other direct", totals.other]].map(([l, v]) => (
          <Card key={l as string}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="font-semibold">{money(v as number)}</p></CardContent></Card>))}
      </div>
      <p className="text-xs text-muted-foreground">Approved invoices and all labor/equipment/other entries post to budget actual cost by cost code and cost type. Draft invoices don't count until approved.</p>

      <Card><CardHeader className="py-3 flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Vendor invoices</CardTitle>
        <Button size="sm" variant="outline" onClick={createInvoice}><Plus className="h-4 w-4 mr-1" />New invoice</Button></CardHeader>
        <CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">Invoice #</th><th className="p-2">Vendor</th><th className="p-2">Against</th><th className="p-2">Date</th><th className="p-2">Status</th>
            <th className="p-2 text-right">Gross</th><th className="p-2 text-right">Retainage</th><th className="p-2 text-right">Net due</th><th className="p-2 text-right">Paid</th></tr></thead>
          <tbody>{invoices.map((r) => (
            <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(r.id)}>
              <td className="p-2 font-medium text-primary">{r.invoice_number}</td><td className="p-2">{r.vendor_name}</td><td className="p-2">{commitmentLabel(r)}</td><td className="p-2">{r.invoice_date || "—"}</td>
              <td className="p-2"><Badge variant={r.status === "void" ? "destructive" : r.status === "draft" ? "outline" : "default"}>{label(r.status)}</Badge></td>
              <td className="p-2 text-right">{money(r.gross_amount)}</td><td className="p-2 text-right">{money(r.retainage_amount)}</td><td className="p-2 text-right">{money(r.net_due)}</td><td className="p-2 text-right">{money(r.paid_amount)}</td>
            </tr>))}
            {!invoices.length && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No vendor invoices yet.</td></tr>}</tbody></table></CardContent></Card>

      <Card><CardHeader className="py-3 flex-row flex-wrap items-center gap-2 space-y-0"><CardTitle className="text-base mr-auto">Labor, equipment & other costs</CardTitle>
        {(["all", "labor", "equipment", "other"] as const).map((t) => <Button key={t} size="sm" variant={entryType === t ? "default" : "outline"} onClick={() => setEntryType(t)}>{label(t)}</Button>)}
        <Button size="sm" variant="outline" onClick={() => addEntry("labor")}><Plus className="h-4 w-4 mr-1" />Labor</Button>
        <Button size="sm" variant="outline" onClick={() => addEntry("equipment")}><Plus className="h-4 w-4 mr-1" />Equipment</Button>
        <Button size="sm" variant="outline" onClick={() => addEntry("other")}><Plus className="h-4 w-4 mr-1" />Other</Button></CardHeader>
        <CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Description</th><th className="p-2">Worker / unit</th><th className="p-2">Cost code</th><th className="p-2">Cost type</th>
            <th className="p-2">Qty</th><th className="p-2">UOM</th><th className="p-2">Rate</th><th className="p-2 text-right">Amount</th><th className="p-2"></th></tr></thead>
          <tbody>{shownEntries.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-1"><Input className="h-8 w-36" type="date" defaultValue={r.work_date} onBlur={(e) => e.target.value && e.target.value !== r.work_date && updEntry(r, { work_date: e.target.value })} /></td>
              <td className="p-2">{label(r.entry_type)}</td>
              <td className="p-1"><Input className="h-8 w-48" defaultValue={r.description} onBlur={(e) => e.target.value && e.target.value !== r.description && updEntry(r, { description: e.target.value })} /></td>
              <td className="p-1"><Input className="h-8 w-36" defaultValue={r.resource_name || ""} onBlur={(e) => e.target.value !== (r.resource_name || "") && updEntry(r, { resource_name: e.target.value || null })} /></td>
              <td className="p-1"><Select value={r.cost_code_id || "none"} onValueChange={(v) => updEntry(r, { cost_code_id: v === "none" ? null : v })}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Uncoded</SelectItem>{codes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} {c.name}</SelectItem>)}</SelectContent></Select></td>
              <td className="p-1"><Select value={r.cost_type} onValueChange={(v) => updEntry(r, { cost_type: v })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{COST_TYPES.map((t) => <SelectItem key={t} value={t}>{COST_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select></td>
              <td className="p-1"><Input className="h-8 w-20" type="number" defaultValue={r.quantity} onBlur={(e) => Number(e.target.value) !== Number(r.quantity) && updEntry(r, { quantity: Number(e.target.value) })} /></td>
              <td className="p-1"><Input className="h-8 w-16" defaultValue={r.uom || ""} onBlur={(e) => e.target.value !== (r.uom || "") && updEntry(r, { uom: e.target.value || null })} /></td>
              <td className="p-1"><Input className="h-8 w-24" type="number" step="0.01" defaultValue={r.unit_cost} onBlur={(e) => Number(e.target.value) !== Number(r.unit_cost) && updEntry(r, { unit_cost: Number(e.target.value) })} /></td>
              <td className="p-2 text-right font-medium">{money(r.amount)}</td>
              <td className="p-1"><Button size="sm" variant="ghost" onClick={() => window.confirm("Remove this cost entry?") && updEntry(r, { active: false })}>Remove</Button></td>
            </tr>))}
            {!shownEntries.length && <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">No cost entries yet.</td></tr>}</tbody></table></CardContent></Card>

      <Dialog open={!!inv} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {inv && <>
            <DialogHeader><DialogTitle>Invoice {inv.invoice_number} · {inv.vendor_name}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label>Vendor</Label><Input disabled={!editable} defaultValue={inv.vendor_name} onBlur={(e) => e.target.value && e.target.value !== inv.vendor_name && updInv({ vendor_name: e.target.value })} /></div>
              <div><Label>Bill against</Label><Select disabled={!editable} value={inv.po_id || inv.subcontract_id || "none"} onValueChange={setCommitment}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">No commitment</SelectItem>{commitments.map((c) => <SelectItem key={c.id} value={c.id}>{c.num} · {c.vendor}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Invoice date</Label><Input type="date" defaultValue={inv.invoice_date || ""} onBlur={(e) => updInv({ invoice_date: e.target.value || null })} /></div>
              <div><Label>Due date</Label><Input type="date" defaultValue={inv.due_date || ""} onBlur={(e) => updInv({ due_date: e.target.value || null })} /></div>
              <div><Label>Retainage %</Label><Input disabled={!editable} type="number" defaultValue={inv.retainage_pct} onBlur={(e) => Number(e.target.value) !== Number(inv.retainage_pct) && updInv({ retainage_pct: Number(e.target.value) })} /></div>
              <div className="md:col-span-3 flex items-end gap-2 flex-wrap">
                <Badge>{label(inv.status)}</Badge>
                {(NEXT[inv.status] || []).map((s) => <Button key={s} size="sm" variant={s === "void" ? "destructive" : "default"} onClick={() => (s !== "void" || window.confirm("Void this invoice? This can't be undone.")) && updInv({ status: s })}>{s === "pending_approval" ? "Submit for approval" : label(s)}</Button>)}
                {["approved", "paid"].includes(inv.status) && <Button size="sm" variant="outline" onClick={recordPayment}>Record payment</Button>}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2"><p className="font-medium">Lines</p>{editable && <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" />Line</Button>}</div>
            <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Description</th><th className="p-2">Cost code</th><th className="p-2">Cost type</th><th className="p-2 text-right">Amount</th><th></th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-1"><Input disabled={!editable} className="h-8" defaultValue={l.description} onBlur={(e) => e.target.value && e.target.value !== l.description && updLine(l, { description: e.target.value })} /></td>
                  <td className="p-1">{editable ? <Select value={l.cost_code_id || "none"} onValueChange={(v) => updLine(l, { cost_code_id: v === "none" ? null : v })}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Uncoded</SelectItem>{codes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} {c.name}</SelectItem>)}</SelectContent></Select> : codeLabel(l.cost_code_id)}</td>
                  <td className="p-1">{editable ? <Select value={l.cost_type} onValueChange={(v) => updLine(l, { cost_type: v })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{COST_TYPES.map((t) => <SelectItem key={t} value={t}>{COST_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select> : COST_TYPE_LABEL[l.cost_type as keyof typeof COST_TYPE_LABEL] || l.cost_type}</td>
                  <td className="p-1"><Input disabled={!editable} className="h-8 w-28 ml-auto text-right" type="number" step="0.01" defaultValue={l.amount} onBlur={(e) => Number(e.target.value) !== Number(l.amount) && updLine(l, { amount: Number(e.target.value) })} /></td>
                  <td className="p-1">{editable && <Button size="sm" variant="ghost" onClick={() => updLine(l, { active: false })}>Remove</Button>}</td>
                </tr>))}
                {!lines.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Add at least one line with a cost code before approving.</td></tr>}</tbody></table>
            <div className="flex justify-end gap-6 text-sm"><span>Gross {money(inv.gross_amount)}</span><span>Retainage {money(inv.retainage_amount)}</span><span className="font-semibold">Net due {money(inv.net_due)}</span><span>Paid {money(inv.paid_amount)}</span></div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
