import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertCircle, CheckCircle2, RefreshCw, AlertTriangle, Settings2, BookOpen,
} from "lucide-react";

import { Link } from "react-router-dom";



interface Props {
  projectId: string;
}

type Snapshot = {
  id: string;
  primary_trade_name_snapshot: string | null;
  primary_project_type_name_snapshot: string | null;
  primary_job_type_name_snapshot: string | null;
  classification_source: string;
  original_contract_value_cents: number;
  approved_change_orders_cents: number;
  approved_supplements_cents: number;
  current_contract_value_cents: number;
  invoiced_total_cents: number;
  paid_total_cents: number;
  outstanding_invoice_balance_cents: number;
  uninvoiced_contract_balance_cents: number;
  accounting_variance_cents: number;
  accounting_readiness: string;
  created_at: string;
};

type Scope = {
  id: string;
  trade_name_snapshot: string | null;
  is_primary: boolean;
  original_contract_amount_cents: number;
  current_contract_amount_cents: number;
  status: string;
  classification_review_required: boolean | null;
  classification_review_reason: string | null;
};

type Resolution = {
  id: string;
  project_scope_id: string;
  resolution_status: string;
  resolution_reason: string | null;
  mapping_id: string | null;
  qbo_connection_id: string | null;
  updated_at: string;
};

const fmt = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

const readinessLabel: Record<
  string,
  { label: string; tone: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending_classification: { label: "Pending Classification", tone: "secondary" },
  needs_mapping: { label: "Needs QBO Mapping", tone: "outline" },
  qbo_not_connected: { label: "QBO Not Connected", tone: "destructive" },
  qbo_sync_pending: { label: "Ready to Sync", tone: "default" },
  qbo_sync_queued: { label: "Queued for QuickBooks", tone: "secondary" },
  qbo_sync_in_progress: { label: "Creating in QuickBooks", tone: "secondary" },
  qbo_sync_error: { label: "QBO Sync Error", tone: "destructive" },
  qbo_duplicate_review_required: { label: "Duplicate in QuickBooks", tone: "destructive" },
  ready: { label: "Ready", tone: "default" },
};


const resolutionLabel: Record<
  string,
  { label: string; tone: "default" | "secondary" | "destructive" | "outline" }
> = {
  resolved: { label: "Mapped", tone: "default" },
  unresolved: { label: "No Mapping", tone: "outline" },
  stale: { label: "Stale", tone: "secondary" },
  invalid: { label: "Invalid", tone: "destructive" },
  classification_review_required: { label: "Needs Classification", tone: "secondary" },
  connection_missing: { label: "No QBO Connection", tone: "destructive" },
};

