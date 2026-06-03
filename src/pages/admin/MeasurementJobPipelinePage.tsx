import React from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { edgeApi } from "@/lib/edgeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type PipelineSkill = {
  skill_key: string;
  display_name: string;
  category: string;
  execution_target: string;
  pipeline_order: number;
  dependencies: string[];
  worker_endpoint: string | null;
  version: string;
  status: string;
  blocking_reason: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  worker_job_ref: string | null;
  artifacts: Array<{ id: string; artifact_type: string; storage_path: string | null; source_url: string | null }>;
  cannot_complete_from_stub: boolean;
  skill_run_id: string | null;
};

type JobPayload = {
  job: any; request: any; geometry_status: any; bridge: any;
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "running" || status === "queued") return "secondary";
  if (status === "failed" || status === "blocked") return "destructive";
  return "outline";
}

export default function MeasurementJobPipelinePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();

  const jobQ = useQuery({
    queryKey: ["mskill", "job", jobId],
    queryFn: async () => {
      const r = await edgeApi<JobPayload>("measurement-api", "/mskill/jobs/get", { __noop: true }, { headers: {} });
      // edgeApi POSTs by default; for GET-style use fetch via supabase client built-in is easier — fallback:
      throw new Error("use REST GET");
    },
    enabled: false,
  });

  // Use direct functions.invoke since edgeApi assumes POST.
  const job = useQuery({
    queryKey: ["mskill", "job-get", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const r = await edgeApi<JobPayload>("measurement-api", "/mskill/jobs/get?jobId=" + jobId, {});
      // Send as POST with query-style route; the router accepts the route header.
      if (r.error) throw new Error(r.error);
      return r.data!;
    },
    refetchInterval: 5000,
  });

  const pipeline = useQuery({
    queryKey: ["mskill", "pipeline", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const r = await edgeApi<{ pipeline: PipelineSkill[] }>("measurement-api", "/mskill/skills/pipeline?jobId=" + jobId, {});
      if (r.error) throw new Error(r.error);
      return r.data!.pipeline;
    },
    refetchInterval: 3000,
  });

  const runSkill = useMutation({
    mutationFn: async (skill_key: string) => {
      const r = await edgeApi("measurement-api", "/mskill/skills/run", { mskill_job_id: jobId, skill_key });
      if (r.error) throw new Error(r.error);
      return r.data;
    },
    onSuccess: (_d, skill_key) => {
      toast({ title: "Skill triggered", description: skill_key });
      qc.invalidateQueries({ queryKey: ["mskill", "pipeline", jobId] });
      qc.invalidateQueries({ queryKey: ["mskill", "job-get", jobId] });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const bridge = useMutation({
    mutationFn: async () => {
      const r = await edgeApi("measurement-api", "/mskill/jobs/bridge", { mskill_job_id: jobId });
      if (r.error) throw new Error(r.error);
      return r.data;
    },
    onSuccess: () => {
      toast({ title: "Bridge attempted" });
      qc.invalidateQueries({ queryKey: ["mskill", "job-get", jobId] });
    },
    onError: (e: any) => toast({ title: "Bridge failed", description: e.message, variant: "destructive" }),
  });

  const j = job.data?.job;
  const r = job.data?.request;
  const b = job.data?.bridge;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold">Measurement job pipeline</h1>
        <p className="text-sm text-muted-foreground font-mono">{jobId}</p>
      </div>

      {r && (
        <Card>
          <CardHeader><CardTitle>Request</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><strong>Input address:</strong> {r.input_address}</div>
            <div><strong>Normalized:</strong> {r.normalized_address ?? <em className="text-muted-foreground">not geocoded yet</em>}</div>
            <div><strong>Coords:</strong> {r.lat ? `${r.lat}, ${r.lon}` : "—"}</div>
            <div><strong>County:</strong> {r.county ?? "—"}</div>
            <div><strong>Status:</strong> <Badge variant="outline">{r.status}</Badge></div>
            <div className="text-xs font-mono text-muted-foreground"><strong>request_hash:</strong> {r.request_hash}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Bridge to roof_measurements</span>
            <Button size="sm" disabled={bridge.isPending} onClick={() => bridge.mutate()}>
              {bridge.isPending ? "Attempting…" : "Attempt bridge"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><strong>Status:</strong> <Badge variant={b?.bridge_status === "written" ? "default" : b?.bridge_status === "failed" ? "destructive" : "outline"}>{j?.bridge_status ?? "not_written"}</Badge></div>
          {j?.target_roof_measurement_id && (
            <div><strong>Target roof_measurements id:</strong> <code>{j.target_roof_measurement_id}</code></div>
          )}
          {b?.error_message && <div className="text-destructive"><strong>Error:</strong> {b.error_message}</div>}
          {!b && <p className="text-muted-foreground">Bridge only runs once validate_geometry + export_geojson + export_report have all completed with real artifacts.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Skill pipeline</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {pipeline.data?.map((s) => (
              <div key={s.skill_key} className="border rounded-md p-3">
                <div className="flex items-start gap-3">
                  <div className="font-mono text-xs text-muted-foreground w-8 pt-0.5">#{s.pipeline_order}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{s.display_name}</span>
                      <code className="text-xs text-muted-foreground">{s.skill_key}</code>
                      <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                      <Badge variant="outline">{s.execution_target}</Badge>
                      {s.cannot_complete_from_stub && (
                        <Badge variant="destructive">cannot complete from stub</Badge>
                      )}
                    </div>
                    {s.blocking_reason && (
                      <div className="text-xs text-muted-foreground mt-1">
                        blocked: {s.blocking_reason}
                      </div>
                    )}
                    {s.error_message && (
                      <div className="text-xs text-destructive mt-1">error: {s.error_message}</div>
                    )}
                    {s.artifacts.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        artifacts: {s.artifacts.map((a) => a.artifact_type).join(", ")}
                      </div>
                    )}
                    {s.worker_job_ref && (
                      <div className="text-xs text-muted-foreground mt-1">worker_job_ref: {s.worker_job_ref}</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={s.status === "completed" ? "outline" : "default"}
                    disabled={runSkill.isPending}
                    onClick={() => runSkill.mutate(s.skill_key)}
                  >
                    {s.status === "completed" ? "Re-run" : "Run"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
