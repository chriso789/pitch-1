import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { toast } from "sonner";
import { Upload, FileText, Loader2, CheckCircle2, AlertTriangle, X, Search } from "lucide-react";

const MAX_FILES = 100;
const BUCKET = "project-invoices";

type JobCandidate = {
  id: string;
  label: string;
  address: string | null;
  clj: string | null;
  contact_name: string | null;
  score: number;
  reason: string;
};

type Row = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "parsing" | "matching" | "ready" | "saving" | "saved" | "duplicate" | "error";
  message?: string;
  documentUrl?: string;
  parsed?: any;
  candidates: JobCandidate[];
  selectedJobId?: string;
  allowDuplicate?: boolean;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onComplete?: () => void;
}

function normAddr(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|circle|cir|place|pl|way|terrace|ter)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normAddr(s).split(" ").filter((t) => t.length > 1);
}

function nameTokens(s: string | null | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function BulkInvoiceImportDialog({ open, onOpenChange, onComplete }: Props) {
  const tenantId = useEffectiveTenantId();
  const [rows, setRows] = useState<Row[]>([]);
  const [processing, setProcessing] = useState(false);
  const [submittingAll, setSubmittingAll] = useState(false);

  const reset = useCallback(() => {
    setRows([]);
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !tenantId) return;
      const arr = Array.from(files).slice(0, MAX_FILES - rows.length);
      if (arr.length === 0) {
        toast.error(`Maximum ${MAX_FILES} invoices per batch reached`);
        return;
      }
      const newRows: Row[] = arr.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "pending",
        candidates: [],
      }));
      setRows((prev) => [...prev, ...newRows]);

      setProcessing(true);
      // Process in parallel batches of 4
      const queue = [...newRows];
      const workers: Promise<void>[] = [];
      const runOne = async () => {
        while (queue.length) {
          const r = queue.shift();
          if (!r) return;
          await processRow(r);
        }
      };
      for (let i = 0; i < 4; i++) workers.push(runOne());
      await Promise.all(workers);
      setProcessing(false);
    },
    [rows.length, tenantId]
  );

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const processRow = async (row: Row) => {
    if (!tenantId) return;
    try {
      // 1. Upload to storage
      updateRow(row.id, { status: "uploading" });
      const path = `${tenantId}/bulk-invoices/${Date.now()}-${row.file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, row.file, { upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
      const documentUrl = signed?.signedUrl || pub.publicUrl;

      // 2. Parse via edge function
      updateRow(row.id, { status: "parsing", documentUrl });
      const { data: parseData, error: parseErr } = await supabase.functions.invoke("parse-invoice-document", {
        body: { document_url: documentUrl, source_file_name: row.file.name, auto_persist: false },
      });
      if (parseErr) throw new Error(parseErr.message);
      const parsed = parseData?.parsed;
      if (!parsed) throw new Error("Could not extract invoice data");

      // 3. Match against jobs
      updateRow(row.id, { status: "matching", parsed });
      const candidates = await findCandidates(parsed, tenantId);

      updateRow(row.id, {
        status: "ready",
        candidates,
        selectedJobId: candidates[0]?.id,
      });
    } catch (e: any) {
      updateRow(row.id, { status: "error", message: e.message || String(e) });
    }
  };

  const findCandidates = async (parsed: any, tid: string): Promise<JobCandidate[]> => {
    const scoreMap = new Map<string, JobCandidate>();
    const add = (e: any, points: number, reason: string) => {
      const c = e.contacts || {};
      const addr = [c.address_street, c.address_city, c.address_state, c.address_zip].filter(Boolean).join(", ");
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "";
      const label = `${name || "—"} · ${addr || "no address"}${e.clj_formatted_number ? ` · #${e.clj_formatted_number}` : ""}`;
      const existing = scoreMap.get(e.id);
      if (existing) {
        existing.score += points;
        existing.reason = `${existing.reason}, ${reason}`;
      } else {
        scoreMap.set(e.id, {
          id: e.id,
          label,
          address: addr || null,
          clj: e.clj_formatted_number || null,
          contact_name: name || null,
          score: points,
          reason,
        });
      }
    };

    const baseSelect = "id, clj_formatted_number, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, company_name, address_street, address_city, address_state, address_zip)";

    // 1. Job number → CLJ
    if (parsed.job_number) {
      const cleaned = String(parsed.job_number).replace(/[^\w\-]/g, "");
      if (cleaned) {
        const { data } = await supabase
          .from("pipeline_entries")
          .select(baseSelect)
          .eq("tenant_id", tid)
          .eq("is_deleted", false)
          .ilike("clj_formatted_number", `%${cleaned}%`)
          .limit(5);
        (data || []).forEach((e: any) => add(e, 100, `job # match (${parsed.job_number})`));
      }
    }

    // 2. Service address — token search on street
    if (parsed.service_address) {
      const tokens = tokenize(parsed.service_address);
      const streetTok = tokens.find((t) => /^\d+$/.test(t));
      const wordTok = tokens.find((t) => t.length > 3 && !/^\d+$/.test(t));
      if (streetTok) {
        let q = supabase
          .from("pipeline_entries")
          .select(baseSelect + ", contacts!inner(address_street)")
          .eq("tenant_id", tid)
          .eq("is_deleted", false)
          .ilike("contacts.address_street", `%${streetTok}%`);
        if (wordTok) q = q.ilike("contacts.address_street", `%${wordTok}%`);
        const { data } = await q.limit(8);
        (data || []).forEach((e: any) => add(e, 60, `address match (${streetTok}${wordTok ? " " + wordTok : ""})`));
      }
    }

    // 3. Customer name
    if (parsed.customer_name) {
      const tokens = nameTokens(parsed.customer_name);
      for (const tk of tokens.slice(0, 2)) {
        const { data } = await supabase
          .from("pipeline_entries")
          .select(baseSelect + ", contacts!inner(first_name, last_name)")
          .eq("tenant_id", tid)
          .eq("is_deleted", false)
          .or(`first_name.ilike.%${tk}%,last_name.ilike.%${tk}%`, { foreignTable: "contacts" })
          .limit(8);
        (data || []).forEach((e: any) => add(e, 20, `name match (${tk})`));
      }
    }

    return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  };

  const submitRow = async (row: Row): Promise<boolean> => {
    if (!row.selectedJobId || !row.parsed) return false;
    updateRow(row.id, { status: "saving" });
    const p = row.parsed;
    const { data, error } = await supabase.functions.invoke("submit-project-invoice", {
      body: {
        pipeline_entry_id: row.selectedJobId,
        invoice_type: "material",
        vendor_name: p.vendor_name,
        invoice_number: p.invoice_number,
        invoice_date: p.invoice_date,
        invoice_amount: p.total_amount ?? p.invoice_amount,
        subtotal: p.subtotal,
        tax_amount: p.tax_amount,
        document_url: row.documentUrl,
        document_name: row.file.name,
        line_items: p.line_items,
        service_address: p.service_address,
        allow_duplicate: row.allowDuplicate || false,
      },
    });
    if (error) {
      updateRow(row.id, { status: "error", message: error.message });
      return false;
    }
    if (data?.duplicate) {
      updateRow(row.id, { status: "duplicate", message: data.duplicate_reason });
      return false;
    }
    updateRow(row.id, { status: "saved" });
    return true;
  };

  const submitAll = async () => {
    setSubmittingAll(true);
    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      if (r.status === "ready" && r.selectedJobId) {
        const success = await submitRow(r);
        success ? ok++ : fail++;
      }
    }
    setSubmittingAll(false);
    toast.success(`${ok} invoice${ok === 1 ? "" : "s"} saved${fail ? `, ${fail} need attention` : ""}`);
    if (ok > 0) onComplete?.();
  };

  const readyCount = useMemo(() => rows.filter((r) => r.status === "ready" && r.selectedJobId).length, [rows]);

  const statusBadge = (r: Row) => {
    switch (r.status) {
      case "uploading":
      case "parsing":
      case "matching":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {r.status}
          </Badge>
        );
      case "ready":
        return r.selectedJobId ? (
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">Ready</Badge>
        ) : (
          <Badge variant="outline">Needs job</Badge>
        );
      case "saving":
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving</Badge>;
      case "saved":
        return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Saved</Badge>;
      case "duplicate":
        return <Badge className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Duplicate</Badge>;
      case "error":
        return <Badge variant="destructive">{r.message || "Error"}</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Invoice Import</DialogTitle>
          <DialogDescription>
            Upload up to {MAX_FILES} invoices at once. We&apos;ll extract job number, address & homeowner, then match each invoice to a job in your pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="border-2 border-dashed rounded-lg p-6 text-center">
          <input
            id="bulk-invoice-files"
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <label htmlFor="bulk-invoice-files" className="cursor-pointer flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">Drop PDFs or images here, or click to choose ({rows.length}/{MAX_FILES})</div>
            <div className="text-xs text-muted-foreground">Each file is parsed and matched in parallel.</div>
          </label>
        </div>

        {rows.length > 0 && (
          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[180px]">File</TableHead>
                  <TableHead className="w-[140px]">Vendor / #</TableHead>
                  <TableHead className="w-[100px] text-right">Amount</TableHead>
                  <TableHead className="w-[180px]">Extracted job info</TableHead>
                  <TableHead>Assign to job</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[160px]" title={r.file.name}>{r.file.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.parsed?.vendor_name || "—"}</div>
                      <div className="text-muted-foreground">{r.parsed?.invoice_number || ""}</div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {r.parsed?.total_amount != null ? `$${Number(r.parsed.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.parsed ? (
                        <div className="space-y-0.5">
                          {r.parsed.job_number && <div><span className="text-muted-foreground">Job:</span> {r.parsed.job_number}</div>}
                          {r.parsed.customer_name && <div><span className="text-muted-foreground">Name:</span> {r.parsed.customer_name}</div>}
                          {r.parsed.service_address && <div className="truncate max-w-[170px]" title={r.parsed.service_address}><span className="text-muted-foreground">Addr:</span> {r.parsed.service_address}</div>}
                          {!r.parsed.job_number && !r.parsed.customer_name && !r.parsed.service_address && <span className="text-muted-foreground">No job context found</span>}
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {r.candidates.length > 0 ? (
                        <Select value={r.selectedJobId} onValueChange={(v) => updateRow(r.id, { selectedJobId: v })}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Choose job…" />
                          </SelectTrigger>
                          <SelectContent>
                            {r.candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id} className="text-xs">
                                <div className="flex flex-col">
                                  <span>{c.label}</span>
                                  <span className="text-[10px] text-muted-foreground">{c.reason} · score {c.score}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : r.status === "ready" || r.status === "duplicate" || r.status === "error" ? (
                        <ManualJobPicker
                          tenantId={tenantId}
                          onSelect={(c) => updateRow(r.id, { candidates: [c, ...r.candidates], selectedJobId: c.id })}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">…</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {statusBadge(r)}
                        {r.status === "duplicate" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => { updateRow(r.id, { allowDuplicate: true, status: "ready" }); }}
                          >
                            Save anyway
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-sm text-muted-foreground">
            {rows.length} file{rows.length === 1 ? "" : "s"} · {readyCount} ready to save
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button disabled={readyCount === 0 || submittingAll || processing} onClick={submitAll}>
              {submittingAll ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : `Save ${readyCount} invoice${readyCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManualJobPicker({ tenantId, onSelect }: { tenantId: string | null; onSelect: (c: JobCandidate) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<JobCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async (term: string) => {
    if (!tenantId || term.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = term.trim();
    const { data } = await supabase
      .from("pipeline_entries")
      .select("id, clj_formatted_number, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, company_name, address_street, address_city, address_state, address_zip)")
      .eq("tenant_id", tenantId)
      .eq("is_deleted", false)
      .or(`clj_formatted_number.ilike.%${t}%`)
      .limit(20);
    const mapped: JobCandidate[] = (data || []).map((e: any) => {
      const c = e.contacts || {};
      const addr = [c.address_street, c.address_city, c.address_state, c.address_zip].filter(Boolean).join(", ");
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "";
      return {
        id: e.id,
        label: `${name || "—"} · ${addr || "no address"}${e.clj_formatted_number ? ` · #${e.clj_formatted_number}` : ""}`,
        address: addr || null,
        clj: e.clj_formatted_number || null,
        contact_name: name || null,
        score: 0,
        reason: "manual",
      };
    });
    setResults(mapped);
    setSearching(false);
  };

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
        <Input
          className="h-7 pl-7 text-xs"
          placeholder="Search job # or name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
        />
      </div>
      {searching && <div className="text-[10px] text-muted-foreground">Searching…</div>}
      {results.length > 0 && (
        <div className="border rounded max-h-40 overflow-auto bg-popover">
          {results.map((r) => (
            <button
              key={r.id}
              className="w-full text-left text-xs px-2 py-1 hover:bg-accent"
              onClick={() => { onSelect(r); setResults([]); setQ(""); }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
