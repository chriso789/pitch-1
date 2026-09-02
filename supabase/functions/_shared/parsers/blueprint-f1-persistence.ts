// Persistence adapter for Blueprint F1 runtime output.
// Keeps DB mechanics out of the extraction/intelligence modules and protects
// user-reviewed sheet-index rows from deterministic reruns.

import type { BlueprintF1RuntimeResult } from "./blueprint-f1-runtime.ts";

export interface F1PersistenceSummary {
  page_rows_upserted: number;
  sheet_index_rows_upserted: number;
  protected_reviewed_index_rows: number;
}

type QueryError = { message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: QueryError }>;
type DbLike = {
  from: (table: string) => {
    select: (...args: unknown[]) => unknown;
    upsert: (...args: unknown[]) => unknown;
  };
};

// The Supabase fluent builder is intentionally duck-typed here because this
// shared Edge module runs under Deno and the repo has multiple client versions.
// Runtime checks/errors remain explicit at every write boundary.
export async function persistBlueprintF1Result(
  svc: DbLike,
  tenantId: string,
  documentId: string,
  result: BlueprintF1RuntimeResult,
): Promise<F1PersistenceSummary> {
  const pageRows = result.pages.map((page) => ({
    tenant_id: tenantId,
    document_id: documentId,
    ...page,
  }));

  const pageBuilder = svc.from("plan_pages").upsert(pageRows, { onConflict: "document_id,page_number" }) as {
    select: (columns: string) => QueryResult<Array<{ id: string; page_number: number }>>;
  };
  const { data: persistedPages, error: pageError } = await pageBuilder.select("id,page_number");
  if (pageError) throw new Error(`f1_plan_pages_upsert_failed: ${pageError.message ?? "unknown"}`);

  const pageIdByNumber = new Map((persistedPages ?? []).map((page) => [page.page_number, page.id]));

  const existingBuilder = svc.from("plan_sheet_index_entries").select("sheet_number,status") as {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => QueryResult<Array<{ sheet_number: string; status: string }>>;
    };
  };
  const { data: existingRows, error: existingError } = await existingBuilder
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  if (existingError) throw new Error(`f1_sheet_index_read_failed: ${existingError.message ?? "unknown"}`);

  const protectedStatuses = new Map(
    (existingRows ?? [])
      .filter((row) => row.status === "confirmed" || row.status === "dismissed")
      .map((row) => [row.sheet_number, row.status]),
  );

  const indexRows = result.sheet_index_entries
    .filter((entry) => !protectedStatuses.has(entry.sheet_number))
    .map((entry) => ({
      tenant_id: tenantId,
      document_id: documentId,
      source_page_id: pageIdByNumber.get(entry.source_page_number) ?? null,
      sheet_number: entry.sheet_number,
      sheet_title: entry.sheet_title,
      discipline: entry.discipline,
      confidence: entry.confidence,
      source_text: entry.source_text,
      bbox: entry.bbox,
      status: entry.status,
      metadata: entry.metadata,
    }));

  if (indexRows.length) {
    const indexBuilder = svc.from("plan_sheet_index_entries").upsert(indexRows, {
      onConflict: "document_id,sheet_number",
    }) as {
      select: (columns: string) => QueryResult<Array<{ id: string }>>;
    };
    const { error: indexError } = await indexBuilder.select("id");
    if (indexError) throw new Error(`f1_sheet_index_upsert_failed: ${indexError.message ?? "unknown"}`);
  }

  return {
    page_rows_upserted: pageRows.length,
    sheet_index_rows_upserted: indexRows.length,
    protected_reviewed_index_rows: protectedStatuses.size,
  };
}
