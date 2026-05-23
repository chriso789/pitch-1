import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AdapterConfidenceCard({ score, band, issues }: { score: number; band: string; issues?: string[] }) {
  const colors: Record<string, string> = {
    safe: "bg-green-500", review: "bg-yellow-500",
    cleanup: "bg-orange-500", do_not_import: "bg-red-500", unknown: "bg-gray-400",
  };
  return (
    <Card>
      <CardHeader><CardTitle>Adapter Confidence</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge className={colors[band] ?? colors.unknown}>{score} / 100</Badge>
          <span className="text-sm text-muted-foreground capitalize">{band.replace(/_/g, " ")}</span>
        </div>
        {issues?.length ? (
          <ul className="text-xs list-disc ml-5 text-amber-600">
            {issues.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
