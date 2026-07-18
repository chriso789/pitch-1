import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { RoofTraceRevision } from "@/integrations/roofTraceApi";

interface Props {
  revision: RoofTraceRevision | null;
  status: "pending" | "proposed" | "needs_review" | "accepted" | "rejected";
}

/**
 * Read-only preview of the RoofTrace AI workbench canvas.
 * Renders the source tile with the proposed outer perimeter overlaid.
 *   cyan   = proposed
 *   orange = needs review
 *   green  = accepted
 */
export function RoofTraceWorkbenchPreview({ revision, status }: Props) {
  const stroke =
    status === "accepted" ? "#22c55e" :
    status === "needs_review" ? "#f97316" :
    status === "rejected" ? "#ef4444" :
    "#06b6d4"; // proposed / pending

  const geometry = revision?.geometry;
  const gate = revision?.perimeter_gate_metrics;

  const polygonPoints = useMemo(() => {
    if (!geometry?.outer_perimeter?.length) return "";
    return geometry.outer_perimeter.map(([x, y]) => `${x},${y}`).join(" ");
  }, [geometry]);

  if (!revision || !geometry) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perimeter Preview</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No revision yet. Run the measurement test to generate a proposed perimeter.
        </CardContent>
      </Card>
    );
  }

  const w = geometry.image_width;
  const h = geometry.image_height;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Perimeter Preview — Revision {revision.revision}</CardTitle>
        <Badge variant={status === "accepted" ? "default" : status === "needs_review" ? "destructive" : "secondary"}>
          {status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative w-full overflow-hidden rounded-md border bg-muted">
          {geometry.image_url ? (
            <img
              src={geometry.image_url}
              alt="Source aerial"
              className="block w-full h-auto"
              style={{ aspectRatio: `${w}/${h}` }}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
              No source image
            </div>
          )}
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
            preserveAspectRatio="none"
          >
            {polygonPoints && (
              <polygon
                points={polygonPoints}
                fill={stroke}
                fillOpacity={0.12}
                stroke={stroke}
                strokeWidth={Math.max(2, w / 300)}
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>

        {gate && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <GateStat label="Closed" ok={gate.closed} />
            <GateStat label="Non-self-intersecting" ok={!gate.self_intersects} />
            <GateStat label="Coverage" value={`${gate.coverage_pct}%`} ok={gate.coverage_pct > 5 && gate.coverage_pct < 90} />
            <GateStat label="Perimeter (px)" value={String(gate.perimeter_px)} ok={gate.perimeter_px > 0} />
          </div>
        )}

        {gate && !gate.passes && (
          <div className="flex items-start gap-2 text-xs rounded-md bg-orange-500/10 border border-orange-500/30 p-2">
            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
            <span>Perimeter gate did not pass. Review the proposed outline before approving.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GateStat({ label, ok, value }: { label: string; ok?: boolean; value?: string }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1 mt-0.5 font-medium">
        {ok === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
        {ok === false && <XCircle className="h-3.5 w-3.5 text-destructive" />}
        <span>{value ?? (ok ? "yes" : ok === false ? "no" : "-")}</span>
      </div>
    </div>
  );
}
