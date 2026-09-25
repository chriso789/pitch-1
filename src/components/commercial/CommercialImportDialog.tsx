import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { parseCsv, pick, guessDriver } from "@/lib/commercial/engine";
import { splitPdfBySize } from "@/lib/commercial/splitPdf";

const db = supabase as any;

/** Imports EDGE takeoff/estimate CSVs, Procore project lists, and shared-drive folders. */
export function CommercialImportDialog({ open, onOpenChange, onDone, projectId, initialTab }: { open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void; projectId?: string; initialTab?: string }) {
  const tenantId = useEffectiveTenantId();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const logJob = (source: string, file_name: string, rows: number, error?: string) =>
    db.from("commercial_import_jobs").insert({ tenant_id: tenantId, source, file_name, rows_imported: rows, status: error ? "failed" : "completed", error });

  const importEdge = async (file: File) => {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("No rows found in file");
    // group by project name column if present, else single project
    const groups: Record<string, Record<string, string>[]> = {};
    for (const r of rows) { const p = projectId ? "__current" : pick(r, "project", "job") || file.name.replace(/\.\w+$/, ""); (groups[p] ??= []).push(r); }
    let count = 0;
    for (const [name, list] of Object.entries(groups)) {
      let pid = projectId;
      if (!pid) {
        const { data, error } = await db.from("commercial_projects").insert({ tenant_id: tenantId, name, metadata: { imported_from: "edge" } }).select("id").single();
        if (error) throw error; pid = data.id;
      }
      const qtys = list.map((r) => {
        const label = pick(r, "description", "item", "name", "condition") || "Imported item";
        const uom = (pick(r, "uom", "unit") || "SF").toUpperCase();
        return { tenant_id: tenantId, project_id: pid, label, uom, driver: guessDriver(label, uom), value: Number(pick(r, "quantity", "qty", "amount").replace(/[^0-9.-]/g, "")) || 0,
          roof_section: pick(r, "section", "area", "zone") || null, source_sheet: pick(r, "sheet", "page") || null, source: "edge_import", review_status: "review_required" };
      }).filter((q) => q.value);
      if (qtys.length) { const { error } = await db.from("commercial_takeoff_quantities").insert(qtys); if (error) throw error; count += qtys.length; }
    }
    return count;
  };

  const importProcore = async (file: File) => {
    const rows = parseCsv(await file.text());
    const recs = rows.map((r) => ({ tenant_id: tenantId, name: pick(r, "project name", "name") || "Untitled", project_number: pick(r, "project number", "number") || null,
      address: [pick(r, "address"), pick(r, "city"), pick(r, "state")].filter(Boolean).join(", ") || null,
      client_name: pick(r, "owner", "client") || null, gc_name: pick(r, "general contractor", "gc") || null, architect_name: pick(r, "architect") || null,
      metadata: { imported_from: "procore", raw: r } })).filter((r) => r.name !== "Untitled");
    if (!recs.length) throw new Error("No projects found — expected a 'Project Name' column");
    const { error } = await db.from("commercial_projects").insert(recs); if (error) throw error;
    return recs.length;
  };

  const importFolder = async (files: FileList) => {
    if (!projectId) throw new Error("Open a project first to upload its folder");
    let n = 0;
    for (const f of Array.from(files)) {
      const rel = (f as any).webkitRelativePath || f.name;
      const cat = /spec/i.test(rel) ? "specs" : /bid|quote|proposal/i.test(rel) ? "bids" : /contract|agreement/i.test(rel) ? "contracts" : /\.(jpe?g|png|heic)$/i.test(f.name) ? "photos" : /\.(pdf|dwg)$/i.test(f.name) ? "drawings" : "other";
      const path = `${tenantId}/commercial/${projectId}/${cat}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("documents").upload(path, f);
      if (error) { console.error(error); continue; }
      await db.from("documents").insert({ tenant_id: tenantId, filename: f.name, file_path: path, file_size: f.size, mime_type: f.type, document_type: `commercial_${cat}`, description: rel, metadata: { commercial_project_id: projectId, category: cat } });
      n++;
    }
    return n;
  };

  const importPlans = async (file: File) => {
    let pid = projectId;
    if (!pid) {
      const { data: created, error: cErr } = await db.from("commercial_projects").insert({ tenant_id: tenantId, name: file.name.replace(/\.pdf$/i, ""), metadata: { imported_from: "plan_set", placeholder_name: true } }).select("id").single();
      if (cErr) throw cErr; pid = created.id;
    }
    const base = file.name.replace(/[^\w.\-]/g, "_");
    const stamp = Date.now();

    // Storage caps single files well below large plan sets — keep the full
    // original only when it fits; oversized sets live as their page-range parts.
    const FULL_LIMIT = 45 * 1024 * 1024;
    const path = `${tenantId}/commercial/${pid}/drawings/${stamp}-${base}`;
    let storedPath: string | null = null;
    if (file.size <= FULL_LIMIT) {
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      storedPath = path;
      await db.from("documents").insert({ tenant_id: tenantId, filename: file.name, file_path: path, file_size: file.size, mime_type: "application/pdf", document_type: "commercial_drawings", description: "Full plan set", metadata: { commercial_project_id: pid, category: "drawings", plan_set: true } });
    }

    // Split oversized sets into page ranges the reader can handle
    setStep("Preparing plan set…");
    const chunks = await splitPdfBySize(file, 15 * 1024 * 1024, (m) => setStep(m));
    let quantities = 0, sheets = 0, filled = 0, membrane = "";

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      setStep(chunks.length > 1 ? `Reading pages ${c.firstPage}–${c.lastPage} (part ${i + 1} of ${chunks.length})…` : "Reading plans…");
      let partPath = storedPath ?? "";
      if (!storedPath || chunks.length > 1) {
        partPath = `${tenantId}/commercial/${pid}/drawings/parts/${stamp}-p${c.firstPage}-${c.lastPage}-${base}`;
        const { error } = await supabase.storage.from("documents").upload(partPath, new Blob([c.bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf" });
        if (error) throw error;
        if (!storedPath) {
          await db.from("documents").insert({ tenant_id: tenantId, filename: `${file.name} (pages ${c.firstPage}–${c.lastPage})`, file_path: partPath, file_size: c.bytes.byteLength, mime_type: "application/pdf", document_type: "commercial_drawings", description: `Plan set part ${i + 1} of ${chunks.length}`, metadata: { commercial_project_id: pid, category: "drawings", plan_set: true, part: i + 1, part_count: chunks.length, page_range: [c.firstPage, c.lastPage], original_size: file.size } });
          if (i === 0) storedPath = partPath;
        }
      }
      const { data, error } = await supabase.functions.invoke("commercial-plan-takeoff", {
        body: { project_id: pid, file_path: partPath, file_name: file.name, chunk_index: i, chunk_count: chunks.length, page_range: [c.firstPage, c.lastPage], source_file_path: storedPath ?? partPath },
      });
      if (error) { const ctx = await (error as any).context?.json?.().catch(() => null); throw new Error(ctx?.error || error.message); }
      if (data?.error) throw new Error(data.error);
      const jobId = data?.job_id as string;
      const started = Date.now();
      let job: any = null;
      while (Date.now() - started < 20 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 5000));
        const { data: p } = await db.from("commercial_projects").select("metadata").eq("id", pid).single();
        job = (p as any)?.metadata?.plan_jobs?.[jobId];
        if (job?.status === "done" || job?.status === "error") break;
        const secs = Math.round((Date.now() - started) / 1000);
        setStep(`${chunks.length > 1 ? `Reading pages ${c.firstPage}–${c.lastPage} (part ${i + 1} of ${chunks.length})` : "Reading plans"}… ${Math.floor(secs / 60)}m ${secs % 60}s`);
      }
      if (job?.status === "error") throw new Error(job.error || "Plan reading failed");
      if (job?.status !== "done") throw new Error("Plan reading is taking too long — check the project in a few minutes.");
      Object.assign(data, job.result);
      quantities += data.quantities ?? 0;
      sheets += data.sheets ?? 0;
      filled += data.filled?.length ?? 0;
      membrane ||= data.roof_system?.membrane || "";
    }

    setStep(null);
    toast.message(`Read ${sheets} sheets${chunks.length > 1 ? ` across ${chunks.length} parts` : ""}`, { description: [filled ? `Filled ${filled} project details` : "", membrane ? `System: ${membrane}` : ""].filter(Boolean).join(" · ") || undefined });
    if (!projectId) navigate(`/commercial/${pid}`);
    return quantities;
  };

  const run = async (source: string, fn: () => Promise<number>, name: string) => {
    setBusy(true);
    try { const n = await fn(); await logJob(source, name, n); toast.success(`Imported ${n} records`); onDone?.(); onOpenChange(false); }
    catch (e: any) { await logJob(source, name, 0, e.message); toast.error(e.message); }
    finally { setBusy(false); setStep(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Import existing data</DialogTitle></DialogHeader>
        <Tabs defaultValue={initialTab ?? "plans"}>
          <TabsList className="grid grid-cols-4"><TabsTrigger value="plans">Plan set</TabsTrigger><TabsTrigger value="edge">EDGE</TabsTrigger><TabsTrigger value="procore">Procore</TabsTrigger><TabsTrigger value="drive">Shared drive</TabsTrigger></TabsList>
          <TabsContent value="plans" className="space-y-2 text-sm">
            <p className="text-muted-foreground">Upload the full plan set PDF — any size. Big sets are split into page ranges automatically and read part by part. {projectId ? "" : "A new project is created and filled from the title block (name, address, project #, owner, architect, engineer, GC, bid date, roof area). "}AI indexes every sheet, reads the roof plans, details and specs, and fills the takeoff plus the specified roof system. Quantities land as "Review required". Large sets take a few minutes.</p>
            <FilePick accept=".pdf,application/pdf" disabled={busy} label={busy ? (step ?? "Reading plans… this can take a few minutes") : "Import plan set PDF"} onFile={(f) => run("plan_set", () => importPlans(f), f.name)} />
            {busy && step && <p className="text-xs text-muted-foreground">{step}</p>}
          </TabsContent>
          <TabsContent value="edge" className="space-y-2 text-sm">
            <p className="text-muted-foreground">EDGE takeoff/estimate export as CSV. Columns like Description, Quantity, UOM, Section, Sheet are detected. All imported quantities start as "Review required".</p>
            <FilePick accept=".csv" disabled={busy} onFile={(f) => run("edge", () => importEdge(f), f.name)} />
          </TabsContent>
          <TabsContent value="procore" className="space-y-2 text-sm">
            <p className="text-muted-foreground">Procore project list export (CSV) — creates one commercial project per row.</p>
            <FilePick accept=".csv" disabled={busy} onFile={(f) => run("procore", () => importProcore(f), f.name)} />
          </TabsContent>
          <TabsContent value="drive" className="space-y-2 text-sm">
            <p className="text-muted-foreground">Pick a project folder from the shared drive. Files are sorted into Drawings, Specs, Bids, Contracts, Photos. {!projectId && "Open a project first."}</p>
            <Button variant="outline" className="w-full" disabled={busy || !projectId} asChild={false}
              onClick={() => { const i = document.createElement("input"); i.type = "file"; (i as any).webkitdirectory = true; i.multiple = true; i.onchange = () => i.files && run("shared_drive", () => importFolder(i.files!), `${i.files.length} files`); i.click(); }}>
              Choose folder
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FilePick({ accept, disabled, onFile, label }: { accept: string; disabled: boolean; onFile: (f: File) => void; label?: string }) {
  return (
    <Button variant="outline" className="w-full" disabled={disabled}
      onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.onchange = () => i.files?.[0] && onFile(i.files[0]); i.click(); }}>
      {label ?? (disabled ? "Importing…" : "Choose file")}
    </Button>
  );
}
