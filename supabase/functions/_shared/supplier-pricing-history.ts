// Minimal server-side helper for recording supplier pricing pulls.
//
// Contract:
// - Caller MUST pass a tenant_id that was resolved server-side from the JWT
//   (via _shared/auth-tenant.ts). Never accept tenant_id from request body.
// - All inserts go through the service-role client. RLS on
//   supplier_price_history blocks all non-service writes by design
//   (append-only).
// - Use startPricingRun() before any supplier calls, then
//   recordPriceHistory() per line, then completePricingRun() at the end.
//
// This helper does NOT call any supplier API. Wiring ABC / SRS / QXO
// price pulls happens in their respective grouped edge functions
// (supplier-api/abc, supplier-api/srs, supplier-api/qxo) one supplier
// at a time.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type SupplierKey = "abc" | "srs" | "qxo";

export type PricingSourceContext = "template" | "estimate" | "project" | "order";

export type PricingRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "partial"
  | "cancelled";

export type PriceHistoryStatus =
  | "ok"
  | "error"
  | "partial"
  | "unavailable"
  | "override";

export interface StartPricingRunInput {
  tenant_id: string;                   // REQUIRED — resolved server-side
  supplier: SupplierKey | string;
  source_context: PricingSourceContext;
  source_id?: string | null;
  environment?: string | null;         // "sandbox" | "production" | provider-specific
  account_number?: string | null;
  ship_to_number?: string | null;
  branch_number?: string | null;
  job_account_number?: string | null;
  created_by?: string | null;          // auth.uid() of initiator
  metadata?: Record<string, unknown>;
}

export interface CompletePricingRunInput {
  status: Exclude<PricingRunStatus, "running">;
  error_summary?: string | null;
  metadata_patch?: Record<string, unknown>;
}

export interface PriceHistoryLineInput {
  tenant_id: string;                   // REQUIRED — must match the run's tenant
  pricing_run_id?: string | null;
  supplier: SupplierKey | string;

  // Source linkage (any combination; all optional)
  template_id?: string | null;
  template_item_id?: string | null;
  estimate_id?: string | null;
  estimate_line_item_id?: string | null;
  purchase_order_id?: string | null;
  purchase_order_item_id?: string | null;

  // Line snapshot
  supplier_item_number?: string | null;
  supplier_item_description?: string | null;
  uom?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  extended_price?: number | null;
  availability?: string | null;

  // Account context echoed from the run for fast lookups
  account_number?: string | null;
  ship_to_number?: string | null;
  branch_number?: string | null;
  job_account_number?: string | null;

  price_source?: string | null;        // e.g. "abc_price_items" | "override" | "catalog"
  raw_response?: Record<string, unknown> | unknown[] | null;
  status?: PriceHistoryStatus;
  created_by?: string | null;
}

function assertTenant(tenant_id: string | undefined | null, where: string) {
  if (!tenant_id || typeof tenant_id !== "string" || tenant_id.length < 16) {
    throw new Error(
      `[supplier-pricing-history.${where}] tenant_id is required and must be resolved server-side from JWT`,
    );
  }
}

/**
 * Open a pricing run. Returns the run id.
 * Always insert with the service-role client (passed in).
 */
