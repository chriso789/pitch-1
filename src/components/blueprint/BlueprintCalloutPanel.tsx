import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function BlueprintCalloutPanel({ refs }: { refs: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Detail callouts ({refs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {refs.length === 0 ? (
          <p className="text-muted-foreground">No callouts found.</p>
        ) : (
          refs.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b pb-1">
              <span className="font-mono">{r.callout_text}</span>
              <Badge variant={r.target_page_id ? "default" : "outline"}>
                {r.target_page_id ? `→ ${r.target_sheet_number || "linked"}` : "unlinked"}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
