import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { edgeApi } from "@/lib/edgeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MinusCircle, Loader2 } from "lucide-react";

type TestResult = {
  id: string;
  name: string;
  pass: boolean;
  skipped?: boolean;
  detail?: string;
  data?: unknown;
  duration_ms?: number;
};

type RunResponse = {
  ok: boolean;
  summary: { passed: number; failed: number; skipped: number; total?: number };
  results: TestResult[];
  stopped?: string;
};

export default function WorkerTestReportPanel() {
  const [report, setReport] = useState<RunResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const runTests = useMutation({
    mutationFn: async () => {
      const res = await edgeApi<RunResponse>("measurement-worker-test", "/run", {});
      if (res.error) throw new Error(res.error);
      return res.data!;
    },
    onSuccess: (data) => setReport(data),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Internal Worker — clip_point_cloud test report</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              End-to-end integration check. Worker must be reachable via{" "}
              <code>INTERNAL_WORKER_BASE_URL</code> with matching{" "}
              <code>INTERNAL_WORKER_API_KEY</code>.
            </p>
          </div>
          <Button onClick={() => runTests.mutate()} disabled={runTests.isPending}>
            {runTests.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</>
            ) : (
              "Run worker tests"
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {runTests.error && (
          <p className="text-sm text-destructive">
            {(runTests.error as Error).message}
          </p>
        )}

        {report && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={report.ok ? "default" : "destructive"}>
                {report.ok ? "PASS" : "FAIL"}
              </Badge>
              <span className="text-muted-foreground">
                {report.summary.passed} passed · {report.summary.failed} failed ·{" "}
                {report.summary.skipped} skipped
              </span>
              {report.stopped && (
                <span className="text-xs text-destructive ml-2">⚠ {report.stopped}</span>
              )}
            </div>

            <div className="space-y-1.5">
              {report.results.map((r) => {
                const Icon = r.skipped ? MinusCircle : r.pass ? CheckCircle2 : XCircle;
                const tone = r.skipped
                  ? "text-muted-foreground"
                  : r.pass
                  ? "text-emerald-600"
                  : "text-destructive";
                const isOpen = expanded[r.id];
                return (
                  <div
                    key={r.id}
                    className="border rounded-md p-2.5 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${tone}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{r.name}</span>
                          {r.skipped && <Badge variant="outline" className="text-xs">skipped</Badge>}
                          {typeof r.duration_ms === "number" && (
                            <span className="text-xs text-muted-foreground">
                              {r.duration_ms}ms
                            </span>
                          )}
                        </div>
                        {r.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
                        )}
                        {isOpen && r.data !== undefined && (
                          <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-auto max-h-64">
                            {JSON.stringify(r.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground pt-2">
              Real-clip and sparse-AOI tests run from a measurement job pipeline page —
              they need a real <code>roof_surface_asset</code> with a point-cloud URL.
              Do not move to <code>generate_dsm</code> until every non-skipped test
              passes.
            </p>
          </>
        )}

        {!report && !runTests.isPending && (
          <p className="text-sm text-muted-foreground">
            Click "Run worker tests" to execute the 10-test integration plan.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
