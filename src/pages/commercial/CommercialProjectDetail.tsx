import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Check, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { DRIVERS, USABLE, STARTER_ASSEMBLIES, buildLines, computeTotals, money, autoReviewStatus } from "@/lib/commercial/engine";
import { CommercialImportDialog } from "@/components/commercial/CommercialImportDialog";

const db = supabase as any;
const STATUS_STYLE: Record<string, string> = {
  auto_detected: "bg-secondary text-secondary-foreground", review_required: "bg-destructive/15 text-destructive",
  verified: "bg-primary/15 text-primary", manually_overridden: "bg-accent text-accent-foreground", rejected: "bg-muted text-muted-foreground line-through",
};

export default function CommercialProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useEffectiveTenantId();
  const [p, setP] = useState<any>(null);
  const [qtys, setQtys] = useState<any[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    const [{ data: proj }, { data: q }] = await Promise.all([
      db.from("commercial_projects").select("*").eq("id", id).maybeSingle(),
      db.from("commercial_takeoff_quantities").select("*").eq("project_id", id).order("created_at"),
    ]);
    setP(proj); setQtys(q || []);
  };
  useEffect(() => { load(); }, [id]);

  const saveProject = async (patch: any) => {
    setP({ ...p, ...patch });
    const { error } = await db.from("commercial_projects").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  };

  if (!p) return <GlobalLayout><div className="p-10 text-center text-muted-foreground">Loading…</div></GlobalLayout>;
  const pending = qtys.filter((q) => !USABLE.has(q.review_status) && q.review_status !== "rejected").length;

  return (
    <GlobalLayout>
      <div className="p-6 space-y-4">
        <Link to="/commercial" className="text-sm text-muted-foreground flex items-center gap-1"><ArrowLeft className="h-4 w-4" />Commercial</Link>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div><h1 className="text-2xl font-bold">{p.name}</h1><p className="text-muted-foreground text-sm">{[p.project_number, p.gc_name, p.address].filter(Boolean).join(" · ")}</p></div>
          <div className="flex gap-2 items-center">
            {pending > 0 && <Badge variant="destructive">{pending} quantities need review</Badge>}
            <Select value={p.status} onValueChange={(v) => saveProject({ status: v })}>
              <SelectTrigger className="w-36 capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>{["bidding", "submitted", "won", "lost"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>
          </div>
        </div>
        <Tabs defaultValue="takeoff">
          <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="takeoff">Takeoff</TabsTrigger><TabsTrigger value="estimate">Estimate</TabsTrigger><TabsTrigger value="bids">Bids</TabsTrigger><TabsTrigger value="files">Drawings & Files</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
          <TabsContent value="overview"><Overview p={p} save={saveProject} /></TabsContent>
          <TabsContent value="takeoff"><Takeoff projectId={id!} tenantId={tenantId} qtys={qtys} reload={load} /></TabsContent>
          <TabsContent value="estimate"><Estimate projectId={id!} tenantId={tenantId} qtys={qtys} project={p} /></TabsContent>
          <TabsContent value="bids"><Bids projectId={id!} tenantId={tenantId} /></TabsContent>
          <TabsContent value="files"><Files projectId={id!} onImport={() => setImportOpen(true)} /></TabsContent>
          <TabsContent value="history"><History projectId={id!} /></TabsContent>
        </Tabs>
      </div>
      <CommercialImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={load} projectId={id} />
    </GlobalLayout>
  );
}

function Overview({ p, save }: any) {
  const [f, setF] = useState(p);
  const fields = [["name", "Project name"], ["project_number", "Project #"], ["client_name", "Client"], ["owner_name", "Owner"], ["gc_name", "General contractor"], ["architect_name", "Architect"], ["engineer_name", "Engineer"], ["address", "Address"]];
  return (
    <Card><CardContent className="p-4 grid md:grid-cols-2 gap-3">
      {fields.map(([k, l]) => <div key={k}><Label>{l}</Label><Input value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} onBlur={() => f[k] !== p[k] && save({ [k]: f[k] })} /></div>)}
      <div><Label>Bid due</Label><Input type="date" value={f.bid_due_date || ""} onChange={(e) => { setF({ ...f, bid_due_date: e.target.value }); save({ bid_due_date: e.target.value || null }); }} /></div>
      <div className="md:col-span-2"><Label>Notes</Label><Textarea value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} onBlur={() => save({ notes: f.notes })} /></div>
    </CardContent></Card>
  );
}

