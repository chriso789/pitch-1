import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertTriangle, Plus, ShieldCheck, Loader2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

type Mapping = {
  id: string;
  qbo_connection_id: string;
  trade_id: string;
  project_type_id: string;
  job_type_id: string | null;
  qbo_item_id: string;
  qbo_item_name_snapshot: string | null;
  qbo_item_type_snapshot: string | null;
  qbo_income_account_name_snapshot: string | null;
  qbo_class_id: string | null;
  qbo_class_name_snapshot: string | null;
  qbo_department_id: string | null;
  qbo_department_name_snapshot: string | null;
  qbo_tax_code_id: string | null;
  qbo_tax_code_name_snapshot: string | null;
  qbo_terms_id: string | null;
  qbo_terms_name_snapshot: string | null;
  validation_status: string;
  validation_error: string | null;
  last_validated_at: string | null;
  active: boolean;
};

type CacheRow = { qbo_id: string; name: string | null; fully_qualified_name?: string | null; item_type?: string | null; active: boolean; income_account_name?: string | null };
type SyncState = { entity_kind: string; refresh_status: string; last_successful_refresh_at: string | null; last_refresh_error: string | null; rows_fetched: number };
type Capabilities = {
  class_tracking_enabled: boolean | null;
  location_tracking_enabled: boolean | null;
  sales_tax_enabled: boolean | null;
  terms_available: boolean | null;
};

const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "valid") return "default";
  if (s === "unvalidated") return "outline";
  if (s === "stale") return "secondary";
  return "destructive";
};