export async function startPricingRun(
  supabase: SupabaseClient,
  input: StartPricingRunInput,
): Promise<{ id: string }> {
  assertTenant(input.tenant_id, "startPricingRun");
  const row = {
    tenant_id: input.tenant_id,
    supplier: input.supplier,
    source_context: input.source_context,
    source_id: input.source_id ?? null,
    environment: input.environment ?? null,
    account_number: input.account_number ?? null,
    ship_to_number: input.ship_to_number ?? null,
    branch_number: input.branch_number ?? null,
    job_account_number: input.job_account_number ?? null,
    status: "running" as PricingRunStatus,
    created_by: input.created_by ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("supplier_pricing_runs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`startPricingRun failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

/**
 * Append a single price-history row. Append-only — never updates.
 * tenant_id MUST be the same resolved value passed to startPricingRun.
 */
export async function recordPriceHistory(
  supabase: SupabaseClient,
  line: PriceHistoryLineInput,
): Promise<{ id: string }> {
  assertTenant(line.tenant_id, "recordPriceHistory");
  const row = {
    tenant_id: line.tenant_id,
    pricing_run_id: line.pricing_run_id ?? null,
    supplier: line.supplier,
    template_id: line.template_id ?? null,
    template_item_id: line.template_item_id ?? null,
    estimate_id: line.estimate_id ?? null,
    estimate_line_item_id: line.estimate_line_item_id ?? null,
    purchase_order_id: line.purchase_order_id ?? null,
    purchase_order_item_id: line.purchase_order_item_id ?? null,
    supplier_item_number: line.supplier_item_number ?? null,
    supplier_item_description: line.supplier_item_description ?? null,
    uom: line.uom ?? null,
    quantity: line.quantity ?? null,
    unit_price: line.unit_price ?? null,
    extended_price: line.extended_price ?? null,
    availability: line.availability ?? null,
    account_number: line.account_number ?? null,
    ship_to_number: line.ship_to_number ?? null,
    branch_number: line.branch_number ?? null,
    job_account_number: line.job_account_number ?? null,
    price_source: line.price_source ?? null,
    raw_response: line.raw_response ?? {},
    status: line.status ?? "ok",
    created_by: line.created_by ?? null,
  };
  const { data, error } = await supabase
    .from("supplier_price_history")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`recordPriceHistory failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

/**
 * Bulk variant: insert many history rows in a single call. All rows must
 * share the same tenant_id (enforced here, not just in SQL).
 */
export async function recordPriceHistoryBulk(
  supabase: SupabaseClient,
  lines: PriceHistoryLineInput[],
): Promise<{ inserted: number }> {
  if (!lines.length) return { inserted: 0 };
  const tenantId = lines[0].tenant_id;
  assertTenant(tenantId, "recordPriceHistoryBulk");
  for (const l of lines) {
    if (l.tenant_id !== tenantId) {
      throw new Error(
        "recordPriceHistoryBulk: all lines must share the same tenant_id",
      );
    }
  }
  const rows = lines.map((line) => ({
    tenant_id: line.tenant_id,
    pricing_run_id: line.pricing_run_id ?? null,
    supplier: line.supplier,
    template_id: line.template_id ?? null,
    template_item_id: line.template_item_id ?? null,
    estimate_id: line.estimate_id ?? null,
    estimate_line_item_id: line.estimate_line_item_id ?? null,
    purchase_order_id: line.purchase_order_id ?? null,
    purchase_order_item_id: line.purchase_order_item_id ?? null,
    supplier_item_number: line.supplier_item_number ?? null,
    supplier_item_description: line.supplier_item_description ?? null,
    uom: line.uom ?? null,
    quantity: line.quantity ?? null,
    unit_price: line.unit_price ?? null,
    extended_price: line.extended_price ?? null,
    availability: line.availability ?? null,
    account_number: line.account_number ?? null,
    ship_to_number: line.ship_to_number ?? null,
    branch_number: line.branch_number ?? null,
    job_account_number: line.job_account_number ?? null,
    price_source: line.price_source ?? null,
    raw_response: line.raw_response ?? {},
    status: line.status ?? "ok",
    created_by: line.created_by ?? null,
  }));
  const { error, count } = await supabase
    .from("supplier_price_history")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(`recordPriceHistoryBulk failed: ${error.message}`);
  return { inserted: count ?? rows.length };
}

/**
 * Close a pricing run. Sets completed_at and final status. Optionally
 * merges metadata.
 */
export async function completePricingRun(
  supabase: SupabaseClient,
  runId: string,
  input: CompletePricingRunInput,
): Promise<void> {
  if (!runId) throw new Error("completePricingRun: runId is required");

  // Optional metadata merge — read current, then patch. Service role only.
  let mergedMetadata: Record<string, unknown> | undefined;
  if (input.metadata_patch && Object.keys(input.metadata_patch).length) {
    const { data: current, error: readErr } = await supabase
      .from("supplier_pricing_runs")
      .select("metadata")
      .eq("id", runId)
      .maybeSingle();
    if (readErr) {
      throw new Error(`completePricingRun read failed: ${readErr.message}`);
    }
    const currentMeta =
      (current?.metadata as Record<string, unknown> | undefined) ?? {};
    mergedMetadata = { ...currentMeta, ...input.metadata_patch };
  }

  const patch: Record<string, unknown> = {
    status: input.status,
    completed_at: new Date().toISOString(),
    error_summary: input.error_summary ?? null,
  };
  if (mergedMetadata) patch.metadata = mergedMetadata;

  const { error } = await supabase
    .from("supplier_pricing_runs")
    .update(patch)
    .eq("id", runId);
  if (error) throw new Error(`completePricingRun failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// SKU mapping gate
//
// Pricing routes MUST consult template_item_supplier_mappings before calling
// any supplier price API. If a template_item is not approved for the supplier
// (or the approved SKU field is null), we DO NOT call the supplier — we just
// write an `unavailable` history row tagged with the reason so the run is
// honest about why nothing came back.
// ---------------------------------------------------------------------------

export interface SupplierMappingRow {
  id: string;
  template_item_id: string;
  supplier: SupplierKey | string;
  supplier_item_number: string | null;
  supplier_product_id: string | null;
  supplier_item_description: string | null;
  valid_uoms: string[];
  default_uom: string | null;
  branch_scope: string[];
  account_scope: string[];
  ship_to_scope: string[];
  availability_status: string | null;
  mapping_status:
    | "unmapped"
    | "auto_matched"
    | "needs_review"
    | "approved"
    | "rejected";
  match_confidence: number | null;
  last_checked_at: string | null;
}

export type MappingGateDecision =
  | {
      kind: "approved";
      mapping: SupplierMappingRow;
      sku: string;
      uom: string;
    }
  | {
      kind: "skip";
      reason:
        | "mapping_missing"
        | "mapping_needs_review"
        | "mapping_rejected"
        | "mapping_missing_sku"
        | "uom_not_in_valid_set"
        | "branch_out_of_scope";
      mapping: SupplierMappingRow | null;
    };

/** Load mappings keyed by template_item_id for (tenant, supplier). */
export async function loadSupplierMappingsForTemplateItems(
  supabase: SupabaseClient,
  args: {
    tenant_id: string;
    supplier: SupplierKey | string;
    template_item_ids: string[];
  },
): Promise<Map<string, SupplierMappingRow>> {
  assertTenant(args.tenant_id, "loadSupplierMappingsForTemplateItems");
  const ids = Array.from(
    new Set(args.template_item_ids.filter((x) => typeof x === "string" && x)),
  );
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("template_item_supplier_mappings")
    .select(
      "id, template_item_id, supplier, supplier_item_number, supplier_product_id, supplier_item_description, valid_uoms, default_uom, branch_scope, account_scope, ship_to_scope, availability_status, mapping_status, match_confidence, last_checked_at",
    )
    .eq("tenant_id", args.tenant_id)
    .eq("supplier", args.supplier)
    .in("template_item_id", ids);
  if (error) {
    throw new Error(
      `loadSupplierMappingsForTemplateItems failed: ${error.message}`,
    );
  }
  const map = new Map<string, SupplierMappingRow>();
  for (const row of (data ?? []) as SupplierMappingRow[]) {
    map.set(row.template_item_id, row);
  }
  return map;
}

/** Decide whether a line is safe to send to the supplier price API. */
export function evaluateMappingGate(args: {
  mapping: SupplierMappingRow | null | undefined;
  requested_uom?: string | null;
  branch_number?: string | null;
}): MappingGateDecision {
  const m = args.mapping ?? null;
  if (!m) return { kind: "skip", reason: "mapping_missing", mapping: null };
  if (m.mapping_status === "rejected") {
    return { kind: "skip", reason: "mapping_rejected", mapping: m };
  }
  if (m.mapping_status !== "approved") {
    return { kind: "skip", reason: "mapping_needs_review", mapping: m };
  }
  const sku = (m.supplier_item_number ?? "").trim();
  if (!sku) {
    return { kind: "skip", reason: "mapping_missing_sku", mapping: m };
  }
  if (
    Array.isArray(m.branch_scope) &&
    m.branch_scope.length > 0 &&
    args.branch_number &&
    !m.branch_scope.includes(args.branch_number)
  ) {
    return { kind: "skip", reason: "branch_out_of_scope", mapping: m };
  }
  const uom = String(
    args.requested_uom || m.default_uom || (m.valid_uoms?.[0] ?? "EA"),
  ).toUpperCase();
  if (
    Array.isArray(m.valid_uoms) &&
    m.valid_uoms.length > 0 &&
    !m.valid_uoms.map((u) => u.toUpperCase()).includes(uom)
  ) {
    return { kind: "skip", reason: "uom_not_in_valid_set", mapping: m };
  }
  return { kind: "approved", mapping: m, sku, uom };
}

/** Map a gate skip reason → price_source token persisted on price history. */
export function priceSourceForSkip(
  reason: Exclude<MappingGateDecision, { kind: "approved" }>["reason"],
): string {
  switch (reason) {
    case "mapping_missing":
      return "mapping_missing";
    case "mapping_needs_review":
      return "mapping_needs_review";
    case "mapping_rejected":
      return "mapping_rejected";
    case "mapping_missing_sku":
      return "mapping_missing_sku";
    case "uom_not_in_valid_set":
      return "mapping_uom_invalid";
    case "branch_out_of_scope":
      return "mapping_branch_out_of_scope";
  }
}
