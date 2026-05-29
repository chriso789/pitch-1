// React Query hooks for the section-aware measurement-mapping engine.
// All write paths go through the routed measurement-api edge function.
//
// Phase 1 contract:
//   - map-measurements ALWAYS dry-runs by default (no estimate_line_items writes).
//   - Persisting assignments is a separate, explicit action (dry_run=false).
//   - The only segment-write path exposed here is manual-split.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { edgeApi } from "@/lib/edgeApi";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import type {
  ManualSplitPayload,
  MappingPreviewResult,
  MeasurementFeature,
  MeasurementImport,
  MeasurementSegment,
} from "./types";

export interface ImportBundle {
  import: MeasurementImport | null;
  segments: MeasurementSegment[];
  features: MeasurementFeature[];
}

export function useMeasurementImport(importId: string | null | undefined) {
  const tenantId = useEffectiveTenantId();
  return useQuery<ImportBundle>({
    queryKey: ["measurement-import", importId, tenantId],
    enabled: !!importId && !!tenantId,
    queryFn: async () => {
      const [impRes, segRes, featRes] = await Promise.all([
        supabase
          .from("measurement_imports" as never)
          .select("*")
          .eq("id", importId!)
          .eq("tenant_id", tenantId!)
          .maybeSingle(),
        supabase
          .from("measurement_segments" as never)
          .select("*")
          .eq("measurement_import_id", importId!)
          .eq("tenant_id", tenantId!)
          .is("archived_at", null),
        supabase
          .from("measurement_features" as never)
          .select("*")
          .eq("measurement_import_id", importId!)
          .eq("tenant_id", tenantId!)
          .is("archived_at", null),
      ]);
      return {
        import: (impRes.data as MeasurementImport | null) ?? null,
        segments: (segRes.data as MeasurementSegment[] | null) ?? [],
        features: (featRes.data as MeasurementFeature[] | null) ?? [],
      };
    },
  });
}

export function useNormalizeMeasurementImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      roof_measurement_id: string;
      job_id?: string;
      provider?: string;
    }) => {
      const { data, error } = await edgeApi<{ measurement_import_id: string }>(
        "measurement-api",
        "/measurement-imports/normalize",
        body,
      );
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["measurement-import"] });
    },
  });
}

export function useManualMeasurementSplit(importId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ManualSplitPayload) => {
      if (!importId) throw new Error("importId_required");
      const { data, error } = await edgeApi<{ created: number }>(
        "measurement-api",
        `/measurement-imports/${importId}/manual-split`,
        payload as unknown as Record<string, unknown>,
      );
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["measurement-import", importId] });
      qc.invalidateQueries({ queryKey: ["template-mapping-preview"] });
    },
  });
}

/**
 * Dry-run mapping preview. NEVER persists assignments (dry_run=true).
 * Use `usePersistTemplateMeasurementMapping` for the explicit persist action.
 */
export function useTemplateMappingPreview(
  templateId: string | null | undefined,
  measurementImportId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery<MappingPreviewResult>({
    queryKey: ["template-mapping-preview", templateId, measurementImportId],
    enabled:
      (options?.enabled ?? true) && !!templateId && !!measurementImportId,
    queryFn: async () => {
      const { data, error } = await edgeApi<MappingPreviewResult>(
        "measurement-api",
        `/estimate-templates/${templateId}/map-measurements`,
        { measurement_import_id: measurementImportId, dry_run: true },
      );
      if (error) throw new Error(error);
      return data!;
    },
  });
}

export function usePersistTemplateMeasurementMapping(
  templateId: string | null | undefined,
  measurementImportId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts?: { estimate_id?: string }) => {
      if (!templateId || !measurementImportId) {
        throw new Error("template_and_import_required");
      }
      const { data, error } = await edgeApi<MappingPreviewResult>(
        "measurement-api",
        `/estimate-templates/${templateId}/map-measurements`,
        {
          measurement_import_id: measurementImportId,
          dry_run: false,
          estimate_id: opts?.estimate_id,
        },
      );
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["template-mapping-preview", templateId, measurementImportId],
      });
    },
  });
}
