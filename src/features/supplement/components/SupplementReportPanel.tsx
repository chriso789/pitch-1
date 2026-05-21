import { useState } from "react";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FileText, FileJson, FileCode, Download } from "lucide-react";
import {
  useGenerateSupplementReportV2,
  useExportSupplementReport,
} from "@/hooks/useScopeIntelligence";

type ReportPayload = {
  supplement_report_id: string;
  summary?: Record<string, unknown>;
  markdown?: string;
  html?: string;
};

interface Props {
  /** Optional preset compare-run id. If omitted, the panel prompts for one. */
  compareRunId?: string;
}

/**
 * Drop-in panel for the supplement final-report phase.
 * Generate from a compare-run, preview markdown/html, export 4 formats.
 * Wires `useGenerateSupplementReportV2` + `useExportSupplementReport`.
 */
export function SupplementReportPanel({ compareRunId: initial }: Props) {
  const [runId, setRunId] = useState(initial ?? "");
  const [report, setReport] = useState<ReportPayload | null>(null);

  const generate = useGenerateSupplementReportV2();
  const exportReport = useExportSupplementReport();

  const onGenerate = async () => {
    if (!runId) return;
    const data = await generate.mutateAsync({
      compare_run_id: runId,
      options: { group_by_section: true, group_by_issue_type: true },
    });
    setReport(data as ReportPayload);
  };

  const onExport = (type: "json" | "csv" | "markdown" | "html") => {
    if (!report?.supplement_report_id) return;
    exportReport.mutate({
      supplement_report_id: report.supplement_report_id,
      export_type: type,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Supplement Report
        </CardTitle>
        <CardDescription>
          Generate a final supplement report from a scope comparison run and export it for adjusters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="compare-run-id">Compare run ID</Label>
            <Input
              id="compare-run-id"
              placeholder="paste scope_compare_runs.id"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
            />
          </div>
          <Button
            onClick={onGenerate}
            disabled={!runId || generate.isPending}
          >
            {generate.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate report"
            )}
          </Button>
        </div>

        {report && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onExport("json")} disabled={exportReport.isPending}>
                <FileJson className="mr-2 h-4 w-4" /> JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => onExport("csv")} disabled={exportReport.isPending}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => onExport("markdown")} disabled={exportReport.isPending}>
                <FileCode className="mr-2 h-4 w-4" /> Markdown
              </Button>
              <Button size="sm" variant="outline" onClick={() => onExport("html")} disabled={exportReport.isPending}>
                <FileText className="mr-2 h-4 w-4" /> HTML
              </Button>
            </div>

            <Tabs defaultValue="html">
              <TabsList>
                <TabsTrigger value="html">HTML preview</TabsTrigger>
                <TabsTrigger value="markdown">Markdown</TabsTrigger>
              </TabsList>
              <TabsContent value="html">
                <div
                  className="rounded border bg-background p-4 max-h-[600px] overflow-auto"
                  // Sanitized: builder emits trusted HTML, but RLS-bypass safety enforces DOMPurify per project rule.
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(report.html ?? "<p>No HTML returned.</p>"),
                  }}
                />
              </TabsContent>
              <TabsContent value="markdown">
                <pre className="rounded border bg-muted p-4 max-h-[600px] overflow-auto text-xs whitespace-pre-wrap">
                  {report.markdown ?? "No markdown returned."}
                </pre>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SupplementReportPanel;
