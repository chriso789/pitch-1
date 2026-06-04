import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { edgeApi } from "@/lib/edgeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type SourceRow = {
  provider_key: string;
  provider_name: string;
  provider_type: "external_api" | "internal_worker";
  data_category: string;
  enabled: boolean;
  priority: number | null;
  jurisdiction: string | null;
  query_url: string | null;
  metadata_url: string | null;
  download_url_template: string | null;
  auth_required: boolean;
  required_env_var: string | null;
  requires_paid_toggle?: boolean;
  worker_implemented?: boolean | null;
  worker_online?: boolean;
  coverage_records?: Array<{ county?: string; state?: string; data_year?: number; resolution_m?: number; asset_type?: string; source_url?: string }>;
  last_test_status: string | null;
  last_http_status: number | null;
  last_success_at: string | null;
  last_error: string | null;
  output_table: string | null;
  output_artifact_type: string | null;
  supports_roof_geometry: boolean;
  notes: string | null;
};

type Inventory = {
  generated_at: string;
  job_scope: any;
  groups: Array<{ category: string; sources: SourceRow[] }>;
  flat: SourceRow[];
  worker_summary: any;
  next_blocker: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  geocode: "Address / Geocode",
  parcel: "Parcel Sources",
  footprint: "Building Footprint Sources",
  lidar: "LiDAR / Elevation Coverage",
  elevation: "Elevation Catalog",
  dem: "DEM Sources",
  dtm: "DTM Sources",
  dsm: "DSM Sources",
  point_cloud: "Point-Cloud Sources",
  roof_surface: "Roof-Surface Sources",
  worker_compute: "Internal Worker Skills",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">unknown</Badge>;
  const variant =
    status === "ok" || status === "completed" ? "default" :
    status === "skipped" || status === "queued" || status === "running" ? "secondary" :
    "destructive";
  return <Badge variant={variant as any}>{status}</Badge>;
}

