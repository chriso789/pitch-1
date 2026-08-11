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
  pipeline_entry_id?: string | null;
  sellingPrice?: number;
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "sync failed";
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return fallback;
  try {
    const payload = await context.clone().json() as {
      error?: string;
      details?: { message?: string } | string;
    };
    const detail = typeof payload.details === "string" ? payload.details : payload.details?.message;
    return [payload.error, detail].filter(Boolean).join(": ") || fallback;
  } catch {
    return fallback;
  }
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

      const pipelineEntryIds = (projects ?? [])
        .map((project) => project.pipeline_entry_id)
        .filter((id): id is string => Boolean(id));
      let convertedEntryIds = new Set<string>();
      if (pipelineEntryIds.length) {
        const { data: convertedEntries, error: convertedError } = await supabase
          .from("pipeline_entries")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("status", ["project", "completed", "closed", "capped_out", "final_payment", "production"])
          .in("id", pipelineEntryIds);
        if (convertedError) throw convertedError;
        convertedEntryIds = new Set((convertedEntries ?? []).map((entry) => entry.id));
      }

      const convertedProjects = ((projects ?? []) as ProjectRow[]).filter(
        (project) => project.pipeline_entry_id && convertedEntryIds.has(project.pipeline_entry_id),
      );
      const convertedPipelineIds = convertedProjects
        .map((project) => project.pipeline_entry_id)
        .filter((id): id is string => Boolean(id));
      const sellingPriceByPipeline = new Map<string, number>();
      if (convertedPipelineIds.length) {
        const { data: estimates, error: estimateError } = await supabase
          .from("enhanced_estimates")
          .select("pipeline_entry_id, selling_price")
          .eq("tenant_id", tenantId)
          .in("pipeline_entry_id", convertedPipelineIds);
        if (estimateError) throw estimateError;
        for (const estimate of estimates ?? []) {
          if (!estimate.pipeline_entry_id) continue;
          const price = Number(estimate.selling_price ?? 0);
          sellingPriceByPipeline.set(
            estimate.pipeline_entry_id,
            Math.max(sellingPriceByPipeline.get(estimate.pipeline_entry_id) ?? 0, price),
          );
        }
      }
      const pricedProjects = convertedProjects.map((project) => ({
        ...project,
        sellingPrice: project.pipeline_entry_id
          ? sellingPriceByPipeline.get(project.pipeline_entry_id) ?? 0
          : 0,
      }));
      const ids = pricedProjects.map((project) => project.id);
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
        all: pricedProjects,
        unsynced: pricedProjects.filter((project) => !mappedIds.has(project.id)),
        synced: pricedProjects.filter((project) => mappedIds.has(project.id)),
      };
    },
    enabled: !!tenantId,
  });

  const unsynced = data?.unsynced ?? [];
  const synced = data?.synced ?? [];
  const total = unsynced.length;
  const [runTotal, setRunTotal] = useState(0);
  const pct = useMemo(() => (runTotal ? Math.round((done / runTotal) * 100) : 0), [done, runTotal]);


  const runSync = async (projects: ProjectRow[], successLabel: string, force = false) => {
    if (!projects.length) return;
    setRunning(true);
    setDone(0);
    setRunTotal(projects.length);
    setFailed([]);
    const failures: string[] = [];

    for (const project of projects) {
      const label = project.clj_formatted_number || project.project_number || project.name || project.id.slice(0, 8);
      try {
        const { data: res, error } = await supabase.functions.invoke("qbo-project-sync", {
          body: { project_id: project.id, trigger: "manual", force },
        });

        if (error || !(res as any)?.ok) {
          const message = (res as any)?.error ?? (error ? await getFunctionErrorMessage(error) : "sync failed");
          failures.push(`${label}: ${message}`);
        } else {
          // The customer/job hierarchy and the financial transaction are one
          // sync operation from the user's perspective. Create/update the QBO
          // invoice from the current selling price after the sub-job exists.
          if ((project.sellingPrice ?? 0) > 0) {
            const { data: financialRes, error: financialError } = await supabase.functions.invoke("qbo-worker", {
              body: { op: "createInvoiceFromEstimates", args: { project_id: project.id } },
              headers: { "x-tenant-id": tenantId },
            });
            if (financialError || (financialRes as any)?.ok === false) {
              const message = (financialRes as any)?.error ??
                (financialError ? await getFunctionErrorMessage(financialError) : "financial sync failed");
              failures.push(`${label}: customer/job synced, invoice failed: ${message}`);
            }
          }
        }
      } catch (e: any) {
        failures.push(`${label}: ${e?.message ?? "sync failed"}`);
      }
      setDone((d) => d + 1);
    }

    setFailed(failures);
    setRunning(false);
    await refetch();

    const count = projects.length;
    if (!failures.length) {
      toast.success(`${successLabel} ${count} job${count === 1 ? "" : "s"}`);
    } else {
      toast.warning(`${count - failures.length} of ${count} succeeded — ${failures.length} failed`);
    }
  };

  const allJobs = data?.all ?? [];
  const pushTargets = total ? unsynced : allJobs;
  const runBulkPush = () => runSync(pushTargets, total ? "Pushed" : "Re-synced", !total);
  const runRename = () => runSync(synced, "Updated names for", true);

  const [cleanup, setCleanup] = useState<{
    dry_run: boolean;
    deactivated: string[];
    kept: string[];
    needs_manual_merge: string[];
    duplicate_groups: number;
  } | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const runCleanup = async (dryRun: boolean) => {
    setCleaning(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("qbo-worker", {
        body: { op: "cleanupDuplicateJobs", args: { dry_run: dryRun } },
        headers: { "x-tenant-id": tenantId },
      });
      if (error || (res as any)?.ok === false) {
        const message = (res as any)?.error ?? (error ? await getFunctionErrorMessage(error) : "cleanup failed");
        toast.error(message);
        return;
      }
      const payload = ((res as any)?.data ?? res) as any;
      setCleanup(payload);
      if (dryRun) {
        toast.info(`${payload.duplicate_groups} customer${payload.duplicate_groups === 1 ? "" : "s"} with duplicate job numbers found`);
      } else {
        toast.success(`Removed ${payload.deactivated.length} duplicate job number${payload.deactivated.length === 1 ? "" : "s"}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "cleanup failed");
    } finally {
      setCleaning(false);
    }
  };

  const [nameFix, setNameFix] = useState<{
    dry_run: boolean;
    scanned: number;
    renamed: Array<{ from: string; to: string }>;
    merged?: string[];
    skipped: string[];
  } | null>(null);
  const [fixingNames, setFixingNames] = useState(false);

  const runNameNormalize = async (dryRun: boolean) => {
    setFixingNames(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("qbo-worker", {
        body: { op: "normalizeCustomerNames", args: { dry_run: dryRun } },
        headers: { "x-tenant-id": tenantId },
      });
      if (error || (res as any)?.ok === false) {
        const message = (res as any)?.error ?? (error ? await getFunctionErrorMessage(error) : "rename failed");
        toast.error(message);
        return;
      }
      const payload = ((res as any)?.data ?? res) as any;
      setNameFix(payload);
      if (dryRun) {
        toast.info(`${payload.renamed.length} customer name${payload.renamed.length === 1 ? "" : "s"} to clean up`);
      } else {
        toast.success(`Renamed ${payload.renamed.length} customer${payload.renamed.length === 1 ? "" : "s"}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "rename failed");
    } finally {
      setFixingNames(false);
    }
  };


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Push jobs to QuickBooks</CardTitle>
            <CardDescription>
              Creates the QuickBooks customer (person) + job sub-customer for every active, completed
              and closed job. Already-linked jobs can be re-synced to repair names or missing sub-customers.
            </CardDescription>
          </div>
          <Badge variant={total ? "secondary" : "outline"}>
            {isLoading ? "…" : `${total} pending`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={runBulkPush}
            disabled={running || isLoading || !pushTargets.length}
            className="gap-2"
          >
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {running
              ? `Syncing ${done}/${pushTargets.length}…`
              : total
                ? `Push ${total} job${total === 1 ? "" : "s"} to QuickBooks`
                : `Re-sync all ${pushTargets.length} job${pushTargets.length === 1 ? "" : "s"}`}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={runRename}
            disabled={running || isLoading || !synced.length}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Fix {synced.length} job name{synced.length === 1 ? "" : "s"} in QuickBooks
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runCleanup(true)}
            disabled={running || cleaning}
            className="gap-2"
          >
            {cleaning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            Find duplicate job numbers
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runNameNormalize(true)}
            disabled={running || fixingNames}
            className="gap-2"
          >
            {fixingNames ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            Clean up customer names
          </Button>

          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={running} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>

          <span className="text-xs text-muted-foreground">
            {allJobs.length} jobs total
          </span>
        </div>

        {running && <Progress value={pct} className="h-2" />}

        {!running && !total && !isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            All jobs are linked to QuickBooks.
          </div>
        )}

        {cleanup && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">
              {cleanup.duplicate_groups} customer{cleanup.duplicate_groups === 1 ? "" : "s"} with more than one job number
            </div>
            {cleanup.deactivated.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {cleanup.dry_run ? "Will be removed" : "Removed"}: {cleanup.deactivated.join(", ")}
              </div>
            )}
            {cleanup.needs_manual_merge.length > 0 && (
              <div className="text-xs text-amber-600">
                Kept (has transactions — merge manually in QuickBooks): {cleanup.needs_manual_merge.join(", ")}
              </div>
            )}
            {cleanup.dry_run && cleanup.deactivated.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => runCleanup(false)} disabled={cleaning}>
                Remove {cleanup.deactivated.length} duplicate job number{cleanup.deactivated.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}

        {nameFix && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">
              {nameFix.renamed.length} customer name{nameFix.renamed.length === 1 ? "" : "s"} with an address or job number attached
              <span className="text-muted-foreground font-normal"> ({nameFix.scanned} scanned)</span>
            </div>
            {nameFix.renamed.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                {nameFix.renamed.map((r, i) => (
                  <li key={i}>{r.from} → {r.to}</li>
                ))}
              </ul>
            )}
            {(nameFix.merged?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium">
                  {nameFix.merged!.length} duplicate parent{nameFix.merged!.length === 1 ? "" : "s"} merged into the clean customer
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                  {nameFix.merged!.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {nameFix.skipped.length > 0 && (
              <div className="text-xs text-amber-600">Skipped: {nameFix.skipped.join(", ")}</div>
            )}
            {nameFix.dry_run && (nameFix.renamed.length > 0 || (nameFix.merged?.length ?? 0) > 0) && (
              <Button size="sm" onClick={() => runNameNormalize(false)} disabled={fixingNames}>
                Clean up {nameFix.renamed.length + (nameFix.merged?.length ?? 0)} customer
                {nameFix.renamed.length + (nameFix.merged?.length ?? 0) === 1 ? "" : "s"}
              </Button>
            )}
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
