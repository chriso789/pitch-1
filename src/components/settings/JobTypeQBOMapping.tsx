// Job Type → QuickBooks Online item mapping.
//
// The previous iteration of this component targeted `job_type_qbo_mapping`,
// a table that never existed in this project. The authoritative backend
// (built during O'Brien sandbox setup) is `public.job_type_item_map`, keyed
// on (tenant_id, realm_id, job_type_code), with optional QBO class linkage.
//
// This rewrite:
//   1. Reads/writes the real `job_type_item_map` table.
//   2. Uses `useEffectiveTenantId()` so the admin sandbox surface follows the
//      active tenant (matches the rest of the QBO admin panel).
//   3. Removes the hard "must connect QBO first" gate. Mappings are stored
//      per-realm; when no realm is present yet we still show the job-type
//      grid so admins can see current mappings and pre-plan the surface.
//   4. Once a QBO connection exists we fetch live QBO service items and let
//      the user bind each Pitch job type to a specific QBO item.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertCircle, Link as LinkIcon, PlugZap } from "lucide-react";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

interface QBOItem {
  id: string;
  name: string;
  description?: string;
  unitPrice?: number;
}

interface JobTypeItemMapRow {
  id: string;
  tenant_id: string;
  realm_id: string;
  job_type_code: string;
  qbo_item_id: string;
  qbo_item_name: string;
  qbo_class_id: string | null;
  qbo_class_name: string | null;
  is_active: boolean;
}

interface QBOConnectionRow {
  id: string;
  tenant_id: string;
  realm_id: string;
  is_active: boolean;
  is_sandbox: boolean | null;
  oauth_app_env: string | null;
}

// Canonical Pitch job-type catalog. Mirrors the code enum used by
// `qbo-worker.createInvoiceFromJob` when it looks up a job type mapping.
const JOB_TYPES: Array<{ code: string; label: string }> = [
  { code: "roof_repair", label: "Roof Repair" },
  { code: "roof_replacement", label: "Roof Replacement" },
  { code: "gutters", label: "Gutters" },
  { code: "fascia", label: "Fascia" },
  { code: "siding", label: "Siding" },
  { code: "windows", label: "Window Replacement" },
  { code: "doors", label: "Door Replacement" },
  { code: "interior_paint", label: "Interior Paint" },
  { code: "exterior_paint", label: "Exterior Paint" },
  { code: "handyman", label: "Handyman" },
  { code: "solar", label: "Solar" },
];

