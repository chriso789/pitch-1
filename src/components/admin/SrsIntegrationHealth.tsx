// SRS Integration Health Dashboard
//
// Read-only diagnostics grid for the currently active tenant's SRS
// integration. Aggregates state from srs_connections, srs_orders,
// srs_submit_audit, srs_order_status_events, srs_webhook_events, and
// srs_audit_log to produce the 15-tile status view mandated by the
// SRS production hardening plan (Task 10). No writes; safe to render
// for any user with tenant read access.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useSrsConnectionStatus } from "@/hooks/useSrsConnectionStatus";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

type TileStatus = "ok" | "warn" | "error" | "pending" | "unknown";

interface HealthTile {
  key: string;
  label: string;
  status: TileStatus;
  value?: string;
  detail?: string;
}

interface Counts {
  branches: number;
  shipTos: number;
  catalogItems: number;
  orders: number;
  ordersWithRealId: number;
  queuedOnly: number;
  webhookEvents: number;
  statusEvents: number;
  lastSubmitOk: string | null;
  lastSubmitFail: string | null;
  lastWebhookAt: string | null;
  lastStatusAt: string | null;
  lastAuditError: string | null;
}

const emptyCounts: Counts = {
  branches: 0,
  shipTos: 0,
  catalogItems: 0,
  orders: 0,
  ordersWithRealId: 0,
  queuedOnly: 0,
  webhookEvents: 0,
  statusEvents: 0,
  lastSubmitOk: null,
  lastSubmitFail: null,
  lastWebhookAt: null,
  lastStatusAt: null,
  lastAuditError: null,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusIcon(s: TileStatus) {
  switch (s) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadge(s: TileStatus) {
  const label =
    s === "ok" ? "OK" : s === "warn" ? "Attention" : s === "error" ? "Error" : s === "pending" ? "Pending" : "Unknown";
  const variant =
    s === "ok" ? "default" : s === "error" ? "destructive" : s === "warn" ? "secondary" : "outline";
  return <Badge variant={variant as any}>{label}</Badge>;
}

export function SrsIntegrationHealth() {
  const tenantId = useEffectiveTenantId();
  const conn = useSrsConnectionStatus();
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!tenantId) {
      setCounts(emptyCounts);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const client: any = supabase;
      const [
        { count: catalogItems },
        { count: orders },
        { count: webhookEvents },
        { count: statusEvents },
        okSubmit,
        failSubmit,
        lastWebhook,
        lastStatus,
        lastAuditErr,
        realIdOrders,
        queuedOrders,
      ] = await Promise.all([
        client.from("srs_pricelist_items").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).then(
          (r: any) => r,
          () => ({ count: 0 }),
        ),
        client.from("srs_orders").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).then(
          (r: any) => r,
          () => ({ count: 0 }),
        ),
        client.from("srs_webhook_events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).then(
          (r: any) => r,
          () => ({ count: 0 }),
        ),
        client.from("srs_order_status_events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).then(
          (r: any) => r,
          () => ({ count: 0 }),
        ),
        client
          .from("srs_submit_audit")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .eq("success", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        client
          .from("srs_submit_audit")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .eq("success", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        client
          .from("srs_webhook_events")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        client
          .from("srs_order_status_events")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        client
          .from("srs_audit_log")
          .select("action, created_at, error_message")
          .eq("tenant_id", tenantId)
          .eq("success", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        client
          .from("srs_orders")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .not("srs_order_id", "is", null)
          .then((r: any) => r, () => ({ count: 0 })),
        client
          .from("srs_orders")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "queued")
          .then((r: any) => r, () => ({ count: 0 })),
      ]);

      setCounts({
        branches: conn.branchCount,
        shipTos: conn.shipToCount,
        catalogItems: catalogItems ?? 0,
        orders: orders ?? 0,
        ordersWithRealId: realIdOrders?.count ?? 0,
        queuedOnly: queuedOrders?.count ?? 0,
        webhookEvents: webhookEvents ?? 0,
        statusEvents: statusEvents ?? 0,
        lastSubmitOk: okSubmit?.data?.created_at ?? null,
        lastSubmitFail: failSubmit?.data?.created_at ?? null,
        lastWebhookAt: lastWebhook?.data?.created_at ?? null,
        lastStatusAt: lastStatus?.data?.created_at ?? null,
        lastAuditError: lastAuditErr?.data
          ? `${lastAuditErr.data.action}: ${lastAuditErr.data.error_message ?? "unknown"}`
          : null,
      });
    } catch (e) {
      console.warn("[SrsIntegrationHealth] load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, conn.branchCount, conn.shipToCount]);

  const tiles: HealthTile[] = useMemo(() => {
    const environment = conn.row?.environment ?? "unknown";
    const authOk: TileStatus = conn.isConnected ? "ok" : conn.hasCredentials ? "warn" : "error";
    const branchOk: TileStatus = counts.branches > 0 ? "ok" : conn.isConnected ? "warn" : "pending";
    const shipToOk: TileStatus = counts.shipTos > 0 ? "ok" : conn.isConnected ? "warn" : "pending";
    const jobAcctOk: TileStatus = conn.row?.job_account_number ? "ok" : "warn";
    const catalogOk: TileStatus = counts.catalogItems > 0 ? "ok" : "warn";
    const submitOk: TileStatus = counts.lastSubmitOk
      ? "ok"
      : counts.lastSubmitFail
      ? "error"
      : "pending";
    const queueOk: TileStatus = counts.queuedOnly === 0 ? "ok" : "warn";
    const orderIdOk: TileStatus = counts.ordersWithRealId > 0 ? "ok" : counts.orders > 0 ? "warn" : "pending";
    const webhookOk: TileStatus = counts.webhookEvents > 0 ? "ok" : "pending";
    const statusOk: TileStatus = counts.statusEvents > 0 ? "ok" : "pending";
    const errOk: TileStatus = counts.lastAuditError ? "warn" : "ok";

    return [
      { key: "auth", label: "Authentication", status: authOk, value: conn.state, detail: `env: ${environment}` },
      { key: "customer", label: "Customer", status: conn.row?.customer_code ? "ok" : "error", value: conn.row?.customer_code ?? "—", detail: conn.row?.customer_name ?? "" },
      { key: "branch", label: "Branch", status: branchOk, value: String(counts.branches), detail: conn.row?.default_branch_code ? `default ${conn.row.default_branch_code}` : "" },
      { key: "jobacct", label: "Job Account", status: jobAcctOk, value: conn.row?.job_account_number ? String(conn.row.job_account_number) : "—" },
      { key: "shipto", label: "Ship-To", status: shipToOk, value: String(counts.shipTos) },
      { key: "catalog", label: "Catalog", status: catalogOk, value: String(counts.catalogItems), detail: "priced items" },
      { key: "price", label: "Price API", status: "pending", value: "TBD", detail: "Pending SRS call — see §8.3" },
      { key: "submit", label: "Submit", status: submitOk, value: String(counts.orders), detail: `last ok ${fmtDate(counts.lastSubmitOk)}` },
      { key: "queue", label: "Queue", status: queueOk, value: String(counts.queuedOnly), detail: "queued (awaiting real orderID)" },
      { key: "orderid", label: "Order ID", status: orderIdOk, value: `${counts.ordersWithRealId}/${counts.orders}`, detail: "with real orderID" },
      { key: "webhook", label: "Webhook", status: webhookOk, value: String(counts.webhookEvents), detail: `last ${fmtDate(counts.lastWebhookAt)}` },
      { key: "delivery", label: "Delivery", status: statusOk, value: String(counts.statusEvents), detail: "status events received" },
      { key: "invoice", label: "Invoice", status: "pending", value: "—", detail: "wired via webhook events" },
      { key: "last-success", label: "Last Success", status: counts.lastSubmitOk ? "ok" : "pending", value: fmtDate(counts.lastSubmitOk) },
      { key: "last-error", label: "Last Error", status: errOk, value: counts.lastAuditError ? "see detail" : "none", detail: counts.lastAuditError ?? "" },
      { key: "env", label: "Environment", status: environment === "production" ? "ok" : environment === "sandbox" ? "warn" : "unknown", value: environment },
    ];
  }, [conn, counts]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">SRS integration health</CardTitle>
          <CardDescription>
            Live diagnostic tiles pulled from the active tenant's SRS state. All
            tiles are read-only. See <code>docs/srs-sips-integration-audit.md §8</code>
            for the verified contract.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void load(); void conn.refresh(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.key} className="rounded-md border p-3 bg-card">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(t.status)}
                  <span className="text-xs font-medium truncate">{t.label}</span>
                </div>
                {statusBadge(t.status)}
              </div>
              <div className="text-sm font-semibold truncate">{t.value ?? "—"}</div>
              {t.detail ? (
                <div className="text-xs text-muted-foreground truncate mt-0.5">{t.detail}</div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default SrsIntegrationHealth;
