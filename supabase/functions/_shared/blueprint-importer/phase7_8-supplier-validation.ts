// Blueprint Importer v2 — Phase 7.8 supplier catalog tenant-join validator.
//
// PURE function. No DB IO. No mutation of supplier_catalogs or supplier_catalog_items.
// Implements the Phase 7.7 supplier tenant-scope contract:
//   supplier_catalog_items has no tenant_id; it MUST join through
//   supplier_catalogs.<tenant_attribution>. Caller fetches that join row.
//
// IMPORTANT runtime defect surfaced by Phase 7.8 inspection:
//   In production today, `supplier_catalogs` has no `tenant_id` column. Until
//   tenant attribution exists on `supplier_catalogs` (or a tenant-mapping
//   table), every supplier_catalog target is hard-blocked with
//   SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED. Validator does not infer tenancy
//   from `company_id` or any other column.

export const PHASE_7_8_SUPPLIER_VALIDATOR_VERSION = "v2.0-supplier-phase-7.8" as const;

export const PHASE_7_8_SUPPLIER_BLOCKER_CODES = [
  "SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED",
  "SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH",
  "SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED",
  "SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED",
  "SUPPLIER_CATALOG_ITEM_INACTIVE",
  "SUPPLIER_CATALOG_ITEM_COST_MISSING",
  "ZERO_DEFAULT_PRICING_UNSAFE",
] as const;
export type Phase7_8SupplierBlockerCode =
  typeof PHASE_7_8_SUPPLIER_BLOCKER_CODES[number];

export interface SupplierCatalogItemSnapshot {
  /** supplier_catalog_items.id */
  id: string | null;
  /** supplier_catalog_items.catalog_id (FK -> supplier_catalogs.id) */
  catalog_id: string | null;
  sku: string | null;
  /** Cost-bearing column on supplier_catalog_items. */
  base_price: number | null;
  uom: string | null;
  active: boolean | null;
}

export interface SupplierCatalogSnapshot {
  /** supplier_catalogs.id */
  id: string | null;
  /** Tenant attribution column. NULL means no tenant attribution exists. */
  tenant_id: string | null;
  active: boolean | null;
}

export interface SupplierValidationInput {
  candidate_tenant_id: string;
  /** Binding-level unit_cost fallback, if any. */
  binding_unit_cost: number | null;
  item: SupplierCatalogItemSnapshot | null;
  catalog: SupplierCatalogSnapshot | null;
}

export interface SupplierValidationResult {
  validator_version: typeof PHASE_7_8_SUPPLIER_VALIDATOR_VERSION;
  ok: boolean;
  tenant_join_verified: boolean;
  active_verified: boolean;
  cost_verified: boolean;
  cost_source: "binding.unit_cost" | "supplier_catalog_items.base_price" | null;
  trusted_unit_cost: number | null;
  blockers: Phase7_8SupplierBlockerCode[];
  notes: string[];
}

export function validateSupplierCatalogTarget(
  input: SupplierValidationInput,
): SupplierValidationResult {
  const blockers: Phase7_8SupplierBlockerCode[] = [];
  const notes: string[] = [];

  // 1. Catalog FK presence on the item.
  if (!input.item || !input.item.catalog_id) {
    blockers.push("SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED");
    notes.push("supplier_catalog_items.catalog_id is missing — cannot join to supplier_catalogs.");
  }

  // 2. supplier_catalogs row presence.
  if (!input.catalog || !input.catalog.id) {
    blockers.push("SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED");
    notes.push("supplier_catalogs row is missing for catalog_id.");
  } else if (input.item && input.item.catalog_id && input.item.catalog_id !== input.catalog.id) {
    blockers.push("SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED");
    notes.push("supplier_catalog_items.catalog_id does not match supplier_catalogs.id snapshot.");
  }

  // 3. Tenant attribution. supplier_catalogs.tenant_id must exist and match.
  let tenantJoinVerified = false;
  if (input.catalog) {
    if (input.catalog.tenant_id == null) {
      blockers.push("SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED");
      notes.push("supplier_catalogs has no tenant attribution — cannot prove tenant safety.");
    } else if (input.catalog.tenant_id !== input.candidate_tenant_id) {
      blockers.push("SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH");
      notes.push("supplier_catalogs.tenant_id does not match candidate tenant_id.");
    } else {
      tenantJoinVerified = true;
    }
  } else {
    blockers.push("SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED");
  }

  // 4. Active status.
  let activeVerified = false;
  if (input.item && input.item.active === false) {
    blockers.push("SUPPLIER_CATALOG_ITEM_INACTIVE");
  } else if (input.catalog && input.catalog.active === false) {
    blockers.push("SUPPLIER_CATALOG_ITEM_INACTIVE");
  } else if (input.item && input.item.active === true && (!input.catalog || input.catalog.active !== false)) {
    activeVerified = true;
  }

  // 5. Cost resolution (binding wins; zero is unsafe).
  let costSource: SupplierValidationResult["cost_source"] = null;
  let trustedCost: number | null = null;
  if (typeof input.binding_unit_cost === "number" && input.binding_unit_cost > 0) {
    costSource = "binding.unit_cost";
    trustedCost = input.binding_unit_cost;
  } else if (input.item && typeof input.item.base_price === "number" && input.item.base_price > 0) {
    costSource = "supplier_catalog_items.base_price";
    trustedCost = input.item.base_price;
  } else if (
    (typeof input.binding_unit_cost === "number" && input.binding_unit_cost === 0) ||
    (input.item && typeof input.item.base_price === "number" && input.item.base_price === 0)
  ) {
    blockers.push("ZERO_DEFAULT_PRICING_UNSAFE");
    blockers.push("SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED");
    notes.push("Zero unit_cost is rejected (estimate_line_items.unit_cost is NOT NULL but zero is unsafe).");
  } else {
    blockers.push("SUPPLIER_CATALOG_ITEM_COST_MISSING");
    blockers.push("SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED");
  }

  const ok = blockers.length === 0;
  return {
    validator_version: PHASE_7_8_SUPPLIER_VALIDATOR_VERSION,
    ok,
    tenant_join_verified: tenantJoinVerified,
    active_verified: activeVerified,
    cost_verified: trustedCost !== null && trustedCost > 0,
    cost_source: costSource,
    trusted_unit_cost: trustedCost,
    blockers: Array.from(new Set(blockers)),
    notes,
  };
}
