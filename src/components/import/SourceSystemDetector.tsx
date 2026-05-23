import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Props { batchId: string; onDetected?: (sourceSystem: string) => void; }

export function SourceSystemDetector({ batchId, onDetected }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run() {
    setLoading(true);
    const { data } = await supabase.functions.invoke("import-api", {
      body: { __route: `/batches/${batchId}/detect-source-system` },
    });
    setResult(data);
    if (data?.data?.top?.source_system) onDetected?.(data.data.top.source_system);
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Source System Detector</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={loading}>{loading ? "Detecting…" : "Detect vendor"}</Button>
        {result?.data?.top && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge>{result.data.top.display_name}</Badge>
              <span className="text-sm text-muted-foreground">
                confidence {(result.data.top.confidence * 100).toFixed(0)}%
              </span>
            </div>
            {result.data.ranked?.slice(0, 5).map((r: any) => (
              <div key={r.source_system} className="text-xs text-muted-foreground">
                {r.display_name}: {(r.confidence * 100).toFixed(0)}%
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
