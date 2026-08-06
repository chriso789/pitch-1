import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  tenantId: string;
}

interface ProjectRow {
  id: string;
  clj_formatted_number: string | null;
  project_number: string | null;
  name: string | null;
}

/**
 * Bulk-pushes every converted job (project) for this tenant into QuickBooks as a
 * Customer record, reusing the same server-side `qbo-project-sync` operation the
 * per-project panel uses (tenant + impersonation gates enforced server-side).
 */
export function QuickBooksBulkProjectSync({ tenantId }: Props) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["qbo-bulk-converted-projects", tenantId],
    queryFn: async () => {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("id, clj_formatted_number, project_number, name, pipeline_entry_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (projects ?? []).map((p: any) => p.id);
      let mappedIds = new Set<string>();
      if (ids.length) {
        const { data: mappings } = await supabase
          .from("project_qbo_mappings")
          .select("pitch_project_id")
          .eq("is_active", true)
          .in("pitch_project_id", ids);
        mappedIds = new Set((mappings ?? []).map((m: any) => m.pitch_project_id));
      }

      return {
        all: (projects ?? []) as ProjectRow[],
        unsynced: ((projects ?? []) as ProjectRow[]).filter((p) => !mappedIds.has(p.id)),
      };
    },
    enabled: !!tenantId,
  });

  const unsynced = data?.unsynced ?? [];
  const total = unsynced.length;
  const pct = useMemo(() => (total ? Math.round((done / total) * 100) : 0), [done, total]);

  const runBulkPush = async () => {
    if (!total) return;
    setRunning(true);
    setDone(0);
    setFailed([]);
    const failures: string[] = [];

    for (const project of unsynced) {
      const label = project.clj_formatted_number || project.project_number || project.name || project.id.slice(0, 8);
      try {
        const { data: res, error } = await supabase.functions.invoke("qbo-project-sync", {
          body: { project_id: project.id, trigger: "manual" },
        });
        if (error || !(res as any)?.ok) {
          failures.push(`${label}: ${(res as any)?.error ?? error?.message ?? "sync failed"}`);
        }
      } catch (e: any) {
        failures.push(`${label}: ${e?.message ?? "sync failed"}`);
      }
      setDone((d) => d + 1);
    }

    setFailed(failures);
    setRunning(false);
    await refetch();

    if (!failures.length) {
      toast.success(`Pushed ${total} converted job${total === 1 ? "" : "s"} to QuickBooks`);
    } else {
      toast.warning(`${total - failures.length} of ${total} pushed — ${failures.length} failed`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Push converted jobs to QuickBooks</CardTitle>
            <CardDescription>
              Creates a QuickBooks customer record for every converted job that isn't linked yet.
            </CardDescription>
          </div>
          <Badge variant={total ? "secondary" : "outline"}>
            {isLoading ? "…" : `${total} pending`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runBulkPush} disabled={running || isLoading || !total} className="gap-2">
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {running ? `Pushing ${done}/${total}…` : `Push ${total || 0} job${total === 1 ? "" : "s"} to QuickBooks`}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={running} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <span className="text-xs text-muted-foreground">
            {data?.all?.length ?? 0} converted jobs total
          </span>
        </div>

        {running && <Progress value={pct} className="h-2" />}

        {!running && !total && !isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            All converted jobs are linked to QuickBooks.
          </div>
        )}

        {failed.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {failed.length} job{failed.length === 1 ? "" : "s"} failed
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
              {failed.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
