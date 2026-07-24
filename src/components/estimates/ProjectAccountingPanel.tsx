import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

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
};

const fmt = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

const readinessLabel: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_classification: { label: "Pending Classification", tone: "secondary" },
  needs_mapping: { label: "Needs QBO Mapping", tone: "outline" },
  qbo_not_connected: { label: "QBO Not Connected", tone: "destructive" },
  qbo_sync_pending: { label: "QBO Sync Pending", tone: "secondary" },
  qbo_sync_error: { label: "QBO Sync Error", tone: "destructive" },
  ready: { label: "Ready", tone: "default" },
};

export default function ProjectAccountingPanel({ projectId }: Props) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
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
      return { snapshot: snap as Snapshot | null, scopes: (scopes ?? []) as Scope[] };
    },
  });

  const initMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("initialize-project-accounting", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Project accounting initialized");
      qc.invalidateQueries({ queryKey: ["project-accounting-snapshot", projectId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to initialize"),
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
            No accounting snapshot exists for this project yet. Initialize one to lock in the
            original contract value, trade classification, and downstream QuickBooks mapping.
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

  const r = readinessLabel[snap.accounting_readiness] ?? {
    label: snap.accounting_readiness,
    tone: "secondary" as const,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          {snap.accounting_readiness === "ready"
            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
            : <AlertCircle className="h-4 w-4 text-amber-500" />}
          Project Accounting
        </CardTitle>
        <Badge variant={r.tone}>{r.label}</Badge>
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

        <div className="border-t pt-3">
          <div className="text-xs uppercase text-muted-foreground mb-2">Scopes</div>
          <div className="space-y-1.5">
            {scopes.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {s.is_primary && <Badge variant="outline" className="text-[10px]">Primary</Badge>}
                  <span>{s.trade_name_snapshot ?? s.id.slice(0, 8)}</span>
                  <Badge variant="secondary" className="text-[10px]">{s.status}</Badge>
                </div>
                <span className="tabular-nums">{fmt(s.current_contract_amount_cents)}</span>
              </div>
            ))}
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