export default function ProjectAccountingPanel({ projectId }: Props) {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["project-accounting-snapshot", projectId],
    queryFn: async () => {
      const { data: snap } = await supabase
        .from("project_accounting_snapshots")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle();
      const { data: scopes } = await supabase
        .from("project_scopes")
        .select("*")
        .eq("project_id", projectId)
        .order("is_primary", { ascending: false });
      const { data: resolutions } = await supabase
        .from("project_scope_accounting_resolutions")
        .select("*")
        .eq("project_id", projectId);
      return {
        snapshot: snap as Snapshot | null,
        scopes: (scopes ?? []) as Scope[],
        resolutions: (resolutions ?? []) as Resolution[],
      };
    },
  });

  const initMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "initialize-project-accounting",
        { body: { project_id: projectId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Project accounting initialized");
      qc.invalidateQueries({ queryKey: ["project-accounting-snapshot", projectId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to initialize"),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "resolve-project-accounting",
        { body: { project_id: projectId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      const readiness = res?.data?.new_readiness ?? "unknown";
      toast.success(`Mapping refreshed — status: ${readiness.replaceAll("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["project-accounting-snapshot", projectId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to refresh mapping"),
  });

  const { data: qboMapping, refetch: refetchMapping } = useQuery({
    queryKey: ["project-qbo-mapping", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_qbo_mappings")
        .select("id, qbo_connection_id, qbo_customer_id, qbo_display_name, sync_status, last_error, last_synced_at, last_verified_at, is_active")
        .eq("pitch_project_id", projectId)
        .eq("is_active", true)
        .maybeSingle();
      return data as {
        id: string;
        qbo_connection_id: string;
        qbo_customer_id: string | null;
        qbo_display_name: string | null;
        sync_status: string;
        last_error: string | null;
        last_synced_at: string | null;
        last_verified_at: string | null;
        is_active: boolean;
      } | null;
    },
  });

  const syncMut = useMutation({
    mutationFn: async (trigger: "auto" | "manual") => {
      const { data, error } = await supabase.functions.invoke("qbo-project-sync", {
        body: { project_id: projectId, trigger },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any, trigger) => {
      if (res?.ok) {
        if (trigger === "manual") {
          toast.success(`QuickBooks customer ready: ${res?.data?.qbo_display_name ?? "created"}`);
        }
      } else {
        toast.error(res?.error ?? "QuickBooks sync failed");
      }
      qc.invalidateQueries({ queryKey: ["project-accounting-snapshot", projectId] });
      refetchMapping();
    },
    onError: (e: any) => toast.error(e?.message ?? "QuickBooks sync failed"),
  });

  // Auto-trigger: once mappings resolve to qbo_sync_pending, kick off the customer
  // creation exactly once per mount.
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    const readiness = data?.snapshot?.accounting_readiness;
    if (readiness === "qbo_sync_pending" && !syncMut.isPending) {
      autoTriggeredRef.current = true;
      syncMut.mutate("auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.snapshot?.accounting_readiness]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>QuickBooks Mapping</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-16 w-full" /></CardContent>
      </Card>
    );
  }

  const snap = data?.snapshot;
  const scopes = data?.scopes ?? [];
  const resolutions = data?.resolutions ?? [];
  const resByScope = new Map(resolutions.map((r) => [r.project_scope_id, r]));

  if (!snap) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4 text-amber-500" /> QuickBooks Mapping
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            This project isn't mapped to QuickBooks yet.
          </p>
          <Button size="sm" onClick={() => initMut.mutate()} disabled={initMut.isPending}>
            {initMut.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Set Up Mapping
          </Button>
        </CardContent>
      </Card>
    );
  }

  const r =
    readinessLabel[snap.accounting_readiness] ?? {
      label: snap.accounting_readiness,
      tone: "secondary" as const,
    };

  const anyReviewNeeded = scopes.some((s) => s.classification_review_required);
  const unmappedScopes = scopes.filter((s) => {
    const res = resByScope.get(s.id);
    return !res || res.resolution_status !== "resolved";
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {qboMapping?.qbo_customer_id ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" />
          )}
          QuickBooks Mapping
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={r.tone}>{r.label}</Badge>
          <Button asChild size="sm" variant="ghost">
            <Link to="/settings/quickbooks/mappings">
              <Settings2 className="h-4 w-4 mr-1" /> Mappings
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolveMut.mutate()}
            disabled={resolveMut.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${resolveMut.isPending ? "animate-spin" : ""}`} />
            Verify
          </Button>
          {(snap.accounting_readiness === "qbo_sync_pending" ||
            snap.accounting_readiness === "qbo_sync_error" ||
            snap.accounting_readiness === "qbo_duplicate_review_required" ||
            (snap.accounting_readiness === "ready" && !qboMapping?.qbo_customer_id)) && (
            <Button size="sm" onClick={() => syncMut.mutate("manual")} disabled={syncMut.isPending}>
              {syncMut.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4 mr-1" />
              )}
              {snap.accounting_readiness === "qbo_sync_error" ||
              snap.accounting_readiness === "qbo_duplicate_review_required"
                ? "Retry Sync"
                : "Create in QuickBooks"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded-md border p-2 text-xs flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">QuickBooks Customer</span>
            {qboMapping?.qbo_customer_id ? (
              <>
                <Badge variant="default" className="text-[10px]">
                  {qboMapping.sync_status === "ready" ? "Linked" : qboMapping.sync_status}
                </Badge>
                <span className="truncate text-muted-foreground">
                  {qboMapping.qbo_display_name} · ID {qboMapping.qbo_customer_id}
                </span>
              </>
            ) : qboMapping ? (
              <Badge variant="outline" className="text-[10px]">{qboMapping.sync_status}</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Not created</Badge>
            )}
          </div>
          {qboMapping?.last_error && (
            <span className="text-destructive text-[11px] truncate max-w-full">
              {qboMapping.last_error}
            </span>
          )}
        </div>

        {anyReviewNeeded && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>A scope needs its trade/job type confirmed before QuickBooks mapping can complete.</span>
          </div>
        )}

        {unmappedScopes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Unmapped scopes:{" "}
            {unmappedScopes.map((s) => s.trade_name_snapshot ?? s.id.slice(0, 8)).join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