function EditorDialog({
  open, onOpenChange, connectionId, capabilities, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string | null;
  capabilities: Capabilities | null;
  initial: Partial<Mapping> | null;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState<Record<string, string>>({});
  React.useEffect(() => {
    setForm({
      trade_id: initial?.trade_id ?? "",
      project_type_id: initial?.project_type_id ?? "",
      job_type_id: initial?.job_type_id ?? "",
      qbo_item_id: initial?.qbo_item_id ?? "",
      qbo_class_id: initial?.qbo_class_id ?? "",
      qbo_department_id: initial?.qbo_department_id ?? "",
      qbo_tax_code_id: initial?.qbo_tax_code_id ?? "",
      qbo_terms_id: initial?.qbo_terms_id ?? "",
    });
  }, [initial, open]);

  const items = useQuery({
    enabled: open && !!connectionId,
    queryKey: ["qbo-items", connectionId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_item_cache")
        .select("qbo_id,name,fully_qualified_name,item_type,active,income_account_name")
        .eq("qbo_connection_id", connectionId!).eq("active", true).order("name");
      return (data ?? []) as CacheRow[];
    },
  });
  const classes = useQuery({
    enabled: open && !!connectionId && !!capabilities?.class_tracking_enabled,
    queryKey: ["qbo-classes", connectionId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_class_cache").select("qbo_id,name,active")
        .eq("qbo_connection_id", connectionId!).eq("active", true).order("name");
      return (data ?? []) as CacheRow[];
    },
  });
  const depts = useQuery({
    enabled: open && !!connectionId && !!capabilities?.location_tracking_enabled,
    queryKey: ["qbo-depts", connectionId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_department_cache").select("qbo_id,name,active")
        .eq("qbo_connection_id", connectionId!).eq("active", true).order("name");
      return (data ?? []) as CacheRow[];
    },
  });
  const taxCodes = useQuery({
    enabled: open && !!connectionId && !!capabilities?.sales_tax_enabled,
    queryKey: ["qbo-taxcodes", connectionId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_tax_code_cache").select("qbo_id,name,active")
        .eq("qbo_connection_id", connectionId!).eq("active", true).order("name");
      return (data ?? []) as CacheRow[];
    },
  });
  const terms = useQuery({
    enabled: open && !!connectionId,
    queryKey: ["qbo-terms", connectionId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_terms_cache").select("qbo_id,name,active")
        .eq("qbo_connection_id", connectionId!).eq("active", true).order("name");
      return (data ?? []) as CacheRow[];
    },
  });

  const selectedItem = items.data?.find((i) => i.qbo_id === form.qbo_item_id) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      if (!connectionId) throw new Error("No connection");
      const body: any = {
        action: isEdit ? "update" : "create",
        mapping_id: initial?.id,
        mapping: {
          qbo_connection_id: connectionId,
          trade_id: form.trade_id.trim(),
          project_type_id: form.project_type_id.trim(),
          job_type_id: form.job_type_id.trim() || null,
          qbo_item_id: form.qbo_item_id,
          qbo_class_id: form.qbo_class_id || null,
          qbo_department_id: form.qbo_department_id || null,
          qbo_tax_code_id: form.qbo_tax_code_id || null,
          qbo_terms_id: form.qbo_terms_id || null,
        },
      };
      const { data, error } = await supabase.functions.invoke("qbo-mapping-write", { body });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed");
      return data.data;
    },
    onSuccess: (data) => {
      const s = data?.validation?.validation_status ?? "unvalidated";
      toast.success(`Mapping saved — status: ${s.replaceAll("_", " ")}`);
      onOpenChange(false);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Mapping" : "Create Mapping"}</DialogTitle>
          <DialogDescription>
            New mappings start as <strong>unvalidated</strong>; the server validates against the live QuickBooks catalog on save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Trade</Label>
            <Input value={form.trade_id ?? ""} onChange={(e) => setForm({ ...form, trade_id: e.target.value })} placeholder="e.g. roofing" />
          </div>
          <div>
            <Label>Project Type</Label>
            <Input value={form.project_type_id ?? ""} onChange={(e) => setForm({ ...form, project_type_id: e.target.value })} placeholder="e.g. replacement" />
          </div>
          <div>
            <Label>Job Type (optional)</Label>
            <Input value={form.job_type_id ?? ""} onChange={(e) => setForm({ ...form, job_type_id: e.target.value })} placeholder="blank = matches all job types" />
          </div>
          <div>
            <Label>QuickBooks Item *</Label>
            <Select value={form.qbo_item_id} onValueChange={(v) => setForm({ ...form, qbo_item_id: v })}>
              <SelectTrigger><SelectValue placeholder="Choose an item" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {items.data?.map((i) => (
                  <SelectItem key={i.qbo_id} value={i.qbo_id}>
                    {i.fully_qualified_name ?? i.name} {i.item_type ? `(${i.item_type})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedItem && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Income account: <span className="font-mono">{selectedItem.income_account_name ?? "—"}</span> (read-only)
              </div>
            )}
          </div>
          {capabilities?.class_tracking_enabled && (
            <div>
              <Label>Class</Label>
              <Select value={form.qbo_class_id} onValueChange={(v) => setForm({ ...form, qbo_class_id: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {classes.data?.map((c) => <SelectItem key={c.qbo_id} value={c.qbo_id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {capabilities?.location_tracking_enabled && (
            <div>
              <Label>Department / Location</Label>
              <Select value={form.qbo_department_id} onValueChange={(v) => setForm({ ...form, qbo_department_id: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {depts.data?.map((c) => <SelectItem key={c.qbo_id} value={c.qbo_id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {capabilities?.sales_tax_enabled && (
            <div>
              <Label>Tax Code</Label>
              <Select value={form.qbo_tax_code_id} onValueChange={(v) => setForm({ ...form, qbo_tax_code_id: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {taxCodes.data?.map((c) => <SelectItem key={c.qbo_id} value={c.qbo_id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Terms</Label>
            <Select value={form.qbo_terms_id} onValueChange={(v) => setForm({ ...form, qbo_terms_id: v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {terms.data?.map((c) => <SelectItem key={c.qbo_id} value={c.qbo_id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.trade_id || !form.project_type_id || !form.qbo_item_id || save.isPending}
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QuickBooksMappingsPage() {
  const tenantId = useEffectiveTenantId();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState<Partial<Mapping> | null>(null);

  const conn = useQuery({
    enabled: !!tenantId,
    queryKey: ["qbo-connection", tenantId],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_connections")
        .select("id, realm_id, qbo_company_name, oauth_app_env, is_active, last_synced_at")
        .eq("tenant_id", tenantId!).eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const caps = useQuery({
    enabled: !!conn.data?.id,
    queryKey: ["qbo-caps", conn.data?.id],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_company_capabilities")
        .select("class_tracking_enabled, location_tracking_enabled, sales_tax_enabled, terms_available")
        .eq("qbo_connection_id", conn.data!.id).maybeSingle();
      return data as Capabilities | null;
    },
  });

  const syncStates = useQuery({
    enabled: !!conn.data?.id,
    queryKey: ["qbo-sync-state", conn.data?.id],
    queryFn: async () => {
      const { data } = await supabase.from("qbo_catalog_sync_state")
        .select("entity_kind, refresh_status, last_successful_refresh_at, last_refresh_error, rows_fetched")
        .eq("qbo_connection_id", conn.data!.id);
      return (data ?? []) as SyncState[];
    },
  });

  const mappings = useQuery({
    enabled: !!conn.data?.id,
    queryKey: ["qbo-mappings", conn.data?.id],
    queryFn: async () => {
      const { data } = await supabase.from("project_scope_accounting_mappings")
        .select("*").eq("qbo_connection_id", conn.data!.id).order("trade_id");
      return (data ?? []) as Mapping[];
    },
  });

  React.useEffect(() => {
    // Prefill editor from ProjectAccountingPanel deep link
    if (params.get("create") === "1" && conn.data?.id && !editorOpen) {
      setEditorInitial({
        trade_id: params.get("trade_id") ?? "",
        project_type_id: params.get("project_type_id") ?? "",
        job_type_id: params.get("job_type_id") ?? "",
      });
      setEditorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, conn.data?.id]);

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("qbo-catalog-refresh", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Refresh failed");
      return data.data;
    },
    onSuccess: (d) => {
      toast.success(`Catalog refreshed — ${d?.mappings_validated ?? 0} mappings validated, ${d?.projects_reresolved ?? 0} projects re-resolved`);
      qc.invalidateQueries({ queryKey: ["qbo-sync-state"] });
      qc.invalidateQueries({ queryKey: ["qbo-mappings"] });
      qc.invalidateQueries({ queryKey: ["qbo-caps"] });
      qc.invalidateQueries({ queryKey: ["qbo-items"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Refresh failed"),
  });

  const validateAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("qbo-mapping-write", {
        body: { action: "validate_all", qbo_connection_id: conn.data!.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed");
      return data.data;
    },
    onSuccess: (d) => {
      const s = d?.summary ?? {};
      toast.success(`Validated: ${s.valid ?? 0} valid, ${s.invalid ?? 0} invalid — ${d?.projects_reresolved ?? 0} projects re-resolved`);
      qc.invalidateQueries({ queryKey: ["qbo-mappings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Validate failed"),
  });

  const toggleActive = useMutation({
    mutationFn: async (m: Mapping) => {
      const { data, error } = await supabase.functions.invoke("qbo-mapping-write", {
        body: { action: m.active ? "disable" : "enable", mapping_id: m.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qbo-mappings"] }),
  });

  const validateOne = useMutation({
    mutationFn: async (m: Mapping) => {
      const { data, error } = await supabase.functions.invoke("qbo-mapping-write", {
        body: { action: "validate", mapping_id: m.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qbo-mappings"] }),
  });

  const latestSuccess = useMemo(() => {
    const ts = (syncStates.data ?? []).map((s) => s.last_successful_refresh_at).filter(Boolean) as string[];
    return ts.length ? new Date(ts.sort().at(-1)!).toLocaleString() : "Never synced";
  }, [syncStates.data]);

  return (
    <GlobalLayout>
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> QuickBooks Accounting Mappings
              </CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                {conn.data ? (
                  <>
                    <span className="font-medium">{conn.data.qbo_company_name ?? "QuickBooks Company"}</span>
                    <Badge variant="outline" className="ml-2">{conn.data.oauth_app_env ?? "production"}</Badge>
                    <span className="ml-2">Last refresh: {latestSuccess}</span>
                  </>
                ) : (
                  "No active QuickBooks connection."
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!conn.data?.id || refresh.isPending} onClick={() => refresh.mutate()}>
                {refresh.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh Catalog
              </Button>
              <Button size="sm" variant="outline" disabled={!conn.data?.id || validateAll.isPending} onClick={() => validateAll.mutate()}>
                {validateAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Validate All
              </Button>
              <Button size="sm" disabled={!conn.data?.id} onClick={() => { setEditorInitial(null); setEditorOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Create Mapping
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1 mb-3">
              {(syncStates.data ?? []).map((s) => (
                <Badge
                  key={s.entity_kind}
                  variant={s.refresh_status === "current" ? "default" : s.refresh_status === "unsupported" ? "outline" : "destructive"}
                >
                  {s.entity_kind}: {s.refresh_status} ({s.rows_fetched})
                </Badge>
              ))}
              {(syncStates.data ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">Run Refresh Catalog to sync QuickBooks Items, Accounts, Classes, Departments, Tax Codes, and Terms.</span>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pitch Classification</TableHead>
                  <TableHead>QuickBooks Item</TableHead>
                  <TableHead>Income Account</TableHead>
                  <TableHead>Class / Dept</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mappings.data ?? []).map((m) => (
                  <TableRow key={m.id} className={m.active ? "" : "opacity-50"}>
                    <TableCell>
                      <div className="font-medium">{m.trade_id} / {m.project_type_id}</div>
                      <div className="text-[11px] text-muted-foreground">Job: {m.job_type_id ?? "any"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{m.qbo_item_name_snapshot ?? m.qbo_item_id}</div>
                      {m.qbo_item_type_snapshot && <div className="text-[11px] text-muted-foreground">{m.qbo_item_type_snapshot}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{m.qbo_income_account_name_snapshot ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {m.qbo_class_name_snapshot ?? "—"} / {m.qbo_department_name_snapshot ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusTone(m.validation_status)}>{m.validation_status}</Badge>
                      {m.validation_error && (
                        <div className="text-[11px] text-destructive mt-1 flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>{m.validation_error}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditorInitial(m); setEditorOpen(true); }}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => validateOne.mutate(m)}>Validate</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(m)}>{m.active ? "Disable" : "Enable"}</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(mappings.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground text-center py-6">
                      No mappings yet. Refresh the catalog, then create a mapping for each Trade / Project Type your projects use.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <EditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          connectionId={conn.data?.id ?? null}
          capabilities={caps.data ?? null}
          initial={editorInitial}
          onSaved={() => qc.invalidateQueries({ queryKey: ["qbo-mappings"] })}
        />
      </div>
    </GlobalLayout>
  );
}
