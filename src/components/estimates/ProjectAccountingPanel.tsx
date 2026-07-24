import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, RefreshCw, AlertTriangle, Settings2 } from "lucide-react";
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
  qbo_sync_error: { label: "QBO Sync Error", tone: "destructive" },
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

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Project Accounting</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Project Accounting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No accounting snapshot exists for this project yet. Initialize one to lock
            in the original contract value, trade classification, and downstream
            QuickBooks mapping.
          </p>
          <Button
            size="sm"
            onClick={() => initMut.mutate()}
            disabled={initMut.isPending}
          >
            {initMut.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
            Initialize Accounting
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          {snap.accounting_readiness === "ready" ||
          snap.accounting_readiness === "qbo_sync_pending" ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" />
          )}
          Project Accounting
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
            {resolveMut.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Refresh Mapping
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Metric label="Original Contract" value={fmt(snap.original_contract_value_cents)} />
          <Metric label="Change Orders" value={fmt(snap.approved_change_orders_cents)} />
          <Metric label="Supplements" value={fmt(snap.approved_supplements_cents)} />
          <Metric label="Current Contract" value={fmt(snap.current_contract_value_cents)} strong />
          <Metric label="Invoiced" value={fmt(snap.invoiced_total_cents)} />
          <Metric label="Paid" value={fmt(snap.paid_total_cents)} />
          <Metric label="Outstanding AR" value={fmt(snap.outstanding_invoice_balance_cents)} />
          <Metric label="Uninvoiced Balance" value={fmt(snap.uninvoiced_contract_balance_cents)} />
        </div>

        {anyReviewNeeded && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              One or more scopes were classified by a Slice 1 fallback and need a human
              to confirm the trade, project type, and job type before QuickBooks mapping
              can complete.
            </span>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="text-xs uppercase text-muted-foreground mb-2">Scopes &amp; QBO Mapping</div>
          <div className="space-y-1.5">
            {scopes.map((s) => {
              const res = resByScope.get(s.id);
              const resInfo = res
                ? resolutionLabel[res.resolution_status] ?? {
                    label: res.resolution_status,
                    tone: "secondary" as const,
                  }
                : { label: "Not resolved yet", tone: "outline" as const };
              return (
                <div key={s.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {s.is_primary && (
                        <Badge variant="outline" className="text-[10px]">Primary</Badge>
                      )}
                      <span className="truncate">{s.trade_name_snapshot ?? s.id.slice(0, 8)}</span>
                      <Badge variant="secondary" className="text-[10px]">{s.status}</Badge>
                      <Badge variant={resInfo.tone} className="text-[10px]">{resInfo.label}</Badge>
                    </div>
                    <span className="tabular-nums">{fmt(s.current_contract_amount_cents)}</span>
                  </div>
                  {res?.resolution_reason && (
                    <div className="text-[11px] text-muted-foreground pl-2 mt-0.5">
                      {res.resolution_reason}
                    </div>
                  )}
                </div>
              );
            })}
            {scopes.length === 0 && (
              <div className="text-xs text-muted-foreground">No scopes recorded.</div>
            )}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>Classification: {snap.classification_source}</span>
          <span>Snapshot: {snap.id.slice(0, 8)}</span>
          <span>Created: {new Date(snap.created_at).toLocaleString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</div>
    </div>
  );
}
