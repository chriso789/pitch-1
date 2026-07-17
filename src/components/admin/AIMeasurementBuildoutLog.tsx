import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, Loader2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Buildout log for the AI Measurement pipeline.
 *
 * Two panels:
 *   1. Live pipeline health — recent ai_measurement_jobs rows aggregated
 *      by result_state so the team can see, at a glance, whether the
 *      last N runs are landing in customer_report_ready or in one of
 *      the ai_failed_* buckets.
 *   2. Build log — an append-only, dated changelog of AI/Lovable
 *      changes to the measurement pipeline. Every material change
 *      should add a new entry at the TOP of BUILDOUT_ENTRIES so the
 *      most recent work is always visible first. Entries are frozen
 *      once shipped — never rewrite history.
 */

type BuildoutStatus = "shipped" | "in_progress" | "planned" | "reverted";

interface BuildoutEntry {
  date: string;            // ISO date YYYY-MM-DD
  version?: string;        // optional tag (e.g. "v19", "PR #4")
  area: string;            // e.g. "Topology solver", "Perimeter", "Report UI"
  status: BuildoutStatus;
  summary: string;         // one-line what changed
  detail?: string;         // optional multi-line context
}

// APPEND NEW ENTRIES AT THE TOP. Do not edit older entries.
const BUILDOUT_ENTRIES: BuildoutEntry[] = [
  {
    date: "2026-07-17",
    area: "Admin surfaces",
    status: "shipped",
    summary: "AI Measurement testing area + buildout log moved into the /admin/companies → AI Measurement tab.",
    detail:
      "Live MeasurementTestPanel now runs from the admin tab instead of the settings > roof-training screen. A dated build log tracks every subsequent Lovable change until the pipeline reaches customer-report parity.",
  },
  {
    date: "2026-07-17",
    version: "PR #4",
    area: "Evidence acquisition",
    status: "shipped",
    summary: "Vendor-free evidence cascade with per-layer source_tier logging (OSM → MS Footprints → Parcel → Solar/UNet).",
  },
  {
    date: "2026-07-16",
    version: "v19",
    area: "Topology solver",
    status: "shipped",
    summary: "Constraint roof solver v19 — reverse-solves from Solar priors when the autonomous score < 0.60.",
  },
  {
    date: "2026-07-15",
    version: "v18",
    area: "Topology",
    status: "shipped",
    summary: "Backbone-first topology v18 — ridge/valley chains → local assemblies → derived hips; cross-roof diagonals suppressed.",
  },
  {
    date: "2026-07-14",
    area: "Report UI",
    status: "shipped",
    summary: "Perimeter debug overlay renders in place of blank reports on any hard_fail_reason.",
  },
  {
    date: "2026-07-13",
    area: "Contracts",
    status: "shipped",
    summary: "Six architectural contracts enforced by dsm-geometry-contract.ts (footprint, coord space, area conservation, overlay registration, publication gate, debug metrics).",
  },
  {
    date: "2026-07-12",
    area: "State machine",
    status: "shipped",
    summary: "result_state normalizer + assertCustomerReportReady() guard — no direct writes outside the 10 canonical buckets.",
  },
  {
    date: "2026-07-17",
    area: "Topology fidelity",
    status: "in_progress",
    summary: "Closing the Fonsica topology fidelity gap — target 14 facets, ridge/valley LF within 25% of Roofr.",
  },
  {
    date: "2026-07-17",
    area: "Report parity",
    status: "in_progress",
    summary: "PDF diagram parity — aerial-first overlay export matching the on-screen debug overlay.",
  },
  {
    date: "2026-07-17",
    area: "Rollout",
    status: "planned",
    summary: "Per-tenant enablement wiring off the `measurements` feature flag once vendor benchmark gate is green on all three baselines.",
  },
];

const STATUS_STYLE: Record<BuildoutStatus, { label: string; className: string }> = {
  shipped: { label: "Shipped", className: "bg-emerald-600 text-white hover:bg-emerald-600" },
  in_progress: { label: "In progress", className: "bg-amber-500 text-white hover:bg-amber-500" },
  planned: { label: "Planned", className: "bg-slate-500 text-white hover:bg-slate-500" },
  reverted: { label: "Reverted", className: "bg-rose-600 text-white hover:bg-rose-600" },
};

interface HealthRow { result_state: string | null; hard_fail_reason: string | null; created_at: string; }

function stateStyle(state: string | null): string {
  if (!state) return "bg-muted text-muted-foreground";
  if (state === "customer_report_ready") return "bg-emerald-600 text-white";
  if (state === "perimeter_only" || state === "diagnostic_only") return "bg-amber-500 text-white";
  if (state.startsWith("ai_failed_")) return "bg-rose-600 text-white";
  return "bg-muted text-muted-foreground";
}

export function AIMeasurementBuildoutLog() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("ai_measurement_jobs")
        .select("result_state, hard_fail_reason, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data || []) as HealthRow[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load pipeline health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Bucket the last 50 runs
  const stateCounts = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.result_state || "(unset)";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const failReasons = rows
    .filter(r => r.hard_fail_reason)
    .slice(0, 8)
    .map(r => ({ reason: r.hard_fail_reason!, when: r.created_at }));
  const readyCount = stateCounts["customer_report_ready"] || 0;
  const total = rows.length;
  const readyPct = total ? Math.round((readyCount / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Live pipeline health</CardTitle>
            <CardDescription>
              Last {total || "—"} ai_measurement_jobs runs, bucketed by <code>result_state</code>. Refreshes on demand.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="font-medium">
              {readyCount} / {total} runs reached <code>customer_report_ready</code>
            </span>
            <Badge variant="outline">{readyPct}%</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stateCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <Badge key={k} className={stateStyle(k)}>
                  {k} · {v}
                </Badge>
              ))}
            {!total && !loading && !error && (
              <span className="text-sm text-muted-foreground">No runs recorded yet — kick one off from the testing area above.</span>
            )}
          </div>
          {failReasons.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-1">Recent hard_fail_reasons</div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {failReasons.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Clock className="h-3 w-3 mt-0.5 flex-none" />
                    <code className="break-all">{f.reason}</code>
                    <span className="text-[10px] opacity-70">{new Date(f.when).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buildout log</CardTitle>
          <CardDescription>
            Append-only record of every Lovable change to the AI Measurement pipeline until the system reaches production-ready
            parity. Newest entries first. Old entries are never rewritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-3">
            {BUILDOUT_ENTRIES.map((entry, idx) => {
              const s = STATUS_STYLE[entry.status];
              return (
                <li key={idx} className="border-l-2 border-border pl-3 py-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{entry.date}</span>
                    {entry.version && <Badge variant="outline" className="text-[10px]">{entry.version}</Badge>}
                    <Badge className={s.className}>{s.label}</Badge>
                    <span className="font-medium">{entry.area}</span>
                  </div>
                  <div className="text-sm mt-1">{entry.summary}</div>
                  {entry.detail && (
                    <div className="text-xs text-muted-foreground mt-1">{entry.detail}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
