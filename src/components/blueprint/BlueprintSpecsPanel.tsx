import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BlueprintSpecsPanel({ specs }: { specs: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Extracted specifications ({specs.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {specs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No specs extracted yet.</p>
        ) : (
          <div className="space-y-3">
            {specs.map((spec) => (
              <div key={spec.id} className="border rounded-md p-3">
                <div className="text-xs uppercase text-muted-foreground">
                  {spec.category} / {spec.key_name}
                </div>
                <div className="font-medium">{spec.value_text}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
