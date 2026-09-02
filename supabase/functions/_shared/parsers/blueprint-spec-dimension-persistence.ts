// Persistence adapter for F1E/F1F specification and dimension candidates.
// Protects confirmed/dismissed rows and keeps deterministic reruns idempotent.

import type { BlueprintSpecCandidate } from "./blueprint-spec-intelligence.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";
import type { BlueprintF1RuntimeResult } from "./blueprint-f1-runtime.ts";

type QueryError = { message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: QueryError }>;
type DbLike = { from: (table: string) => any };

export async function persistBlueprintSpecs(
  svc: DbLike,
  tenantId: string,
  documentId: string,
  pageIdByNumber: Map<number, string>,
  specs: BlueprintSpecCandidate[],
): Promise<number> {
  const { data: existing, error } = await svc.from("plan_specs").select("page_id,category,key_name,value_text,status")
    .eq("document_id", documentId).eq("tenant_id", tenantId);
  if (error) throw new Error(`f1_specs_read_failed: ${error.message ?? "unknown"}`);

  const protectedKeys = new Set((existing ?? [])
    .filter((r: any) => r.status === "confirmed" || r.status === "dismissed")
    .map((r: any) => `${r.page_id ?? ""}|${r.category}|${r.key_name}|${r.value_text ?? ""}`));

  // Replace only this deterministic runtime's pending detections. User-reviewed rows survive.
  const { error: deleteError } = await svc.from("plan_specs").delete()
    .eq("document_id", documentId).eq("tenant_id", tenantId)
    .eq("source", "deterministic_pdf_text").eq("status", "detected");
  if (deleteError) throw new Error(`f1_specs_cleanup_failed: ${deleteError.message ?? "unknown"}`);

  const rows = specs.map(spec => {
    const pageId = pageIdByNumber.get(spec.page_number) ?? null;
    return {
      tenant_id: tenantId, document_id: documentId, page_id: pageId,
      category: spec.category, key_name: spec.key_name, value_text: spec.value_text,
      normalized_value: spec.normalized_value, confidence: spec.confidence,
      source_text: spec.source_text, bbox: spec.bbox,
      source_viewport_key: spec.viewport_key, source: "deterministic_pdf_text",
      status: "detected", approved: false,
    };
  }).filter(row => !protectedKeys.has(`${row.page_id ?? ""}|${row.category}|${row.key_name}|${row.value_text ?? ""}`));

  if (!rows.length) return 0;
  const { error: insertError } = await svc.from("plan_specs").insert(rows);
  if (insertError) throw new Error(`f1_specs_insert_failed: ${insertError.message ?? "unknown"}`);
  return rows.length;
}

export async function persistBlueprintDimensions(
  svc: DbLike,
  tenantId: string,
  pageIdByNumber: Map<number, string>,
  dimensions: DimensionCandidate[],
): Promise<number> {
  const pageIds = [...pageIdByNumber.values()];
  if (pageIds.length) {
    const { error: cleanupError } = await svc.from("plan_dimensions").delete()
      .in("page_id", pageIds).eq("tenant_id", tenantId)
      .eq("source", "explicit_dimension_text").eq("status", "detected");
    if (cleanupError) throw new Error(`f1_dimensions_cleanup_failed: ${cleanupError.message ?? "unknown"}`);
  }

  const rows = dimensions.flatMap(dim => {
    const pageId = pageIdByNumber.get(dim.page_number);
    if (!pageId) return [];
    return [{
      tenant_id: tenantId, page_id: pageId, label_text: dim.label_text,
      normalized_feet: dim.normalized_feet, bbox: dim.bbox, confidence: dim.confidence,
      source_text: dim.label_text, source_viewport_key: dim.viewport_key,
      scale_snapshot: null, source: dim.source, status: "detected",
    }];
  });
  if (!rows.length) return 0;
  const { error } = await svc.from("plan_dimensions").insert(rows);
  if (error) throw new Error(`f1_dimensions_insert_failed: ${error.message ?? "unknown"}`);
  return rows.length;
}

export async function persistBlueprintSpecDimensionCandidates(
  svc: DbLike,
  tenantId: string,
  documentId: string,
  result: BlueprintF1RuntimeResult,
): Promise<{ specifications_inserted: number; dimensions_inserted: number }> {
  const { data: pages, error } = await svc.from("plan_pages").select("id,page_number")
    .eq("document_id", documentId).eq("tenant_id", tenantId);
  if (error) throw new Error(`f1_plan_page_lookup_failed: ${error.message ?? "unknown"}`);
  const pageIdByNumber = new Map((pages ?? []).map((page: any) => [page.page_number as number, page.id as string]));
  const specificationsInserted = await persistBlueprintSpecs(svc, tenantId, documentId, pageIdByNumber, result.specifications);
  const dimensionsInserted = await persistBlueprintDimensions(svc, tenantId, pageIdByNumber, result.dimensions);
  return { specifications_inserted: specificationsInserted, dimensions_inserted: dimensionsInserted };
}
