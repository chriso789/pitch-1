import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, ShieldAlert, FileText } from "lucide-react";
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

            <Phase4Panel sessionId={sessionId!} summary={summary} onRefresh={refresh} />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Phase 4 — template binding + deterministic draft generation panel.
// ============================================================================
const MVP_TRADES = new Set(["roofing", "exterior_walls_siding", "paint_coatings", "gutters_fascia_trim"]);

function Phase4Panel({ sessionId, summary, onRefresh }: { sessionId: string; summary: SessionSummary; onRefresh: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<DraftLinesResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<Record<string, Record<string, string>>>({});

  const loadDrafts = async () => {
    try {
      const d = await fetchBlueprintDraftLines(sessionId);
      setDrafts(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load drafts");
    }
  };
  useEffect(() => { void loadDrafts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId]);

  const acceptedMvp = summary.accepted_trades.filter((a) => MVP_TRADES.has(a.trade_id));

  const blockingFlags = summary.review_flags.filter((f) => f.blocking && !f.resolved);
  const materialBlocked = blockingFlags.length > 0;
  const laborBlocked = blockingFlags.length > 0;

  const setA = (acceptedId: string, key: string, value: string) =>
    setAssumptions((prev) => ({ ...prev, [acceptedId]: { ...(prev[acceptedId] ?? {}), [key]: value } }));

  const parseAssumptionMap = (raw: Record<string, string> | undefined): Record<string, unknown> => {
    if (!raw) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === "") continue;
      const n = Number(v);
      out[k] = Number.isFinite(n) && /^-?\d*\.?\d+$/.test(v) ? n : v;
    }
    return out;
  };

  const doBind = async (acceptedId: string) => {
    setBusy(`bind:${acceptedId}`);
    try {
      await bindBlueprintTemplate({
        session_id: sessionId,
        accepted_trade_id: acceptedId,
        user_assumptions: parseAssumptionMap(assumptions[acceptedId]),
      });
      toast.success("Template bound");
      await Promise.all([onRefresh(), loadDrafts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bind failed");
    } finally { setBusy(null); }
  };
  const doMaterials = async (acceptedId: string) => {
    setBusy(`mat:${acceptedId}`);
    try {
      await generateBlueprintMaterialDrafts({
        session_id: sessionId,
        accepted_trade_id: acceptedId,
        user_assumptions: parseAssumptionMap(assumptions[acceptedId]),
      });
      toast.success("Material drafts generated");
      await Promise.all([onRefresh(), loadDrafts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Material generation failed");
    } finally { setBusy(null); }
  };
  const doLabor = async (acceptedId: string) => {
    setBusy(`lab:${acceptedId}`);
    try {
      await generateBlueprintLaborDrafts({
        session_id: sessionId,
        accepted_trade_id: acceptedId,
        user_assumptions: parseAssumptionMap(assumptions[acceptedId]),
      });
      toast.success("Labor drafts generated");
      await Promise.all([onRefresh(), loadDrafts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Labor generation failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Phase 4 — Draft generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Template binding + deterministic material/labor draft quantities. No final pricing, no CRM estimate handoff.</p>
          <p>Windows/doors stay measurement-only; future trades (drywall, framing, MEP) stay locked.</p>
        </CardContent>
      </Card>

      {acceptedMvp.length === 0 && (
        <Alert>
          <AlertTitle>No MVP trades accepted yet</AlertTitle>
          <AlertDescription>Accept at least one of: roofing, exterior walls / siding, paint, or gutters / fascia / trim.</AlertDescription>
        </Alert>
      )}

      {acceptedMvp.map((accepted) => {
        const tradeTemplateMeta = drafts?.trade_templates.find((t) => t.accepted_trade_id === accepted.id);
        const template = (tradeTemplateMeta?.template ?? null) as null | {
          internal_template_key: string; name: string;
          required_assumptions: Array<{ key: string; label: string; required: boolean; template_default: unknown }>;
          optional_assumptions: Array<{ key: string; label: string; required: boolean; template_default: unknown }>;
        };
        const binding = drafts?.bindings.find((b: any) => b.accepted_trade_id === accepted.id && b.binding_status !== "superseded") as any;
        const mats = (drafts?.material_draft_lines ?? []).filter((m: any) => m.accepted_trade_id === accepted.id && m.status !== "superseded");
        const labs = (drafts?.labor_draft_lines ?? []).filter((l: any) => l.accepted_trade_id === accepted.id && l.status !== "superseded");

        return (
          <Card key={accepted.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{TRADE_LABELS[accepted.trade_id] ?? accepted.trade_id}</CardTitle>
                <Badge variant={binding?.binding_status === "ready" ? "default" : binding ? "destructive" : "outline"}>
                  {binding?.binding_status ?? "no binding"}
                </Badge>
              </div>
              {template && (
                <p className="text-xs text-muted-foreground font-mono">{template.internal_template_key}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {template ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Required assumptions</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {template.required_assumptions.map((a) => {
                      const resolved = binding?.required_inputs?.[a.key]?.resolved_value;
                      const source = binding?.required_inputs?.[a.key]?.source;
                      return (
                        <div key={a.key} className="text-xs space-y-1">
                          <label className="font-mono">{a.key}</label>
                          <input
                            className="w-full border rounded px-2 py-1 bg-background"
                            placeholder={String(a.template_default ?? `(required)`)}
                            value={assumptions[accepted.id]?.[a.key] ?? (resolved == null ? "" : String(resolved))}
                            onChange={(e) => setA(accepted.id, a.key, e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">{a.label} · source: {source ?? "—"}</div>
                        </div>
                      );
                    })}
                  </div>
                  {binding?.missing_inputs?.length > 0 && (
                    <div className="text-xs text-destructive mt-2">Missing: {binding.missing_inputs.join(", ")}</div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No MVP template defined for this trade.</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!!busy || !template} onClick={() => doBind(accepted.id)}>
                  {busy === `bind:${accepted.id}` ? "Binding…" : "Bind / refresh template"}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" disabled={!!busy || materialBlocked || !template} onClick={() => doMaterials(accepted.id)}>
                        {busy === `mat:${accepted.id}` ? "Generating…" : "Populate Material Draft"}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {materialBlocked && <TooltipContent>Resolve blocking review flags first.</TooltipContent>}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" disabled={!!busy || laborBlocked || !template} onClick={() => doLabor(accepted.id)}>
                        {busy === `lab:${accepted.id}` ? "Generating…" : "Generate Labor Draft"}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {laborBlocked && <TooltipContent>Resolve blocking review flags first.</TooltipContent>}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span><Button size="sm" variant="outline" disabled>Push to Estimate</Button></span>
                  </TooltipTrigger>
                  <TooltipContent>CRM estimate handoff is not enabled in Phase 4.</TooltipContent>
                </Tooltip>
              </div>

              {(mats.length > 0 || labs.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <DraftTable title="Material drafts" rows={mats} unitKey="unit" nameKey="item_name" />
                  <DraftTable title="Labor drafts" rows={labs} unitKey="unit" nameKey="labor_name" />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DraftTable({ title, rows, unitKey, nameKey }: { title: string; rows: any[]; unitKey: string; nameKey: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="rounded border bg-muted/30 max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-left">
            <tr className="border-b">
              <th className="px-2 py-1">Item</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1">Unit</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">PlanPaths</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-2 py-1">{r[nameKey] ?? r.item_key ?? r.labor_key}</td>
                <td className="px-2 py-1 text-right">{r.quantity ?? "—"}</td>
                <td className="px-2 py-1">{r[unitKey] ?? "—"}</td>
                <td className="px-2 py-1">
                  <Badge variant={r.status === "ready" ? "default" : r.status === "blocked" ? "destructive" : "outline"}>{r.status}</Badge>
                </td>
                <td className="px-2 py-1">{Array.isArray(r.plan_path_ids) ? r.plan_path_ids.length : 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground italic">No rows yet — click the generator button.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
