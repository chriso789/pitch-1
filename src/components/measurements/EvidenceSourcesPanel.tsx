// PR #4 — Evidence Hardening: per-layer evidence source diagnostics.
// Renders the `evidence_sources_used`, `footprint_source_tier`, and
// `evidence_acquisition_log` columns persisted on ai_measurement_jobs.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, MinusCircle, ShieldOff } from "lucide-react";

type Status =
  | "ok" | "empty" | "error" | "skipped" | "unauthorized" | "quota_exceeded";

interface Attempt {
  layer: string;
  source: string;
  status: Status;
  latency_ms: number;
  http_status?: number;
  error?: string;
  attempted_at: string;
  notes?: string;
}

interface SourceRecord {
  source: string;
  confidence: number | null;
  fetched_at: string;
  meta?: Record<string, unknown>;
}

export interface EvidenceSourcesPanelProps {
  footprintSourceTier?: string | null;
  evidenceSourcesUsed?: Record<string, SourceRecord> | null;
  evidenceAcquisitionLog?: Attempt[] | null;
}

const TIER_LABEL: Record<string, string> = {
  tier1_osm: "OSM",
  tier1_ms_footprints: "MS Footprints",
  tier2_parcel: "Parcel",
  tier3_solar_mask: "Solar mask",
  tier4_unet: "UNet mask",
  none: "None",
};

function statusIcon(s: Status) {
  if (s === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (s === "empty" || s === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  if (s === "unauthorized" || s === "quota_exceeded") return <ShieldOff className="h-3.5 w-3.5 text-orange-600" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-red-600" />;
}

export function FootprintSourceBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const label = TIER_LABEL[tier] ?? tier;
  const variant = tier.startsWith("tier1") ? "default" : tier === "tier2_parcel" ? "secondary" : "outline";
  return <Badge variant={variant as any}>Footprint: {label}</Badge>;
}

export function EvidenceSourcesPanel(props: EvidenceSourcesPanelProps) {
  const { footprintSourceTier, evidenceSourcesUsed, evidenceAcquisitionLog } = props;
  if (!evidenceSourcesUsed && !evidenceAcquisitionLog?.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Evidence Sources</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No evidence diagnostics persisted for this job yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Evidence Sources</CardTitle>
        <FootprintSourceBadge tier={footprintSourceTier} />
      </CardHeader>
      <CardContent className="space-y-3">
        {evidenceSourcesUsed && Object.keys(evidenceSourcesUsed).length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Winning sources</div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {Object.entries(evidenceSourcesUsed).map(([layer, rec]) => (
                <div key={layer} className="flex items-center justify-between rounded border px-2 py-1">
                  <span className="capitalize">{layer}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {rec.source} · {rec.confidence != null ? rec.confidence.toFixed(2) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {evidenceAcquisitionLog && evidenceAcquisitionLog.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Acquisition log</div>
            <div className="max-h-48 overflow-auto rounded border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1">Layer</th>
                    <th className="px-2 py-1">Source</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1 text-right">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {evidenceAcquisitionLog.map((a, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 capitalize">{a.layer}</td>
                      <td className="px-2 py-1 font-mono">{a.source}</td>
                      <td className="px-2 py-1">
                        <span className="inline-flex items-center gap-1">
                          {statusIcon(a.status)}
                          <span>{a.status}</span>
                          {a.http_status ? <span className="text-muted-foreground">({a.http_status})</span> : null}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{a.latency_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
