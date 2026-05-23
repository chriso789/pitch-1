// Master-only Import & Migration Center — Phase 1 (staging only).
// Wire this route under AI Admin Command Center / Backend Maintenance Center.
import { useEffect, useState } from "react";
import { edgeApi } from "@/lib/edgeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Batch = {
  id: string; source_system: string; source_label?: string; status: string;
  total_rows: number; valid_rows: number; invalid_rows: number; duplicate_rows: number;
  created_at: string;
};

const SOURCES = [
  "csv", "xlsx", "zip_export", "jobnimbus", "acculynx", "roofr",
  "quickbooks", "companycam", "jobber", "housecall_pro", "manual",
];

export default function ImportCenter() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("jobnimbus");
  const [label, setLabel] = useState("");
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const reload = async () => {
    const { data, error } = await edgeApi<{ batches: Batch[] }>("import-api", "/batches", {});
    if (error) { toast.error(error); return; }
    setBatches(data?.batches ?? []);
  };
  useEffect(() => { reload(); }, []);

  const createBatch = async () => {
    setLoading(true);
    const { data, error } = await edgeApi<{ batch: Batch }>("import-api", "/batches", {
      source_system: source, source_label: label || null,
    });
    setLoading(false);
    if (error) { toast.error(error); return; }
    toast.success("Batch created");
    setActiveBatch(data!.batch);
    reload();
  };

  const uploadAndParse = async () => {
    if (!activeBatch || !file) { toast.error("Pick a batch and a file"); return; }
    setLoading(true);
    try {
      const { data: signed, error } = await edgeApi<{ uploads: Array<{ file_id: string; upload_url: string; storage_path: string }> }>(
        "import-api", `/batches/${activeBatch.id}/upload-url`,
        { files: [{ filename: file.name, mime_type: file.type, file_size_bytes: file.size }] },
      );
      if (error || !signed) throw new Error(error ?? "no signed url");
      const up = signed.uploads[0];
      const putRes = await fetch(up.upload_url, { method: "PUT", body: file });
      if (!putRes.ok) throw new Error(`upload failed ${putRes.status}`);
      toast.success("Uploaded. Detecting schema…");

      const det = await edgeApi<{ entity_type: string; suggested_mapping: Record<string, { pitch_field: string }> }>(
        "import-api", `/files/${up.file_id}/detect-schema`, {},
      );
      if (det.error) throw new Error(det.error);
      const fieldMap = Object.fromEntries(
        Object.entries(det.data!.suggested_mapping).map(([k, v]) => [k, v.pitch_field]),
      );
      const parsed = await edgeApi("import-api", `/files/${up.file_id}/parse`, {
        field_map: fieldMap, entity_type: det.data!.entity_type,
      });
      if (parsed.error) throw new Error(parsed.error);
      toast.success("Parsed into staging.");
      reload();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const runStep = async (path: string) => {
    if (!activeBatch) return;
    setLoading(true);
    const { error } = await edgeApi("import-api", `/batches/${activeBatch.id}${path}`, {});
    setLoading(false);
    if (error) toast.error(error); else toast.success(path.replace("/", "") + " done");
    reload();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Import & Migration Center</h1>
        <p className="text-muted-foreground">
          Phase 1 — staging, validation, duplicate review, and dry-run only.
          Live commit, file worker, and rollback ship in Phase 2.
        </p>
      </div>

      <Tabs defaultValue="new">
        <TabsList>
          <TabsTrigger value="new">New Import</TabsTrigger>
          <TabsTrigger value="jobs">Import Jobs</TabsTrigger>
          <TabsTrigger value="run">Run Pipeline</TabsTrigger>
          <TabsTrigger value="phase2" disabled>File Queue (Phase 2)</TabsTrigger>
          <TabsTrigger value="phase2b" disabled>Rollback (Phase 2)</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Create batch</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Label (e.g. JobNimbus export May 2026)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Button disabled={loading} onClick={createBatch}>Create batch</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-2">
          {batches.map((b) => (
            <Card key={b.id} className={activeBatch?.id === b.id ? "border-primary" : ""}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="font-mono text-sm">{b.id.slice(0, 8)} · {b.source_system}</div>
                  <div className="text-sm text-muted-foreground">{b.source_label ?? "—"}</div>
                  <div className="text-xs">rows: {b.total_rows} · valid: {b.valid_rows} · invalid: {b.invalid_rows} · dupes: {b.duplicate_rows}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{b.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setActiveBatch(b)}>Select</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {batches.length === 0 && <p className="text-muted-foreground">No batches yet.</p>}
        </TabsContent>

        <TabsContent value="run" className="space-y-4">
          {!activeBatch ? <p className="text-muted-foreground">Select a batch on the Import Jobs tab first.</p> : (
            <Card>
              <CardHeader><CardTitle>Batch {activeBatch.id.slice(0, 8)} — {activeBatch.status}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={loading || !file} onClick={uploadAndParse}>Upload + Parse</Button>
                  <Button disabled={loading} variant="outline" onClick={() => runStep("/validate")}>Validate</Button>
                  <Button disabled={loading} variant="outline" onClick={() => runStep("/detect-duplicates")}>Detect Duplicates</Button>
                  <Button disabled={loading} onClick={() => runStep("/dry-run")}>Dry Run</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Phase 1: CSV only. XLSX/ZIP/JSON parsers ship in Phase 2.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
