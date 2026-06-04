import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, Lock, ShieldAlert, FileText } from "lucide-react";
import {
  fetchBlueprintImportSession,
  acceptBlueprintTrade,
  bindBlueprintTemplate,
  generateBlueprintMaterialDrafts,
  generateBlueprintLaborDrafts,
  fetchBlueprintDraftLines,
  type SessionSummary,
  type DraftLinesResult,
} from "@/integrations/blueprintImporterV2Api";

const TRADE_LABELS: Record<string, string> = {
  roofing: "Roofing",
  exterior_walls_siding: "Exterior Walls / Siding",
  paint_coatings: "Paint / Coatings",
  gutters_fascia_trim: "Gutters / Fascia / Trim",
  windows_doors: "Windows & Doors",
  drywall: "Drywall",
  framing: "Framing",
  insulation: "Insulation",
  flooring: "Flooring",
  concrete: "Concrete",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
};

export default function BlueprintImporterV2() {
  const { sessionId: routeSessionId } = useParams();
  const [sessionId, setSessionId] = useState<string | null>(routeSessionId ?? null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const refresh = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const data = await fetchBlueprintImportSession(sessionId);
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId]);

  const blockingFlags = useMemo(
    () => (summary?.review_flags ?? []).filter((f) => f.blocking && !f.resolved),
    [summary],
  );
  const wallSourcePresent = useMemo(
    () => (summary?.source_documents ?? []).some((d: any) => d.document_type === "wall_report"),
    [summary],
  );
  const acceptedTradeIds = useMemo(
    () => new Set((summary?.accepted_trades ?? []).map((a) => a.trade_id)),
    [summary],
  );

  const handleAccept = async (trade_id: string, detected_trade_id?: string) => {
    if (!sessionId) return;
    setAccepting(trade_id);
    try {
      await acceptBlueprintTrade({ session_id: sessionId, trade_id, detected_trade_id });
      toast.success(`Accepted ${TRADE_LABELS[trade_id] ?? trade_id}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acceptance blocked");
    } finally {
      setAccepting(null);
    }
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 space-y-6 max-w-6xl">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Blueprint Importer v2</h1>
          <p className="text-muted-foreground">
            Deterministic Roofr/EagleView report parsing → detected trades → user acceptance.
            Material list, labor pricing, and CRM estimate handoff are not enabled until Phase 4.
          </p>
        </header>

        {!sessionId && (
          <Card>
            <CardHeader><CardTitle>Open an import session</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sessions are created via the <code>/blueprint-importer/v2/ingest</code> route on
                the existing <code>document-worker</code> function. Paste a session ID below to review and accept trades.
              </p>
              <SessionPicker onPick={setSessionId} />
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading session…</div>
        )}

        {summary && (
          <>
            <SessionSummaryCard summary={summary} />

            {blockingFlags.length > 0 && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Blocking review flags</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    {blockingFlags.map((f) => (
                      <li key={f.id}><span className="font-mono text-xs">{f.flag_code}</span> — {f.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {summary.detected_trades.map((dt) => {
                const isAccepted = acceptedTradeIds.has(dt.trade_id);
                const tradeMeasurements = summary.measurements.filter((m) => m.trade_id === dt.trade_id);
                const allHavePlanPath = tradeMeasurements.length > 0 && tradeMeasurements.every((m) => !!m.plan_path_id);
                const paintBlocked = dt.trade_id === "paint_coatings" && !wallSourcePresent && !acceptedTradeIds.has("exterior_walls_siding");
                const futureBlocked = dt.support_status === "future_supported";
                const measOnly = dt.support_status === "measurement_object_only";
                const disabled = isAccepted || futureBlocked || measOnly || paintBlocked || !allHavePlanPath;

                const reason = isAccepted ? "Already accepted"
                  : measOnly ? "Measurement-object-only — cannot be a top-level trade in MVP"
                  : futureBlocked ? "Future-supported only — requires Phase 4 sheet intelligence"
                  : paintBlocked ? "Requires Exterior Walls / Siding source in this session"
                  : !allHavePlanPath ? "Missing PlanPath provenance for one or more measurements"
                  : "";

                return (
                  <Card key={dt.id} className={isAccepted ? "border-primary/60" : ""}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{TRADE_LABELS[dt.trade_id] ?? dt.trade_id}</CardTitle>
                        <SupportBadge status={dt.support_status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Confidence {(dt.confidence * 100).toFixed(0)}% · {tradeMeasurements.length} measurement{tradeMeasurements.length === 1 ? "" : "s"}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {tradeMeasurements.length > 0 ? (
                        <ul className="text-sm space-y-1 max-h-44 overflow-auto rounded border p-2 bg-muted/30">
                          {tradeMeasurements.slice(0, 8).map((m) => (
                            <li key={m.id} className="flex justify-between gap-2">
                              <span className="font-mono text-xs">{m.measurement_key}</span>
                              <span className="text-xs">
                                {m.quantity != null ? `${m.quantity}${m.unit ? " " + m.unit : ""}` : (m.normalized_value ? "table" : "—")}
                                {!m.plan_path_id && <Badge variant="destructive" className="ml-2">no PlanPath</Badge>}
                              </span>
                            </li>
                          ))}
                          {tradeMeasurements.length > 8 && (
                            <li className="text-xs text-muted-foreground italic">+ {tradeMeasurements.length - 8} more…</li>
                          )}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No measurements extracted for this trade.</p>
                      )}

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Button
                              disabled={disabled || accepting === dt.trade_id}
                              onClick={() => handleAccept(dt.trade_id, dt.id)}
                              size="sm"
                            >
                              {isAccepted ? "Accepted" : accepting === dt.trade_id ? "Accepting…" : "Accept trade"}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {reason && <TooltipContent>{reason}</TooltipContent>}
                      </Tooltip>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <Separator />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Lock className="h-4 w-4" /> Next actions (disabled in Phase 3)</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {["Populate Material List", "Generate Labor Pricing", "Push to Estimate"].map((label) => (
                  <Tooltip key={label}>
                    <TooltipTrigger asChild>
                      <span><Button variant="outline" disabled>{label}</Button></span>
                    </TooltipTrigger>
                    <TooltipContent>Not enabled until Phase 4.</TooltipContent>
                  </Tooltip>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function SessionPicker({ onPick }: { onPick: (id: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2">
      <input
        className="flex-1 border rounded px-3 py-2 text-sm bg-background"
        placeholder="Paste import_session_id"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <Button onClick={() => val && onPick(val.trim())} disabled={!val.trim()}>Open</Button>
    </div>
  );
}

function SupportBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    mvp_supported: { label: "MVP", variant: "default" },
    measurement_object_only: { label: "Measurement-only", variant: "secondary" },
    future_supported: { label: "Future", variant: "outline" },
    unsupported: { label: "Unsupported", variant: "destructive" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function SessionSummaryCard({ summary }: { summary: SessionSummary }) {
  const s = summary.session as any;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Session {s.id?.slice(0, 8)}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div><div className="text-xs text-muted-foreground">Status</div><div className="font-medium">{s.status}</div></div>
        <div><div className="text-xs text-muted-foreground">Contract</div><div className="font-mono text-xs">{s.contract_version}</div></div>
        <div><div className="text-xs text-muted-foreground">Source docs</div><div>{summary.source_documents.length}</div></div>
        <div><div className="text-xs text-muted-foreground">Detected trades</div><div>{summary.detected_trades.length}</div></div>
        <div><div className="text-xs text-muted-foreground">Measurements</div><div>{summary.measurements.length}</div></div>
        <div><div className="text-xs text-muted-foreground">PlanPaths</div><div>{summary.plan_paths.length}</div></div>
        <div><div className="text-xs text-muted-foreground">Accepted</div><div>{summary.accepted_trades.length}</div></div>
        <div><div className="text-xs text-muted-foreground">Review flags</div><div>{summary.review_flags.length}</div></div>
      </CardContent>
    </Card>
  );
}