export function JobTypeQBOMapping() {
  const queryClient = useQueryClient();
  const hookTenantId = useEffectiveTenantId();

  const { data: connection, isLoading: loadingConnection } = useQuery({
    queryKey: ["qbo-connection-any"],
    queryFn: async () => {
      // Rely on RLS to scope this to the caller's tenant. This avoids a
      // mismatch between the company-switcher's activeCompanyId and the
      // profile's active_tenant_id/tenant_id used elsewhere on this page,
      // which was surfacing "Not connected" here while the panel above
      // showed a live connection.
      const { data } = await (supabase as any)
        .from("qbo_connections")
        .select("id, tenant_id, realm_id, is_active, is_sandbox, oauth_app_env")
        .eq("is_active", true)
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as QBOConnectionRow | null;
    },
  });

  const realmId = connection?.realm_id ?? null;
  const tenantId = connection?.tenant_id ?? hookTenantId;

  // Existing persisted mappings for the active tenant + realm.
  const { data: mappings, isLoading: loadingMappings } = useQuery({
    queryKey: ["job-type-item-map", tenantId, realmId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("job_type_item_map" as any)
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true);
      if (realmId) q = q.eq("realm_id", realmId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as JobTypeItemMapRow[];
    },
  });


  // Live QBO service items — only meaningful once a connection exists.
  const {
    data: qboItems,
    isLoading: loadingItems,
    refetch: refetchItems,
    isFetching: refetchingItems,
    error: itemsError,
  } = useQuery({
    queryKey: ["qbo-items", tenantId, realmId],
    enabled: !!connection,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("qbo-fetch-items");
      if (error) throw error;
      return (data?.items ?? []) as QBOItem[];
    },
    retry: 1,
  });

  const mappingByJobType = useMemo(() => {
    const m: Record<string, JobTypeItemMapRow> = {};
    (mappings ?? []).forEach((row) => {
      m[row.job_type_code] = row;
    });
    return m;
  }, [mappings]);

  const [pending, setPending] = useState<Record<string, string>>({});
  useEffect(() => {
    const seed: Record<string, string> = {};
    (mappings ?? []).forEach((row) => {
      seed[row.job_type_code] = row.qbo_item_id;
    });
    setPending(seed);
  }, [mappings]);

  const saveMutation = useMutation({
    mutationFn: async ({ jobType, qboItemId, qboItemName }: { jobType: string; qboItemId: string; qboItemName: string }) => {
      if (!tenantId) throw new Error("No active tenant");
      if (!realmId) throw new Error("Connect QuickBooks before saving mappings — realm_id is required");
      const { error } = await supabase
        .from("job_type_item_map" as any)
        .upsert(
          {
            tenant_id: tenantId,
            qbo_connection_id: connection?.id,
            realm_id: realmId,
            job_type_code: jobType,
            qbo_item_id: qboItemId,
            qbo_item_name: qboItemName,
            is_active: true,
          },
          { onConflict: "tenant_id,qbo_connection_id,realm_id,job_type_code" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-type-item-map", tenantId, realmId] });
      toast.success("Mapping saved");
    },
    onError: (e: unknown) => {
      const err = e as { message?: string; details?: string; hint?: string };
      toast.error(err?.message || err?.details || err?.hint || "Failed to save mapping");
    },
  });

  const handleChange = (jobType: string, qboItemId: string) => {
    setPending((prev) => ({ ...prev, [jobType]: qboItemId }));
    const item = qboItems?.find((i) => i.id === qboItemId);
    if (!item) return;
    saveMutation.mutate({ jobType, qboItemId, qboItemName: item.name });
  };

  const mappedCount = JOB_TYPES.filter((jt) => !!mappingByJobType[jt.code]).length;
  const allMapped = mappedCount === JOB_TYPES.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Job Type → QuickBooks item mapping</CardTitle>
            <CardDescription>
              Backed by <code>public.job_type_item_map</code> (keyed on{" "}
              <code>tenant_id, realm_id, job_type_code</code>). Every invoice
              posted from a Pitch job looks up its line item here.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {allMapped ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                All {JOB_TYPES.length} mapped
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <AlertCircle className="h-3 w-3 mr-1" />
                {mappedCount}/{JOB_TYPES.length} mapped
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => refetchItems()} disabled={!connection || refetchingItems}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refetchingItems ? "animate-spin" : ""}`} />
              Refresh QBO items
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Connection status banner — informational, never blocks the surface. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <PlugZap className="h-4 w-4" />
          {loadingConnection ? (
            <span className="text-muted-foreground">Resolving QuickBooks connection…</span>
          ) : connection ? (
            <>
              <Badge variant="secondary">Connected</Badge>
              <span className="text-muted-foreground">
                realm <code>{connection.realm_id}</code> ·{" "}
                {connection.is_sandbox ? "sandbox" : "production"} ·{" "}
                oauth_app_env <code>{connection.oauth_app_env ?? "—"}</code>
              </span>
            </>
          ) : (
            <>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                Not connected
              </Badge>
              <span className="text-muted-foreground">
                Connect QuickBooks above to load live service items and enable
                writes. Existing mappings for this tenant are still shown below.
              </span>
            </>
          )}
        </div>

        {loadingMappings ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading mappings…</p>
        ) : (
          <div className="space-y-2">
            {JOB_TYPES.map((jt) => {
              const existing = mappingByJobType[jt.code];
              const selected = pending[jt.code] ?? existing?.qbo_item_id ?? "";
              return (
                <div
                  key={jt.code}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-[180px]">
                    <p className="font-medium">{jt.label}</p>
                    <p className="text-xs text-muted-foreground">
                      <code>{jt.code}</code>
                    </p>
                    <p className="text-xs mt-1">
                      {existing ? (
                        <span className="text-green-600 inline-flex items-center gap-1">
                          <LinkIcon className="h-3 w-3" />
                          {existing.qbo_item_name}
                        </span>
                      ) : (
                        <span className="text-amber-600">Not mapped</span>
                      )}
                    </p>
                  </div>

                  <Select
                    value={selected}
                    onValueChange={(v) => handleChange(jt.code, v)}
                    disabled={!connection || loadingItems || !qboItems?.length}
                  >
                    <SelectTrigger className="w-full sm:w-[340px]">
                      <SelectValue
                        placeholder={
                          !connection
                            ? "Connect QuickBooks to pick an item"
                            : loadingItems
                              ? "Loading QBO items…"
                              : !qboItems?.length
                                ? "No QBO service items found"
                                : "Select QBO service item"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(qboItems ?? []).map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                          {item.description ? ` — ${item.description}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        {itemsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load QBO items: {(itemsError as Error).message}
          </div>
        ) : null}

        {!allMapped ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="mr-2 inline h-4 w-4" />
            Complete every job type mapping before invoicing from QuickBooks —
            unmapped types fall back to a generic line item and can't post to
            the correct chart-of-accounts bucket.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
