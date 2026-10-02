// Persistence adapter for Blueprint F1 runtime output.
// Keeps DB mechanics out of the extraction/intelligence modules and protects
// user-reviewed sheet-index / viewport rows from deterministic reruns.

import type { BlueprintF1RuntimeResult } from "./blueprint-f1-runtime.ts";

export interface F1PersistenceSummary {
  page_rows_upserted: number;
  sheet_index_rows_upserted: number;
  protected_reviewed_index_rows: number;
  viewport_rows_upserted: number;
  protected_reviewed_viewport_rows: number;
  reference_rows_replaced: number;
}

type QueryError = { message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: QueryError }>;
type DbLike = { from: (table: string) => unknown };

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

  const pageTable = svc.from("plan_pages") as {
    upsert: (rows: unknown, options: unknown) => {
      select: (columns: string) => QueryResult<Array<{ id: string; page_number: number }>>;
    };
  };
  const { data: persistedPages, error: pageError } = await pageTable
    .upsert(pageRows, { onConflict: "document_id,page_number" })
    .select("id,page_number");
  if (pageError) throw new Error(`f1_plan_pages_upsert_failed: ${pageError.message ?? "unknown"}`);

  const pageIdByNumber = new Map((persistedPages ?? []).map((page) => [page.page_number, page.id]));

  const indexTable = svc.from("plan_sheet_index_entries") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => QueryResult<Array<{ sheet_number: string; status: string }>>;
      };
    };
    upsert: (rows: unknown, options: unknown) => { select: (columns: string) => QueryResult<Array<{ id: string }>> };
  };
  const { data: existingIndexRows, error: existingIndexError } = await indexTable
    .select("sheet_number,status")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  if (existingIndexError) throw new Error(`f1_sheet_index_read_failed: ${existingIndexError.message ?? "unknown"}`);

  const protectedIndexStatuses = new Map(
    (existingIndexRows ?? [])
      .filter((row) => row.status === "confirmed" || row.status === "dismissed")
      .map((row) => [row.sheet_number, row.status]),
  );

  const indexRows = result.sheet_index_entries
    .filter((entry) => !protectedIndexStatuses.has(entry.sheet_number))
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
    const { error: indexError } = await indexTable
      .upsert(indexRows, { onConflict: "document_id,sheet_number" })
      .select("id");
    if (indexError) throw new Error(`f1_sheet_index_upsert_failed: ${indexError.message ?? "unknown"}`);
  }

  const viewportTable = svc.from("plan_drawing_viewports") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => QueryResult<Array<{ viewport_key: string; review_status: string }>>;
      };
    };
    upsert: (rows: unknown, options: unknown) => { select: (columns: string) => QueryResult<Array<{ id: string }>> };
  };
  const { data: existingViewportRows, error: existingViewportError } = await viewportTable
    .select("viewport_key,review_status")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  if (existingViewportError) throw new Error(`f1_viewport_read_failed: ${existingViewportError.message ?? "unknown"}`);

  const protectedViewportStatuses = new Map(
    (existingViewportRows ?? [])
      .filter((row) => row.review_status === "confirmed" || row.review_status === "rejected")
      .map((row) => [row.viewport_key, row.review_status]),
  );

  const viewportRows = result.drawing_viewports
    .filter((viewport) => !protectedViewportStatuses.has(viewport.viewport_key))
    .map((viewport) => ({
      tenant_id: tenantId,
      document_id: documentId,
      page_id: pageIdByNumber.get(viewport.source_page_number) ?? null,
      viewport_key: viewport.viewport_key,
      title: viewport.title,
      bbox: viewport.bbox,
      scale_json: viewport.scale,
      confidence: viewport.confidence,
      source: viewport.source,
      metadata: viewport.metadata,
      review_status: "pending",
    }))
    .filter((row) => Boolean(row.page_id));

  if (viewportRows.length) {
    const { error: viewportError } = await viewportTable
      .upsert(viewportRows, { onConflict: "document_id,viewport_key" })
      .select("id");
    if (viewportError) throw new Error(`f1_viewport_upsert_failed: ${viewportError.message ?? "unknown"}`);
  }

  // Reference rows are deterministic F1 output and plan_detail_refs has no unique
  // key suitable for upsert. Replace only rows owned by this runtime version so
  // legacy/manual references remain untouched.
  const refsTable = svc.from("plan_detail_refs") as {
    delete: () => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => QueryResult<unknown>;
        };
      };
    };
    insert: (rows: unknown) => { select: (columns: string) => QueryResult<Array<{ id: string }>> };
  };

  const { error: deleteRefsError } = await refsTable
    .delete()
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId)
    .eq("version", result.reference_version);
  if (deleteRefsError) throw new Error(`f1_reference_delete_failed: ${deleteRefsError.message ?? "unknown"}`);

  const analyzedByPage = new Map(result.analyzed_sheets.map((sheet) => [sheet.page_number, sheet]));
  const refRows = result.drawing_references.map((reference) => ({
    tenant_id: tenantId,
    document_id: documentId,
    source_page_id: pageIdByNumber.get(reference.source_page_number) ?? null,
    callout_text: reference.raw_text,
    target_sheet_number: reference.target_sheet_number,
    confidence: reference.confidence,
    source_viewport_key: reference.viewport_key,
    detail_number: reference.detail_number,
    reference_type: reference.reference_type,
    bbox: reference.bbox,
    version: result.reference_version,
    metadata: {
      ...reference.metadata,
      source_sheet_number: analyzedByPage.get(reference.source_page_number)?.sheet_number ?? null,
    },
  })).filter((row) => Boolean(row.source_page_id));

  if (refRows.length) {
    const { error: refInsertError } = await refsTable.insert(refRows).select("id");
    if (refInsertError) throw new Error(`f1_reference_insert_failed: ${refInsertError.message ?? "unknown"}`);
  }

  return {
    page_rows_upserted: pageRows.length,
    sheet_index_rows_upserted: indexRows.length,
    protected_reviewed_index_rows: protectedIndexStatuses.size,
    viewport_rows_upserted: viewportRows.length,
    protected_reviewed_viewport_rows: protectedViewportStatuses.size,
    reference_rows_replaced: refRows.length,
  };
}