export default function ProviderSourceInventoryPage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const [jobInput, setJobInput] = useState(jobId);

  const invQ = useQuery({
    queryKey: ["mskill", "provider-inventory", jobId],
    queryFn: async () => {
      const res = await edgeApi<Inventory>("measurement-api", "/mskill/providers/inventory", jobId ? { jobId } : {});
      if (res.error) throw new Error(res.error);
      return res.data!;
    },
  });

  const testM = useMutation({
    mutationFn: async ({ provider_key, mode }: { provider_key: string; mode: string }) => {
      const res = await edgeApi<any>("measurement-api", "/mskill/providers/test", { provider_key, mode });
      if (res.error) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (d, vars) => {
      toast({
        title: `Test ${d?.ok ? "✓" : "✗"} ${vars.provider_key}`,
        description: d?.http_status ? `HTTP ${d.http_status} · ${d.url ?? ""}` : (d?.error ?? d?.status ?? d?.note ?? "done"),
        variant: d?.ok ? "default" : "destructive",
      });
      invQ.refetch();
    },
    onError: (e: any) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const downloadJson = () => {
    if (!invQ.data) return;
    const blob = new Blob([JSON.stringify(invQ.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `provider-inventory-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inv = invQ.data;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Provider Source Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Every data source the measurement pipeline can pull from — geocoder, parcel, footprint, LiDAR,
            DEM/DTM/DSM, point cloud, roof-surface assets, and internal worker compute skills.
            Distinguishes <em>source discovered</em> vs <em>source downloaded</em> and <em>stub skill</em> vs <em>real completed skill</em>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => invQ.refetch()} disabled={invQ.isFetching}>
            {invQ.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="outline" onClick={downloadJson} disabled={!inv}>Download JSON</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Job scope (optional)</CardTitle></CardHeader>
        <CardContent className="flex gap-2 items-center">
          <Input
            placeholder="mskill_job_id (e.g. for 4063 Fonsica)"
            value={jobInput}
            onChange={(e) => setJobInput(e.target.value)}
            className="font-mono"
          />
          <Button onClick={() => setParams(jobInput ? { jobId: jobInput } : {})}>Scope to job</Button>
          {jobId && <Button variant="ghost" onClick={() => { setJobInput(""); setParams({}); }}>Clear</Button>}
        </CardContent>
      </Card>

      {inv?.job_scope && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">Job evidence summary</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <div><span className="text-muted-foreground">Address:</span> {inv.job_scope.request?.input_address ?? "—"}</div>
              <div><span className="text-muted-foreground">Geocoder:</span> {inv.job_scope.request?.geocode_provider ?? "—"}</div>
              <div><span className="text-muted-foreground">Parcel source:</span> {inv.job_scope.parcel?.provider_key ?? "—"}</div>
              <div><span className="text-muted-foreground">Footprint source:</span> {inv.job_scope.building_footprint?.provider_key ?? "—"}</div>
              <div><span className="text-muted-foreground">LiDAR coverage:</span> {inv.job_scope.lidar_window?.provider_key ?? "—"} {inv.job_scope.lidar_window?.has_coverage ? "✓" : "✗"}</div>
            </div>
            <div>
              <div><span className="text-muted-foreground">DEM/DTM assets:</span> {inv.job_scope.elevation_assets?.length ?? 0}</div>
              <div><span className="text-muted-foreground">Roof-surface assets:</span> {inv.job_scope.roof_surface_assets?.length ?? 0}</div>
              <div>
                <span className="text-muted-foreground">Roof geometry possible:</span>{" "}
                {(inv.job_scope.roof_surface_assets?.length ?? 0) > 0 ? "yes (asset present)" : "no (no roof-surface asset)"}
              </div>
              <div className="mt-2"><span className="text-muted-foreground">Next blocker:</span> <span className="font-mono text-xs">{inv.next_blocker ?? "—"}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {inv?.worker_summary && (
        <Card>
          <CardHeader><CardTitle className="text-base">Internal worker</CardTitle></CardHeader>
          <CardContent className="text-sm flex flex-wrap gap-4">
            <span>{inv.worker_summary.display_name} · <code className="text-xs">{inv.worker_summary.base_url}</code></span>
            <StatusPill status={inv.worker_summary.is_online ? "ok" : "offline"} />
            <span className="text-muted-foreground">last check: {inv.worker_summary.last_health_check ?? "—"}</span>
          </CardContent>
        </Card>
      )}

      {invQ.isLoading && <div className="text-sm text-muted-foreground">Loading inventory…</div>}
      {invQ.error && <div className="text-sm text-destructive">Error: {(invQ.error as any).message}</div>}

      {inv?.groups.map((g) =>
        g.sources.length === 0 ? null : (
          <Card key={g.category}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {CATEGORY_LABEL[g.category] ?? g.category}
                <Badge variant="outline">{g.sources.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.sources.map((s) => (
                <div key={s.provider_key} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-semibold">
                        {s.provider_name}{" "}
                        <span className="text-xs font-mono text-muted-foreground">{s.provider_key}</span>
                      </div>
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <Badge variant={s.enabled ? "default" : "outline"}>{s.enabled ? "enabled" : "disabled"}</Badge>
                        <Badge variant="secondary">{s.provider_type}</Badge>
                        {s.jurisdiction && <Badge variant="outline">{s.jurisdiction}</Badge>}
                        {s.requires_paid_toggle && <Badge variant="destructive">paid</Badge>}
                        {s.required_env_var && (
                          <Badge variant="outline" className="font-mono text-xs">env: {s.required_env_var}</Badge>
                        )}
                        {s.provider_type === "internal_worker" && (
                          <Badge variant={s.worker_implemented ? "default" : "destructive"}>
                            {s.worker_implemented ? "implemented" : "stub / not implemented"}
                          </Badge>
                        )}
                        {s.supports_roof_geometry && <Badge>supports roof geometry</Badge>}
                        <StatusPill status={s.last_test_status} />
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" disabled={testM.isPending}
                        onClick={() => testM.mutate({ provider_key: s.provider_key, mode: "connection" })}>
                        Test connection
                      </Button>
                      <Button size="sm" variant="outline" disabled={testM.isPending || !inv.job_scope}
                        onClick={() => testM.mutate({ provider_key: s.provider_key, mode: "aoi" })}>
                        Test by job AOI
                      </Button>
                      <Button size="sm" variant="outline" disabled={testM.isPending}
                        onClick={() => testM.mutate({ provider_key: s.provider_key, mode: "metadata" })}>
                        Metadata
                      </Button>
                      <Button size="sm" variant="outline" disabled={testM.isPending}
                        onClick={() => testM.mutate({ provider_key: s.provider_key, mode: "asset" })}>
                        Asset
                      </Button>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    {s.query_url && <div><span className="text-muted-foreground">query_url:</span> <code className="break-all">{s.query_url}</code></div>}
                    {s.metadata_url && <div><span className="text-muted-foreground">metadata_url:</span> <code className="break-all">{s.metadata_url}</code></div>}
                    {s.download_url_template && <div><span className="text-muted-foreground">download_url_template:</span> <code className="break-all">{s.download_url_template}</code></div>}
                    {s.output_table && <div><span className="text-muted-foreground">output_table:</span> <code>{s.output_table}</code></div>}
                    {s.output_artifact_type && <div><span className="text-muted-foreground">artifact_type:</span> <code>{s.output_artifact_type}</code></div>}
                    {s.last_http_status != null && <div><span className="text-muted-foreground">last_http:</span> {s.last_http_status}</div>}
                    {s.last_success_at && <div><span className="text-muted-foreground">last_success_at:</span> {s.last_success_at}</div>}
                    {s.last_error && <div className="md:col-span-2 text-destructive"><span className="text-muted-foreground">last_error:</span> {s.last_error}</div>}
                    {s.notes && <div className="md:col-span-2 text-muted-foreground">{s.notes}</div>}
                  </div>
                  {(s.coverage_records?.length ?? 0) > 0 && (
                    <div className="text-xs">
                      <div className="text-muted-foreground mb-1">Coverage records:</div>
                      <ul className="list-disc pl-5">
                        {s.coverage_records!.map((c, i) => (
                          <li key={i}>
                            {c.county ?? "—"} {c.state ?? ""} · {c.asset_type ?? "?"} · {c.data_year ?? "?"} · {c.resolution_m ?? "?"}m
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
