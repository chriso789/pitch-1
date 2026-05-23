import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BAND_COLORS: Record<string, string> = {
  safe: "bg-green-500", review: "bg-yellow-500",
  cleanup: "bg-orange-500", do_not_import: "bg-red-500", unknown: "bg-gray-400",
};

export function MigrationPlanPanel({ plan }: { plan: any }) {
  if (!plan) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Migration Plan
          <Badge className={BAND_COLORS[plan.confidence_band]}>
            {plan.confidence_score} — {plan.confidence_band}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <strong>Import order:</strong>{" "}
          <span className="text-xs">{(plan.entity_order ?? []).join(" → ")}</span>
        </div>
        <div>
          <strong>Estimated counts</strong>
          <pre className="bg-muted p-2 rounded text-xs">{JSON.stringify(plan.estimated_counts, null, 2)}</pre>
        </div>
        <div>
          <strong>Required mappings</strong>
          <pre className="bg-muted p-2 rounded text-xs">{JSON.stringify(plan.required_mappings, null, 2)}</pre>
        </div>
        {plan.risk_flags?.length > 0 && (
          <div className="text-amber-600 text-xs">
            <strong>Risks</strong>
            <ul className="list-disc ml-5">{plan.risk_flags.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
        {plan.recommended_actions?.length > 0 && (
          <div className="text-xs">
            <strong>Recommended actions</strong>
            <ul className="list-disc ml-5">{plan.recommended_actions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
