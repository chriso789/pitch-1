import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { edgeApi } from "@/lib/edgeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import WorkerTestReportPanel from "./WorkerTestReportPanel";
import { AIMeasurementProgramCards } from "@/components/admin/AIMeasurementProgramCards";

type Skill = {
  skill_key: string;
  display_name: string;
  category: string;
  execution_target: string;
  pipeline_order: number;
  dependencies: string[];
  worker_endpoint: string | null;
  version: string;
};

export default function MeasurementSkillsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [address, setAddress] = useState("");

  const skillsQ = useQuery({
    queryKey: ["mskill", "registry"],
    queryFn: async () => {
      const res = await edgeApi<{ skills: Skill[] }>("measurement-api", "/mskill/skills/list", {});
      if (res.error) throw new Error(res.error);
      return res.data!.skills;
    },
  });

  const createJob = useMutation({
    mutationFn: async (input_address: string) => {
      const res = await edgeApi<{ mskill_job_id: string }>("measurement-api", "/mskill/jobs/create", { input_address });
      if (res.error) throw new Error(res.error);
      return res.data!;
    },
    onSuccess: (data) => {
      toast({ title: "Job created", description: `Job ${data.mskill_job_id.slice(0, 8)}…` });
      window.location.href = `/admin/measurement-skills/${data.mskill_job_id}`;
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">PITCH Measure — Internal Skill Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Source of truth for the 24-skill measurement pipeline. Heavy compute skills dispatch to the
            internal worker; they never fake completion.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Start a measurement job</CardTitle></CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (address.trim()) createJob.mutate(address.trim()); }}
          >
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="4205 Custer Drive, Valrico, FL 33594" />
            <Button type="submit" disabled={!address.trim() || createJob.isPending}>
              {createJob.isPending ? "Creating…" : "Create job"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AIMeasurementProgramCards />

      <WorkerTestReportPanel />

      <Card>
        <CardHeader><CardTitle>Skill registry</CardTitle></CardHeader>
        <CardContent>
          {skillsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {skillsQ.error && <p className="text-sm text-destructive">{(skillsQ.error as Error).message}</p>}
          <div className="space-y-2">
            {skillsQ.data?.map((s) => (
              <div key={s.skill_key} className="flex items-start gap-3 border rounded-md p-3">
                <div className="font-mono text-xs text-muted-foreground w-8 pt-0.5">#{s.pipeline_order}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{s.display_name}</span>
                    <code className="text-xs text-muted-foreground">{s.skill_key}</code>
                    <Badge variant="outline">{s.category}</Badge>
                    <Badge variant={s.execution_target === "internal_worker" ? "secondary" : s.execution_target === "hybrid" ? "outline" : "default"}>
                      {s.execution_target}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{s.version}</span>
                  </div>
                  {s.dependencies.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      deps: {s.dependencies.join(", ")}
                    </div>
                  )}
                  {s.worker_endpoint && (
                    <div className="text-xs text-muted-foreground mt-1">
                      worker: <code>{s.worker_endpoint}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
