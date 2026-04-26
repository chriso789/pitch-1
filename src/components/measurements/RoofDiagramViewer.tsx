import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DiagramRow {
  id: string;
  diagram_type: string;
  title: string;
  page_number: number | null;
  svg_markup: string | null;
}

/**
 * Renders EagleView-style diagram pages generated from PITCH measured geometry.
 * Pass either an explicit aiMeasurementJobId, or a leadId/projectId — the
 * component will resolve the latest AI measurement job automatically.
 */
export function RoofDiagramViewer({
  aiMeasurementJobId,
  leadId,
  projectId,
}: {
  aiMeasurementJobId?: string | null;
  leadId?: string | null;
  projectId?: string | null;
}) {
  const [diagrams, setDiagrams] = useState<DiagramRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let jobId = aiMeasurementJobId || null;

      if (!jobId && (leadId || projectId)) {
        let q = (supabase as any)
          .from("ai_measurement_jobs")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(1);
        if (leadId) q = q.eq("lead_id", leadId);
        if (projectId) q = q.eq("project_id", projectId);
        const { data } = await q.maybeSingle();
        jobId = data?.id || null;
      }

      if (!jobId) {
        if (!cancelled) setDiagrams([]);
        return;
      }

      const { data, error } = await (supabase as any)
        .from("ai_measurement_diagrams")
        .select("id, diagram_type, title, page_number, svg_markup")
        .eq("ai_measurement_job_id", jobId)
        .order("page_number", { ascending: true });

      if (error) {
        console.error("[RoofDiagramViewer] load error", error);
        return;
      }
      if (!cancelled) setDiagrams(data || []);
    })();

    return () => {
      cancelled = true;
    };
  }, [aiMeasurementJobId, leadId, projectId]);

  if (diagrams.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roof Measurement Diagrams</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {diagrams.map((d) => (
          <div key={d.id} className="border rounded-lg overflow-hidden bg-background">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="font-semibold text-sm">
                {d.page_number}. {d.title}
              </div>
              <Badge variant="secondary">{d.diagram_type}</Badge>
            </div>
            <div
              className="w-full overflow-auto bg-white"
              dangerouslySetInnerHTML={{ __html: d.svg_markup || "" }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default RoofDiagramViewer;
