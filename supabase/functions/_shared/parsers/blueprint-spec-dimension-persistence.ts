// Persistence adapter for F1E/F1F specification and dimension candidates.
// Protects confirmed/dismissed rows and keeps deterministic reruns review-safe.

import type { BlueprintSpecCandidate } from "./blueprint-spec-intelligence.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";

type QueryError = { message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: QueryError }>;
type DbLike = { from: (table: string) => { select: (...args: unknown[]) => unknown; insert: (...args: unknown[]) => unknown } };

export async function persistBlueprintSpecs(
  svc: DbLike,
  tenantId: string,
  documentId: string,
  pageIdByNumber: Map<number, string>,
  specs: BlueprintSpecCandidate[],
): Promise<number> {
  const existingBuilder = svc.from("plan_specs").select("page_id,category,key_name,value_text,status") as {
    eq: (column: string, value: string) => { eq: (column: string, value: string) => QueryResult<Array<{ page_id: string | null; category: string; key_name: string; value_text: string | null; status: string }>> };
  };
  const { data: existing, error } = await existingBuilder.eq("document_id", documentId).eq("tenant_id", tenantId);
  if (error) throw new Error(`f1_specs_read_failed: ${error.message ?? "unknown"}`);
  const protectedKeys = new Set((existing ?? []).filter(r => r.status === "confirmed" || r.status === "dismissed").map(r => `${r.page_id ?? ""}|${r.category}|${r.key_name}|${r.value_text ?? ""}`));

  const rows = specs.map(spec => {
    const pageId = pageIdByNumber.get(spec.page_number) ?? null;
    return { tenant_id: tenantId, document_id: documentId, page_id: pageId, category: spec.category, key_name: spec.key_name, value_text: spec.value_text, normalized_value: spec.normalized_value, confidence: spec.confidence, source_text: spec.source_text, bbox: spec.bbox, source_viewport_key: spec.viewport_key, source: "deterministic_pdf_text", status: "detected", approved: false };
  }).filter(row => !protectedKeys.has(`${row.page_id ?? ""}|${row.category}|${row.key_name}|${row.value_text ?? ""}`));

  if (!rows.length) return 0;
  const insert = svc.from("plan_specs").insert(rows) as QueryResult<unknown>;
  const { error: insertError } = await insert;
  if (insertError) throw new Error(`f1_specs_insert_failed: ${insertError.message ?? "unknown"}`);
  return rows.length;
}

export async function persistBlueprintDimensions(
  svc: DbLike,
  tenantId: string,
  pageIdByNumber: Map<number, string>,
  dimensions: DimensionCandidate[],
): Promise<number> {
  const rows = dimensions.flatMap(dim => {
    const pageId = pageIdByNumber.get(dim.page_number);
    if (!pageId) return [];
    return [{ tenant_id: tenantId, page_id: pageId, label_text: dim.label_text, normalized_feet: dim.normalized_feet, bbox: dim.bbox, confidence: dim.confidence, source_text: dim.label_text, source_viewport_key: dim.viewport_key, scale_snapshot: null, source: dim.source, status: "detected" }];
  });
  if (!rows.length) return 0;
  const insert = svc.from("plan_dimensions").insert(rows) as QueryResult<unknown>;
  const { error } = await insert;
  if (error) throw new Error(`f1_dimensions_insert_failed: ${error.message ?? "unknown"}`);
  return rows.length;
}
