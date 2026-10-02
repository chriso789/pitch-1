import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/commercial/engine";
import { BUYOUT_STATUSES, BUYOUT_STATUS_LABEL, RFQ_VENDOR_STATUSES, buyoutGain } from "@/lib/commercial/buyout";

const db = supabase as any;

export function BuyoutTab({ projectId, tenantId }: { projectId: string; tenantId: string | null }) {
  const [pkgs, setPkgs] = useState<any[]>([]);
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rfqFor, setRfqFor] = useState<any>(null);
  const [newPkg, setNewPkg] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    const [{ data: p }, { data: r }] = await Promise.all([
      db.from("commercial_buyout_packages").select("*, commercial_bid_packages(carried_quote_id, commercial_bid_quotes(id, bidder_name, adjusted_total))").eq("project_id", projectId).eq("tenant_id", tenantId).neq("status", "void").order("created_at"),
      db.from("commercial_rfqs").select("*, commercial_rfq_vendors(*), commercial_rfq_documents(*)").eq("project_id", projectId).eq("tenant_id", tenantId).order("created_at"),
    ]);
    setPkgs(p || []); setRfqs(r || []);
  };
  useEffect(() => { load(); }, [projectId, tenantId]);

  const suggest = async () => {
    const { data, error } = await db.rpc("commercial_suggest_buyout_packages", { _project_id: projectId });
    if (error) return toast.error(error.message);
    toast.success(data ? `${data} package(s) suggested from the budget` : "Every budget line already has a package"); load();
  };
  const createCommitment = async (p: any, kind: "po" | "subcontract") => {
    const { error } = await db.rpc("commercial_create_commitment_from_buyout", { _buyout_package_id: p.id, _kind: kind });
    if (error) return toast.error(error.message);
    toast.success(`Draft ${kind === "po" ? "purchase order" : "subcontract"} created — open POs & Subcontracts to review and submit`); load();
  };
  const upd = async (p: any, patch: any) => { const { error } = await db.from("commercial_buyout_packages").update(patch).eq("id", p.id); if (error) toast.error(error.message); load(); };

  const rows = useMemo(() => pkgs.map((p) => {
    const quotes = p.commercial_bid_packages?.commercial_bid_quotes || [];
    const sel = quotes.find((q: any) => q.id === p.commercial_bid_packages?.carried_quote_id);
    return { ...p, quotes, sel, gain: buyoutGain(Number(p.estimated_cost), Number(p.committed_cost), sel ? Number(sel.adjusted_total) : null) };
  }), [pkgs]);
  const tot = rows.reduce((a, r) => ({ est: a.est + Number(r.estimated_cost), com: a.com + Number(r.committed_cost), gain: a.gain + (r.gain.value ?? 0) }), { est: 0, com: 0, gain: 0 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={suggest}><Sparkles className="h-4 w-4 mr-1" />Suggest packages from budget</Button>
        <Button variant="outline" onClick={() => setNewPkg(true)}><Plus className="h-4 w-4 mr-1" />Add package</Button>
        <p className="text-xs text-muted-foreground">Nothing is bought automatically. You pick the carried vendor on the Bids tab.</p>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted/50 text-left"><tr>
            <th className="p-2">Package</th><th className="p-2 text-right">Estimated</th><th className="p-2 text-right">Quotes</th><th className="p-2">Selected quote</th>
            <th className="p-2 text-right">Committed</th><th className="p-2 text-right">Gain / loss</th><th className="p-2">Status</th><th className="p-2">Required</th>
          </tr></thead>
          <tbody>
            {rows.map((p) => { const isOpen = open.has(p.id); const pr = rfqs.filter((r) => r.buyout_package_id === p.id); return (
              <Fragment key={p.id}>
                <tr className="border-t">
                  <td className="p-2"><button className="font-medium hover:underline" onClick={() => { const s = new Set(open); isOpen ? s.delete(p.id) : s.add(p.id); setOpen(s); }}>
                    {isOpen ? <ChevronDown className="inline h-4 w-4" /> : <ChevronRight className="inline h-4 w-4" />} {p.name}</button>
                    {pr.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{pr.length} RFQ</span>}</td>
                  <td className="p-2 text-right">{money(p.estimated_cost)}</td>
                  <td className="p-2 text-right">{p.quotes.length}</td>
                  <td className="p-2">{p.sel ? `${p.sel.bidder_name} · ${money(p.sel.adjusted_total)}` : <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2 text-right">{money(p.committed_cost)}</td>
                  <td className={`p-2 text-right font-medium ${p.gain.value == null ? "text-muted-foreground" : p.gain.value >= 0 ? "text-primary" : "text-destructive"}`}>
                    {p.gain.value == null ? "—" : `${p.gain.value >= 0 ? "+" : ""}${money(p.gain.value)}`}{p.gain.basis === "selected" && <span className="text-xs text-muted-foreground"> (quoted)</span>}</td>
                  <td className="p-2"><Select value={p.status} onValueChange={(v) => upd(p, { status: v })}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{BUYOUT_STATUSES.map((s) => <SelectItem key={s} value={s} disabled={s === "committed" || s === "complete"}>{BUYOUT_STATUS_LABEL[s]}</SelectItem>)}</SelectContent></Select></td>
                  <td className="p-2"><Input type="date" className="h-8 w-36" defaultValue={p.required_by_date || ""} onBlur={(e) => e.target.value !== (p.required_by_date || "") && upd(p, { required_by_date: e.target.value || null })} /></td>
                </tr>
                {isOpen && <tr className="bg-muted/10"><td colSpan={8} className="p-3 space-y-3">
                  <div className="flex gap-2"><Button size="sm" onClick={() => setRfqFor(p)}>New RFQ</Button>
                    {p.sel && <><Button size="sm" variant="outline" onClick={() => createCommitment(p, p.cost_type === "subcontract" || p.cost_type === "labor" ? "subcontract" : "po")}>Create {p.cost_type === "subcontract" || p.cost_type === "labor" ? "subcontract" : "PO"} from carried quote</Button></>}
                    <Input className="h-8 max-w-md" placeholder="Notes" defaultValue={p.notes || ""} onBlur={(e) => e.target.value !== (p.notes || "") && upd(p, { notes: e.target.value })} /></div>
                  {pr.map((r) => <RfqCard key={r.id} rfq={r} tenantId={tenantId} onChange={load} />)}
                  {!pr.length && <p className="text-xs text-muted-foreground">No RFQs yet.</p>}
                </td></tr>}
              </Fragment>); })}
            {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No buyout packages yet. Award the project, then click "Suggest packages from budget".</td></tr>}
            {rows.length > 0 && <tr className="border-t-2 font-bold"><td className="p-2">Total</td><td className="p-2 text-right">{money(tot.est)}</td><td /><td />
              <td className="p-2 text-right">{money(tot.com)}</td><td className="p-2 text-right">{tot.gain >= 0 ? "+" : ""}{money(tot.gain)}</td><td colSpan={2} /></tr>}
          </tbody>
        </table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Committed comes from approved purchase orders and subcontracts. Until something is committed, gain/loss uses the selected quote.</p>
      <RfqDialog pkg={rfqFor} projectId={projectId} tenantId={tenantId} onClose={() => setRfqFor(null)} onDone={load} />
      <NewPackageDialog open={newPkg} onClose={() => setNewPkg(false)} projectId={projectId} tenantId={tenantId} onDone={load} />
    </div>
  );
}

function NewPackageDialog({ open, onClose, projectId, tenantId, onDone }: any) {
  const [f, setF] = useState({ name: "", cost_type: "material", estimated_cost: "" });
  const save = async () => {
    if (!f.name.trim()) return toast.error("Name is required");
    const { data: bp, error: e1 } = await db.from("commercial_bid_packages").insert({ tenant_id: tenantId, project_id: projectId, name: f.name.trim(), scope: "Buyout package" }).select("id").single();
    if (e1) return toast.error(e1.message);
    const { error } = await db.from("commercial_buyout_packages").insert({ tenant_id: tenantId, project_id: projectId, name: f.name.trim(), cost_type: f.cost_type, estimated_cost: Number(f.estimated_cost) || 0, bid_package_id: bp.id });
    if (error) return toast.error(error.message);
    setF({ name: "", cost_type: "material", estimated_cost: "" }); onClose(); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent>
      <DialogHeader><DialogTitle>Add buyout package</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Cost type</Label><Select value={f.cost_type} onValueChange={(v) => setF({ ...f, cost_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{["material", "labor", "equipment", "subcontract", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Estimated cost</Label><Input type="number" value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={save}>Add</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function RfqDialog({ pkg, projectId, tenantId, onClose, onDone }: any) {
  const [f, setF] = useState<any>({});
  const [docs, setDocs] = useState<any[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!pkg) return;
    setF({ title: `RFQ — ${pkg.name}`, scope: "", specifications: "", quantities: "", due_date: "", delivery_requirement: "", schedule_notes: "" }); setPick(new Set());
    db.from("documents").select("id, filename, file_path, document_type").eq("tenant_id", tenantId).contains("metadata", { commercial_project_id: projectId }).order("created_at", { ascending: false }).then(({ data }: any) => setDocs(data || []));
  }, [pkg?.id]);
  const save = async () => {
    const quantities = String(f.quantities || "").split("\n").map((s) => s.trim()).filter(Boolean).map((line) => ({ line }));
    const { data: r, error } = await db.from("commercial_rfqs").insert({ tenant_id: tenantId, project_id: projectId, buyout_package_id: pkg.id, title: f.title, scope: f.scope || null, specifications: f.specifications || null,
      quantities, due_date: f.due_date || null, delivery_requirement: f.delivery_requirement || null, schedule_notes: f.schedule_notes || null }).select("id").single();
    if (error) return toast.error(error.message);
    const chosen = docs.filter((d) => pick.has(d.id));
    if (chosen.length) await db.from("commercial_rfq_documents").insert(chosen.map((d) => ({ tenant_id: tenantId, rfq_id: r.id, document_id: d.id, file_name: d.filename, file_path: d.file_path, category: d.document_type.replace("commercial_", "") })));
    if (pkg.status === "not_started") await db.from("commercial_buyout_packages").update({ status: "pricing" }).eq("id", pkg.id);
    onClose(); onDone();
  };
  return (
    <Dialog open={!!pkg} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
      <DialogHeader><DialogTitle>New RFQ</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Title</Label><Input value={f.title || ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="col-span-2"><Label>Scope</Label><Textarea value={f.scope || ""} onChange={(e) => setF({ ...f, scope: e.target.value })} /></div>
        <div className="col-span-2"><Label>Quantities (one per line)</Label><Textarea placeholder={"42,000 SF 60 mil TPO\n1,850 LF edge metal"} value={f.quantities || ""} onChange={(e) => setF({ ...f, quantities: e.target.value })} /></div>
        <div className="col-span-2"><Label>Specifications</Label><Textarea value={f.specifications || ""} onChange={(e) => setF({ ...f, specifications: e.target.value })} /></div>
        <div><Label>Due date</Label><Input type="date" value={f.due_date || ""} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
        <div><Label>Delivery requirement</Label><Input value={f.delivery_requirement || ""} onChange={(e) => setF({ ...f, delivery_requirement: e.target.value })} /></div>
        <div className="col-span-2"><Label>Schedule notes</Label><Input value={f.schedule_notes || ""} onChange={(e) => setF({ ...f, schedule_notes: e.target.value })} /></div>
        <div className="col-span-2"><Label>Attach drawings & specs</Label>
          <div className="max-h-40 overflow-auto border rounded p-2 space-y-1">
            {docs.map((d) => <label key={d.id} className="flex gap-2 text-sm"><input type="checkbox" checked={pick.has(d.id)} onChange={() => { const s = new Set(pick); s.has(d.id) ? s.delete(d.id) : s.add(d.id); setPick(s); }} />{d.filename}</label>)}
            {!docs.length && <p className="text-xs text-muted-foreground">No project files yet.</p>}
          </div></div>
      </div>
      <DialogFooter><Button onClick={save}>Create RFQ</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function RfqCard({ rfq, tenantId, onChange }: any) {
  const [inviting, setInviting] = useState(false);
  const [opts, setOpts] = useState<any[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!inviting || !tenantId) return;
    Promise.all([
      db.from("vendors").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      db.from("contacts").select("id, first_name, last_name, company_name, email").eq("tenant_id", tenantId).or(q ? `company_name.ilike.%${q}%,last_name.ilike.%${q}%,first_name.ilike.%${q}%` : "company_name.not.is.null").limit(25),
    ]).then(([v, c]: any) => setOpts([
      ...(v.data || []).filter((x: any) => !q || x.name.toLowerCase().includes(q.toLowerCase())).map((x: any) => ({ key: `v:${x.id}`, vendor_id: x.id, vendor_name: x.name, label: `${x.name} (supplier)` })),
      ...(c.data || []).map((x: any) => { const n = x.company_name || `${x.first_name || ""} ${x.last_name || ""}`.trim(); return { key: `c:${x.id}`, contact_id: x.id, vendor_name: n, vendor_email: x.email, label: `${n}${x.company_name ? ` · ${x.first_name || ""} ${x.last_name || ""}` : ""} (contact)` }; }),
    ]));
  }, [inviting, q, tenantId]);
  const invite = async (o: any) => {
    const { key, label, ...row } = o;
    const { error } = await db.from("commercial_rfq_vendors").insert({ tenant_id: tenantId, rfq_id: rfq.id, ...row });
    if (error) return toast.error(error.message.includes("unique") ? "Already invited" : error.message);
    onChange();
  };
  const setStatus = async (v: any, status: string) => {
    const patch: any = { status, [`${status}_at`]: new Date().toISOString() };
    if (status === "declined") { const r = window.prompt("Reason (optional)"); if (r === null) return; patch.decline_reason = r || null; }
    const { error } = await db.from("commercial_rfq_vendors").update(patch).eq("id", v.id); if (error) return toast.error(error.message);
    if (status === "sent" && rfq.status === "draft") await db.from("commercial_rfqs").update({ status: "sent" }).eq("id", rfq.id);
    onChange();
  };
  const recordQuote = async (v: any) => {
    const amt = window.prompt("Base quote amount", v.quote_amount ?? ""); if (amt === null || amt === "") return;
    const fr = window.prompt("Freight (0 if included)", "0"); if (fr === null) return;
    const tx = window.prompt("Tax (0 if included)", "0"); if (tx === null) return;
    const lt = window.prompt("Lead time in days (optional)", "");
    const { error } = await db.rpc("commercial_record_rfq_quote", { _rfq_vendor_id: v.id, _amount: Number(amt), _freight: Number(fr) || 0, _tax: Number(tx) || 0, _lead_time_days: lt ? Number(lt) : null });
    if (error) return toast.error(error.message);
    toast.success("Quote added to bid leveling"); onChange();
  };
  const vendors = rfq.commercial_rfq_vendors || [];
  return (
    <div className="border rounded bg-background p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{rfq.title}</span><Badge variant="outline" className="capitalize">{rfq.status}</Badge>
        {rfq.due_date && <span className="text-xs text-muted-foreground">Due {rfq.due_date}</span>}
        {(rfq.commercial_rfq_documents || []).length > 0 && <span className="text-xs text-muted-foreground">{rfq.commercial_rfq_documents.length} file(s)</span>}
        <div className="flex-1" /><Button size="sm" variant="outline" onClick={() => setInviting(!inviting)}>{inviting ? "Done" : "Invite vendors"}</Button>
      </div>
      {rfq.scope && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{rfq.scope}</p>}
      {inviting && <div className="border rounded p-2 space-y-1">
        <Input className="h-8" placeholder="Search suppliers and contacts" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-40 overflow-auto">{opts.map((o) => <button key={o.key} className="block w-full text-left text-sm px-2 py-1 hover:bg-muted rounded" onClick={() => invite(o)}>{o.label}</button>)}
          {!opts.length && <p className="text-xs text-muted-foreground p-2">No matches. Add the vendor as a contact first.</p>}</div>
      </div>}
      <table className="w-full text-sm"><thead className="text-left text-muted-foreground"><tr><th className="p-1">Vendor</th><th className="p-1">Status</th><th className="p-1">Timeline</th><th className="p-1 text-right">Quote</th><th className="p-1" /></tr></thead>
        <tbody>{vendors.map((v: any) => (
          <tr key={v.id} className="border-t">
            <td className="p-1">{v.vendor_name}{v.vendor_email && <div className="text-xs text-muted-foreground">{v.vendor_email}</div>}</td>
            <td className="p-1"><Badge variant={v.status === "declined" ? "destructive" : v.status === "responded" ? "default" : "outline"} className="capitalize">{v.status}</Badge></td>
            <td className="p-1 text-xs text-muted-foreground">{RFQ_VENDOR_STATUSES.filter((s) => v[`${s}_at`]).map((s) => `${s} ${new Date(v[`${s}_at`]).toLocaleDateString()}`).join(" · ")}</td>
            <td className="p-1 text-right">{v.quote_amount != null ? money(v.quote_amount) : "—"}</td>
            <td className="p-1 text-right space-x-1 whitespace-nowrap">
              {v.status === "invited" && <Button size="sm" variant="ghost" onClick={() => setStatus(v, "sent")}>Mark sent</Button>}
              {v.status === "sent" && <Button size="sm" variant="ghost" onClick={() => setStatus(v, "viewed")}>Mark viewed</Button>}
              {v.status !== "declined" && <Button size="sm" variant="ghost" onClick={() => recordQuote(v)}>{v.bid_quote_id ? "Edit quote" : "Record quote"}</Button>}
              {v.status !== "declined" && v.status !== "responded" && <Button size="sm" variant="ghost" onClick={() => setStatus(v, "declined")}>Declined</Button>}
            </td>
          </tr>))}
          {!vendors.length && <tr><td colSpan={5} className="p-2 text-xs text-muted-foreground">No vendors invited yet.</td></tr>}
        </tbody></table>
    </div>
  );
}