function Takeoff({ projectId, tenantId, qtys, reload }: any) {
  const [n, setN] = useState<any>({ driver: "roof_area", label: "", value: "", roof_section: "", source_sheet: "", confidence: "", scale_status: "unverified" });

  const add = async () => {
    const d = DRIVERS.find((x) => x.key === n.driver)!;
    const conf = n.confidence === "" ? null : Number(n.confidence);
    const { error } = await db.from("commercial_takeoff_quantities").insert({ tenant_id: tenantId, project_id: projectId, driver: n.driver, label: n.label || d.label, uom: d.uom,
      value: Number(n.value) || 0, roof_section: n.roof_section || null, source_sheet: n.source_sheet || null, confidence: conf, scale_status: n.scale_status,
      source: conf == null ? "manual" : "ai", review_status: conf == null ? "verified" : autoReviewStatus(conf, n.scale_status) });
    if (error) return toast.error(error.message);
    setN({ ...n, label: "", value: "", confidence: "" }); reload();
  };

  const setStatus = async (q: any, review_status: string) => {
    const patch: any = { review_status };
    if (review_status === "verified") { const { data } = await supabase.auth.getUser(); patch.verified_by = data.user?.id; patch.verified_at = new Date().toISOString(); }
    await db.from("commercial_takeoff_quantities").update(patch).eq("id", q.id); reload();
  };

  const override = async (q: any, v: string) => {
    const value = Number(v); if (value === Number(q.value)) return;
    const reason = window.prompt(`Reason for changing ${q.label} from ${q.value} to ${value}?`);
    if (!reason) return reload();
    await db.from("commercial_takeoff_quantities").update({ value, overridden_from: q.overridden_from ?? q.value, override_reason: reason, review_status: "manually_overridden" }).eq("id", q.id);
    reload();
  };

  const totals = DRIVERS.map((d) => ({ ...d, v: qtys.filter((q: any) => q.driver === d.key && q.review_status !== "rejected").reduce((a: number, q: any) => a + Number(q.value), 0) })).filter((d) => d.v);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {totals.map((t) => <Card key={t.key}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{t.label}</div><div className="text-lg font-semibold">{t.v.toLocaleString()} {t.uom}</div></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Add quantity</CardTitle></CardHeader><CardContent className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
        <div className="md:col-span-2"><Label>Item</Label><Select value={n.driver} onValueChange={(v) => setN({ ...n, driver: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DRIVERS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label} ({d.uom})</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Qty</Label><Input type="number" value={n.value} onChange={(e) => setN({ ...n, value: e.target.value })} /></div>
        <div><Label>Section</Label><Input value={n.roof_section} onChange={(e) => setN({ ...n, roof_section: e.target.value })} placeholder="Roof A" /></div>
        <div><Label>Sheet</Label><Input value={n.source_sheet} onChange={(e) => setN({ ...n, source_sheet: e.target.value })} placeholder="A2.1" /></div>
        <div><Label>AI conf. %</Label><Input type="number" value={n.confidence} onChange={(e) => setN({ ...n, confidence: e.target.value })} placeholder="manual" /></div>
        <div><Label>Scale</Label><Select value={n.scale_status} onValueChange={(v) => setN({ ...n, scale_status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="verified">Verified</SelectItem><SelectItem value="unverified">Unverified</SelectItem></SelectContent></Select></div>
        <Button onClick={add}><Plus className="h-4 w-4" /></Button>
      </CardContent></Card>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Item</th><th className="p-2">Section</th><th className="p-2 w-32">Quantity</th><th className="p-2">Sheet</th><th className="p-2">Conf.</th><th className="p-2">Scale</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>{qtys.map((q: any) => (
            <tr key={q.id} className="border-t">
              <td className="p-2">{q.label}<div className="text-xs text-muted-foreground">{q.source}{q.overridden_from != null && ` · was ${q.overridden_from}`}</div></td>
              <td className="p-2">{q.roof_section || "—"}</td>
              <td className="p-2"><div className="flex items-center gap-1"><Input key={q.value} defaultValue={q.value} type="number" className="h-8" onBlur={(e) => override(q, e.target.value)} />{q.uom}</div></td>
              <td className="p-2">{q.source_sheet || "—"}</td>
              <td className="p-2">{q.confidence != null ? `${q.confidence}%` : "—"}</td>
              <td className="p-2 capitalize">{q.scale_status}</td>
              <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[q.review_status]}`}>{q.review_status.replace(/_/g, " ")}</span></td>
              <td className="p-2 whitespace-nowrap">
                {!USABLE.has(q.review_status) && <Button size="sm" variant="ghost" onClick={() => setStatus(q, "verified")} title="Verify"><Check className="h-4 w-4" /></Button>}
                <Button size="sm" variant="ghost" onClick={() => setStatus(q, q.review_status === "rejected" ? "review_required" : "rejected")} title="Reject"><Trash2 className="h-4 w-4" /></Button>
              </td>
            </tr>))}
            {!qtys.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No quantities yet — add them above, import an EDGE export, or run a blueprint takeoff.</td></tr>}
          </tbody></table>
      </CardContent></Card>
    </div>
  );
}

function Estimate({ projectId, tenantId, qtys, project }: any) {
  const [assemblies, setAssemblies] = useState<any[]>([]);
  const [est, setEst] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);

  const load = async () => {
    let { data: a } = await db.from("commercial_assemblies").select("*, commercial_assembly_components(*)").eq("tenant_id", tenantId).eq("active", true).order("name");
    if (!a?.length && tenantId) {
      for (const s of STARTER_ASSEMBLIES) {
        const { data: row } = await db.from("commercial_assemblies").insert({ tenant_id: tenantId, name: s.name, system_type: s.system_type }).select("id").single();
        if (row) await db.from("commercial_assembly_components").insert(s.components.map((c, i) => ({ ...c, tenant_id: tenantId, assembly_id: row.id, sort_order: i })));
      }
      ({ data: a } = await db.from("commercial_assemblies").select("*, commercial_assembly_components(*)").eq("tenant_id", tenantId).eq("active", true).order("name"));
    }
    setAssemblies(a || []);
    let { data: e } = await db.from("commercial_estimates").select("*").eq("project_id", projectId).order("created_at").limit(1).maybeSingle();
    if (!e) ({ data: e } = await db.from("commercial_estimates").insert({ tenant_id: tenantId, project_id: projectId }).select("*").single());
    setEst(e);
    const [{ data: l }, { data: v }] = await Promise.all([
      db.from("commercial_estimate_lines").select("*").eq("estimate_id", e.id).order("sort_order"),
      db.from("commercial_estimate_versions").select("*").eq("estimate_id", e.id).order("version_number", { ascending: false }),
    ]);
    setLines(l || []); setVersions(v || []);
  };
  useEffect(() => { if (tenantId) load(); }, [projectId, tenantId]);

  const totals = useMemo(() => est ? computeTotals(lines, est) : null, [lines, est]);

  const persistTotals = async (ls: any[], e: any) => {
    const t = computeTotals(ls, e);
    await db.from("commercial_estimates").update({ material_total: t.material, labor_total: t.labor, sub_total: t.sub, bid_total: t.bid }).eq("id", e.id);
  };

  const patchEst = async (patch: any) => {
    const e = { ...est, ...patch }; setEst(e);
    await db.from("commercial_estimates").update(patch).eq("id", est.id); await persistTotals(lines, e);
  };

  const generate = async () => {
    const a = assemblies.find((x) => x.id === est.assembly_id);
    if (!a) return toast.error("Pick a roof system first");
    const comps = [...a.commercial_assembly_components].sort((x: any, y: any) => x.sort_order - y.sort_order);
    const built = buildLines(qtys, comps).filter((l) => l.quantity > 0);
    await db.from("commercial_estimate_lines").delete().eq("estimate_id", est.id);
    const { data, error } = await db.from("commercial_estimate_lines").insert(built.map((l) => ({ ...l, tenant_id: tenantId, estimate_id: est.id }))).select("*");
    if (error) return toast.error(error.message);
    setLines(data); await persistTotals(data, est); toast.success(`${data.length} lines built from takeoff`);
  };

  const editLine = async (l: any, patch: any) => {
    const nl = { ...l, ...patch }; nl.total = Math.round(Number(nl.quantity) * Number(nl.unit_cost) * 100) / 100;
    const ls = lines.map((x) => x.id === l.id ? nl : x); setLines(ls);
    await db.from("commercial_estimate_lines").update({ quantity: nl.quantity, unit_cost: nl.unit_cost, total: nl.total, description: nl.description }).eq("id", l.id);
    await persistTotals(ls, est);
  };

  const addLine = async (kind: string) => {
    const { data } = await db.from("commercial_estimate_lines").insert({ tenant_id: tenantId, estimate_id: est.id, kind, description: kind === "subcontract" ? "Subcontract" : "New item", quantity: 1, unit_cost: 0, total: 0, sort_order: lines.length }).select("*").single();
    if (data) setLines([...lines, data]);
  };

  const submit = async () => {
    const { error } = await db.from("commercial_estimate_versions").insert({ tenant_id: tenantId, estimate_id: est.id, version_number: (versions[0]?.version_number || 0) + 1, snapshot: { estimate: est, lines, totals }, bid_total: totals?.bid || 0 });
    if (error) return toast.error(error.message);
    await db.from("commercial_estimates").update({ status: "submitted" }).eq("id", est.id);
    toast.success("Version locked and submitted for approval"); load();
  };

  const approve = async (v: any) => toast.info("Submitted versions are locked. Approvals are recorded in history.");

  if (!est) return <div className="p-6 text-muted-foreground">Loading…</div>;
  const kinds = ["material", "labor", "equipment", "subcontract"];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card><CardContent className="p-4 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[240px]"><Label>Roof system</Label>
            <Select value={est.assembly_id || ""} onValueChange={(v) => patchEst({ assembly_id: v })}><SelectTrigger><SelectValue placeholder="Choose assembly" /></SelectTrigger>
              <SelectContent>{assemblies.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={generate}>Build from takeoff</Button>
          {kinds.map((k) => <Button key={k} variant="outline" size="sm" onClick={() => addLine(k)} className="capitalize">+ {k}</Button>)}
        </CardContent></Card>
        {kinds.map((k) => { const ls = lines.filter((l) => l.kind === k); if (!ls.length) return null; return (
          <Card key={k}><CardHeader className="py-3"><CardTitle className="text-sm capitalize">{k}</CardTitle></CardHeader><CardContent className="p-0">
            <table className="w-full text-sm"><tbody>{ls.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2"><Input className="h-8" defaultValue={l.description} onBlur={(e) => e.target.value !== l.description && editLine(l, { description: e.target.value })} /></td>
                <td className="p-2 w-28"><Input className="h-8" type="number" defaultValue={l.quantity} onBlur={(e) => editLine(l, { quantity: Number(e.target.value) })} /></td>
                <td className="p-2 w-16 text-muted-foreground">{l.uom}</td>
                <td className="p-2 w-28"><Input className="h-8" type="number" defaultValue={l.unit_cost} onBlur={(e) => editLine(l, { unit_cost: Number(e.target.value) })} /></td>
                <td className="p-2 w-28 text-right font-medium">{money(l.total)}</td>
                <td className="p-2 w-10"><Button size="sm" variant="ghost" onClick={async () => { await db.from("commercial_estimate_lines").delete().eq("id", l.id); const ls2 = lines.filter((x) => x.id !== l.id); setLines(ls2); persistTotals(ls2, est); }}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>))}</tbody></table>
          </CardContent></Card>); })}
        <Card><CardContent className="p-4"><Label>Exclusions / clarifications</Label><Textarea defaultValue={est.exclusions || ""} onBlur={(e) => patchEst({ exclusions: e.target.value })} /></CardContent></Card>
      </div>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">Bid summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {totals && <>
            <Row l="Material" v={totals.material} /><Row l="Labor" v={totals.labor} /><Row l="Equipment" v={totals.equipment} /><Row l="Subcontract" v={totals.sub} /><Row l="Material tax" v={totals.tax} />
            <div className="grid grid-cols-2 gap-2 pt-2">
              {[["general_conditions", "Gen. conditions $"], ["tax_pct", "Tax %"], ["overhead_pct", "Overhead %"], ["profit_pct", "Profit %"], ["bond_pct", "Bond %"]].map(([k, l]) =>
                <div key={k}><Label className="text-xs">{l}</Label><Input className="h-8" type="number" defaultValue={est[k]} onBlur={(e) => patchEst({ [k]: Number(e.target.value) })} /></div>)}
            </div>
            <Row l="Direct cost" v={totals.direct} /><Row l="Overhead" v={totals.overhead} /><Row l="Profit" v={totals.profit} /><Row l="Bond" v={totals.bond} />
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Bid total</span><span>{money(totals.bid)}</span></div>
            {project.roof_area_sf ? <div className="text-xs text-muted-foreground text-right">{money(totals.bid / project.roof_area_sf)} / SF</div> : null}
          </>}
          <Button className="w-full mt-2" onClick={submit}>Submit & lock version</Button>
          <p className="text-xs text-muted-foreground">Submitting is blocked until every takeoff quantity is verified, overridden, or rejected.</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Versions & approvals</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          {versions.map((v) => <VersionRow key={v.id} v={v} project={project} onChange={load} />)}
          {!versions.length && <p className="text-muted-foreground">No submitted versions yet.</p>}
          <p className="text-xs text-muted-foreground">Under $100k: Estimator. $100k–$500k: + Senior Estimator. Over $500k: + Executive.</p>
        </CardContent></Card>
      </div>
    </div>
  );
}

const Row = ({ l, v }: { l: string; v: number }) => <div className="flex justify-between"><span className="text-muted-foreground">{l}</span><span>{money(v)}</span></div>;

const STEP_LABEL: Record<string, string> = { estimator: "Estimator", senior_estimator: "Senior Estimator", executive: "Executive" };
const stepsFor = (amt: number) => amt > 500000 ? ["estimator", "senior_estimator", "executive"] : amt >= 100000 ? ["estimator", "senior_estimator"] : ["estimator"];

function VersionRow({ v, project, onChange }: any) {
  const [appr, setAppr] = useState<any[]>([]);
  const load = () => db.from("commercial_estimate_approvals").select("*").eq("version_id", v.id).order("created_at").then(({ data }: any) => setAppr(data || []));
  useEffect(() => { load(); }, [v.id, v.status]);
  const steps = stepsFor(Number(v.bid_total || 0));
  const done = new Set(appr.filter((a) => a.decision === "approved").map((a) => a.step));
  const next = v.status === "approved" || v.status === "rejected" ? null : steps.find((s) => !done.has(s));
  const decide = async (decision: string) => {
    const comments = decision === "rejected" ? window.prompt("Reason for rejecting?") : window.prompt("Comments (optional)") ?? "";
    if (decision === "rejected" && !comments) return;
    const { error } = await db.rpc("commercial_decide_version", { _version_id: v.id, _decision: decision, _comments: comments || null });
    if (error) return toast.error(error.message);
    toast.success(decision === "approved" ? "Approved" : "Rejected"); load(); onChange();
  };
  const pdf = async () => {
    const { buildProposalPdf } = await import("@/lib/commercial/proposalPdf");
    const { data: t } = await db.from("tenants").select("name, phone, email").eq("id", v.tenant_id).maybeSingle();
    buildProposalPdf({ project, version: v, company: t || undefined }).save(`${project.name.replace(/[^\w-]+/g, "_")}-proposal-v${v.version_number}.pdf`);
  };
  return (
    <div className="border rounded p-2 space-y-1">
      <div className="flex justify-between"><span className="font-medium">v{v.version_number} · {new Date(v.created_at).toLocaleDateString()}</span><span className="font-medium">{money(v.bid_total)}</span></div>
      <div className="flex flex-wrap gap-1">{steps.map((s) => { const a = appr.find((x) => x.step === s); return <Badge key={s} variant={a?.decision === "approved" ? "default" : a?.decision === "rejected" ? "destructive" : "outline"}>{STEP_LABEL[s]}{a ? ` ✓` : ""}</Badge>; })}</div>
      {v.status === "rejected" && <p className="text-xs text-destructive">Rejected: {v.comments}</p>}
      <div className="flex gap-1 pt-1">
        {next && <><Button size="sm" onClick={() => decide("approved")}>Approve as {STEP_LABEL[next]}</Button><Button size="sm" variant="outline" onClick={() => decide("rejected")}>Reject</Button></>}
        <Button size="sm" variant="outline" onClick={pdf} disabled={v.status !== "approved"} title={v.status !== "approved" ? "Available once fully approved" : ""}>Proposal PDF</Button>
      </div>
    </div>
  );
}

function Bids({ projectId, tenantId }: any) {
  const [pkgs, setPkgs] = useState<any[]>([]);
  const [name, setName] = useState("");
  const load = async () => { const { data } = await db.from("commercial_bid_packages").select("*, commercial_bid_quotes(*)").eq("project_id", projectId).order("created_at"); setPkgs(data || []); };
  useEffect(() => { load(); }, [projectId]);
  const addPkg = async () => { if (!name) return; await db.from("commercial_bid_packages").insert({ tenant_id: tenantId, project_id: projectId, name }); setName(""); load(); };
  const addQuote = async (pkg: any) => {
    const bidder = window.prompt("Bidder / supplier name"); if (!bidder) return;
    const amt = Number(window.prompt("Quote amount") || 0);
    await db.from("commercial_bid_quotes").insert({ tenant_id: tenantId, package_id: pkg.id, bidder_name: bidder, amount: amt }); load();
  };
  const upd = async (q: any, patch: any) => { await db.from("commercial_bid_quotes").update(patch).eq("id", q.id); };
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Input placeholder="New bid package (e.g. Sheet metal, Crane, Membrane supply)" value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={addPkg}>Add</Button></div>
      {pkgs.map((pkg) => { const low = Math.min(...pkg.commercial_bid_quotes.map((q: any) => Number(q.amount)));
        return (
        <Card key={pkg.id}><CardHeader className="py-3 flex-row items-center justify-between"><CardTitle className="text-base">{pkg.name}</CardTitle><Button size="sm" variant="outline" onClick={() => addQuote(pkg)}>+ Quote</Button></CardHeader>
          <CardContent className="p-0"><table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Bidder</th><th className="p-2">Amount</th><th className="p-2">Includes</th><th className="p-2">Excludes</th><th className="p-2">Scope gaps</th><th className="p-2">Carry</th></tr></thead>
            <tbody>{pkg.commercial_bid_quotes.map((q: any) => (
              <tr key={q.id} className="border-t">
                <td className="p-2 font-medium">{q.bidder_name}</td>
                <td className={`p-2 ${Number(q.amount) === low ? "text-primary font-semibold" : ""}`}>{money(q.amount)}</td>
                {["includes", "excludes", "scope_gaps"].map((k) => <td key={k} className="p-2"><Input className="h-8" defaultValue={q[k] || ""} onBlur={(e) => upd(q, { [k]: e.target.value })} /></td>)}
                <td className="p-2"><input type="radio" name={pkg.id} defaultChecked={pkg.carried_quote_id === q.id} onChange={async () => { await db.from("commercial_bid_packages").update({ carried_quote_id: q.id }).eq("id", pkg.id); }} /></td>
              </tr>))}
              {!pkg.commercial_bid_quotes.length && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No quotes yet.</td></tr>}
            </tbody></table></CardContent></Card>); })}
    </div>
  );
}

function Files({ projectId, onImport }: any) {
  const [docs, setDocs] = useState<any[]>([]);
  useEffect(() => { db.from("documents").select("id, filename, file_path, document_type, created_at").contains("metadata", { commercial_project_id: projectId }).order("created_at", { ascending: false }).then(({ data }: any) => setDocs(data || [])); }, [projectId]);
  const open = async (d: any) => { const { data } = await supabase.storage.from("documents").createSignedUrl(d.file_path, 600); if (data) window.open(data.signedUrl, "_blank"); };
  const groups = docs.reduce((a: any, d) => { const k = d.document_type.replace("commercial_", ""); (a[k] ??= []).push(d); return a; }, {});
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><Button variant="outline" onClick={onImport}><Upload className="h-4 w-4 mr-1" />Upload project folder</Button><Button variant="outline" asChild><Link to="/blueprints">Run blueprint takeoff</Link></Button></div>
      {Object.entries(groups).map(([k, list]: any) => (
        <Card key={k}><CardHeader className="py-3"><CardTitle className="text-sm capitalize">{k} ({list.length})</CardTitle></CardHeader><CardContent className="space-y-1">
          {list.map((d: any) => <button key={d.id} onClick={() => open(d)} className="block text-sm text-primary hover:underline text-left">{d.filename}</button>)}
        </CardContent></Card>))}
      {!docs.length && <p className="text-muted-foreground text-sm">No files yet.</p>}
    </div>
  );
}

function History({ projectId }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { db.from("commercial_audit_log").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(200).then(({ data }: any) => setRows(data || [])); }, [projectId]);
  const diff = (o: any, n: any) => { if (!o || !n) return ""; return Object.keys(n).filter((k) => !["updated_at"].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => `${k}: ${o[k] ?? "—"} → ${n[k] ?? "—"}`).join(", "); };
  return (
    <Card><CardContent className="p-0"><table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">When</th><th className="p-2">Record</th><th className="p-2">Action</th><th className="p-2">Change</th><th className="p-2">Reason</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td><td className="p-2">{r.record_type.replace("commercial_", "")}</td><td className="p-2">{r.action}</td><td className="p-2 text-xs">{r.action === "UPDATE" ? diff(r.old_value, r.new_value) : r.new_value?.label || r.old_value?.label || ""}</td><td className="p-2">{r.reason || ""}</td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No changes recorded yet.</td></tr>}</tbody></table></CardContent></Card>
  );
}
