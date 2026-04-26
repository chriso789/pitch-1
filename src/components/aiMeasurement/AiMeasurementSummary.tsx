import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AiMeasurementSummaryProps {
  measurement: {
    job: any;
    result: any;
    planes: any[];
    edges: any[];
    checks: any[];
  } | null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function AiMeasurementSummary({ measurement }: AiMeasurementSummaryProps) {
  if (!measurement?.job) return null;

  const { job, result, planes, edges, checks } = measurement;

  const confidencePercent =
    typeof job.confidence_score === "number"
      ? Math.round(job.confidence_score * 100)
      : null;

  const fmt = (v: any, digits = 1) =>
    typeof v === "number" || (typeof v === "string" && v !== "")
      ? Number(v).toFixed(digits)
      : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          AI Roof Measurement
          <Badge variant="outline">{job.status}</Badge>
        </CardTitle>
        <CardDescription>
          {confidencePercent !== null
            ? `Confidence: ${confidencePercent}%`
            : "Awaiting confidence score"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!result ? (
          <p className="text-sm text-muted-foreground">
            Measurement is processing or waiting for results.
          </p>
        ) : (
          <div className="space-y-4">
            {job.status !== "completed" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                This measurement is not approved for customer-facing use yet.
                Status: {job.status}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Metric label="Total Roof Area" value={`${fmt(result.total_area_sqft)} sqft`} />
              <Metric
                label="Pitch-Adjusted Area"
                value={`${fmt(result.total_pitch_adjusted_sqft)} sqft`}
              />
              <Metric label="Squares" value={fmt(result.total_squares, 2)} />
              <Metric
                label="Waste-Adjusted"
                value={`${fmt(result.waste_adjusted_sqft)} sqft`}
              />
              <Metric label="Dominant Pitch" value={`${fmt(result.dominant_pitch, 1)}/12`} />
              <Metric label="Planes" value={String(planes?.length ?? 0)} />
            </div>

            {checks?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Quality Checks</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {checks.map((check: any) => (
                    <div
                      key={check.id || check.check_name}
                      className="flex items-center justify-between text-xs border border-border rounded px-2 py-1"
                    >
                      <span className="text-foreground">{check.check_name}</span>
                      <span
                        className={
                          check.passed
                            ? "text-green-600 dark:text-green-400"
                            : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {check.passed ? "Passed" : "Review"}
                        {typeof check.score === "number"
                          ? ` (${Math.round(check.score * 100)}%)`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {edges?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Detected Roof Lines</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {edges.map((edge: any) => (
                    <div
                      key={edge.id}
                      className="border border-border rounded px-2 py-1 text-xs"
                    >
                      <div className="font-medium capitalize">{edge.edge_type}</div>
                      <div className="text-muted-foreground">
                        {Number(edge.length_ft || 0).toFixed(1)} ft
                      </div>
                      <div className="text-muted-foreground">
                        {Math.round(Number(edge.confidence || 0) * 100)}% conf
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
