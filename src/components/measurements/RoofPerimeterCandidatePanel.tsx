import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import {
  useRoofPerimeterCandidates,
  useSelectRoofPerimeterCandidate,
  useMarkRoofPerimeterCandidateStatus,
  type RoofPerimeterCandidate,
} from "@/hooks/useRoofPerimeterCandidates";
import { toast } from "@/hooks/use-toast";

interface Props {
  measurementJobId?: string | null;
}

/**
 * Roof Perimeter Candidate panel.
 *
 * Surfaces the offset-candidate set produced by the mskill
 * `create_roof_edge_candidates` executor. Operators choose the offset that
 * best matches the visible roof drip-edge in the aerial image. Final
 * eave/rake classification happens later — this panel does NOT promise a
 * finished roof report.
 */
export function RoofPerimeterCandidatePanel({ measurementJobId }: Props) {
  const { data: candidates, isLoading, error } = useRoofPerimeterCandidates(measurementJobId);
  const select = useSelectRoofPerimeterCandidate(measurementJobId);
  const mark = useMarkRoofPerimeterCandidateStatus(measurementJobId);

  const { uniform, adaptive, selected } = useMemo(() => {
    const list = candidates ?? [];
    return {
      uniform: list.filter((c) => c.source_type === "uniform_offset"),
      adaptive: list.filter((c) => c.source_type === "adaptive_offset"),
      selected: list.find((c) => c.is_selected) ?? null,
    };
  }, [candidates]);

  if (!measurementJobId) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Estimated Roof Perimeter Candidate</span>
          {selected && <SelectedBadge candidate={selected} />}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Estimated roof perimeter candidate based on soffit/eave assumptions. The county building footprint
          is the wall-line anchor and is never overwritten. Math-only offsets are never marked final — surface
          refinement (DSM / point cloud / vendor report) is required to promote a candidate to final perimeter.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive">Failed to load candidates: {(error as Error).message}</div>
        )}
        {!isLoading && !error && (candidates?.length ?? 0) === 0 && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No candidates yet. Run <code className="font-mono">create_roof_edge_candidates</code> for this job to generate the offset set.
          </div>
        )}

        {selected && <SelectedSummary candidate={selected} />}

        {uniform.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Uniform offsets</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {uniform.map((c) => (
                <OffsetButton
                  key={c.id}
                  candidate={c}
                  pending={select.isPending}
                  onSelect={() => {
                    select.mutate(c.id, {
                      onSuccess: () => toast({ title: `Selected ${c.effective_offset_ft ?? c.offset_ft} ft offset` }),
                      onError: (e) => toast({ title: "Selection failed", description: (e as Error).message, variant: "destructive" }),
                    });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {adaptive.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Adaptive eave/rake</div>
            <div className="grid grid-cols-1 gap-2">
              {adaptive.map((c) => (
                <AdaptiveCard
                  key={c.id}
                  candidate={c}
                  pending={select.isPending}
                  onSelect={() => select.mutate(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => mark.mutate({ candidateId: selected.id, status: "needs_review" })}
              disabled={mark.isPending}
            >
              <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Mark needs review
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => mark.mutate({ candidateId: selected.id, status: "proposed" })}
              disabled={mark.isPending}
            >
              Reset selected
            </Button>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is an estimated roof perimeter, not a final eave/rake. Surface refinement
            (<code className="font-mono">refine_roof_perimeter_from_surface</code>) and per-edge
            classification (<code className="font-mono">detect_eaves</code> /{" "}
            <code className="font-mono">detect_rakes</code>) run after planes/pitch are available.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectedBadge({ candidate }: { candidate: RoofPerimeterCandidate }) {
  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {(candidate.effective_offset_ft ?? candidate.offset_ft ?? 0).toFixed(1)} ft selected
    </Badge>
  );
}

function SelectedSummary({ candidate }: { candidate: RoofPerimeterCandidate }) {
  const isFinal = candidate.surface_refined === true || candidate.imagery_verified === true;
  const finalStateLabel = isFinal ? "Final (surface-refined)" : "Selected (awaiting surface refinement)";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-accent/30 p-3 text-sm sm:grid-cols-4">
        <Metric label="Area" value={fmtNumber(candidate.area_sqft)} unit="sqft" />
        <Metric label="Perimeter" value={fmtNumber(candidate.perimeter_ft)} unit="ft" />
        <Metric label="Δ area vs. footprint" value={fmtSignedNumber(candidate.delta_area_sqft)} unit="sqft" />
        <Metric label="Δ perimeter" value={fmtSignedNumber(candidate.delta_perimeter_ft)} unit="ft" />
        <Metric label="Effective offset" value={fmtNumber(candidate.effective_offset_ft ?? candidate.offset_ft)} unit="ft" />
        <Metric label="Geom. confidence" value={candidate.confidence != null ? (candidate.confidence * 100).toFixed(0) : "—"} unit="%" />
        <Metric label="Status" value={candidate.status ?? "—"} />
        <Metric label="Final perimeter state" value={finalStateLabel} />
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-4">
        <Metric label="Soffit data source" value={candidate.soffit_data_source ?? "—"} />
        <Metric label="Soffit exposure" value={fmtNumber(candidate.soffit_exposure_ft)} unit="ft" />
        <Metric label="Soffit confidence" value={candidate.soffit_confidence ?? "—"} />
        <Metric label="Eave source" value={candidate.eave_source_type ?? "—"} />
        <Metric label="Rake source" value={candidate.rake_source_type ?? "—"} />
        <Metric label="Overhang strategy" value={candidate.overhang_strategy ?? "—"} />
        <Metric label="Jurisdiction default" value={candidate.jurisdiction_default_used ? "yes" : "no"} />
        <Metric label="Roof-type default" value={candidate.roof_type_default_used ? "yes" : "no"} />
        <Metric label="Surface refined" value={candidate.surface_refined ? "yes" : "no"} />
        <Metric label="Imagery verified" value={candidate.imagery_verified ? "yes" : "no"} />
        <Metric label="Validation source" value={candidate.validation_source ?? "—"} />
        <Metric label="Reason" value={candidate.confidence_reason ?? candidate.needs_review_reason ?? "—"} />
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function OffsetButton({
  candidate,
  pending,
  onSelect,
}: {
  candidate: RoofPerimeterCandidate;
  pending: boolean;
  onSelect: () => void;
}) {
  const offset = candidate.effective_offset_ft ?? candidate.offset_ft ?? 0;
  return (
    <Button
      type="button"
      size="sm"
      variant={candidate.is_selected ? "default" : "outline"}
      disabled={pending}
      onClick={onSelect}
      className="flex h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
    >
      <span className="text-sm font-semibold">{offset.toFixed(1)} ft</span>
      <span className="text-[10px] font-normal opacity-80">
        {fmtNumber(candidate.area_sqft)} sqft · {fmtNumber(candidate.perimeter_ft)} lf
      </span>
    </Button>
  );
}

function AdaptiveCard({
  candidate,
  pending,
  onSelect,
}: {
  candidate: RoofPerimeterCandidate;
  pending: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={pending}
      className={`flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors ${
        candidate.is_selected ? "border-primary bg-primary/5" : "hover:bg-accent/40"
      }`}
    >
      <div>
        <div className="text-sm font-medium">
          Eave {fmtNumber(candidate.eave_offset_ft)} ft · Rake {fmtNumber(candidate.rake_offset_ft)} ft
        </div>
        <div className="text-xs text-muted-foreground">
          {fmtNumber(candidate.area_sqft)} sqft · {fmtNumber(candidate.perimeter_ft)} lf · effective{" "}
          {fmtNumber(candidate.effective_offset_ft)} ft
        </div>
      </div>
      {candidate.is_selected && <Badge variant="default">Selected</Badge>}
    </button>
  );
}

function fmtNumber(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function fmtSignedNumber(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return v > 0 ? `+${s}` : s;
}
