// Blueprint Importer v2 — Phase 7.8 ABC price-source validator.
//
// PURE function. No DB IO. No mutation of abc_catalog_items or any webhook
// price-row table. Implements the Phase 7.7 ABC pricing-source contract:
//
//   - abc_catalog_items identifies the item only. Item presence alone is NOT
//     proof of price readiness.
//   - ABC pricing MUST come from:
//       (a) a tenant-scoped, fresh, unambiguous webhook price row, OR
//       (b) an explicit positive binding.unit_cost fallback that requires
//           user confirmation.
//   - Zero values are never trusted.
//   - The validator does not infer pricing from item name/category.

export const PHASE_7_8_ABC_VALIDATOR_VERSION = "v2.0-abc-phase-7.8" as const;

export const PHASE_7_8_ABC_BLOCKER_CODES = [
  "ABC_PRICE_SOURCE_REQUIRED",
  "ABC_PRICE_ROW_MISSING",
  "ABC_PRICE_ROW_STALE",
  "ABC_PRICE_SOURCE_TENANT_UNVERIFIED",
  "ABC_PRICE_ROW_AMBIGUOUS",
  "ZERO_DEFAULT_PRICING_UNSAFE",
] as const;
export type Phase7_8AbcBlockerCode = typeof PHASE_7_8_ABC_BLOCKER_CODES[number];

export const PHASE_7_8_ABC_WARNING_CODES = [
  "ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION",
] as const;
export type Phase7_8AbcWarningCode = typeof PHASE_7_8_ABC_WARNING_CODES[number];

export interface AbcItemSnapshot {
  item_number: string | null;
  is_active: boolean | null;
}

export interface AbcWebhookPriceRow {
  /** Row PK (used for ambiguity detection). */
  id: string;
  tenant_id: string | null;
  abc_item_number: string;
  price: number | null;
  uom: string | null;
  /** ISO timestamp of when the price was emitted by ABC webhook. */
  priced_at: string | null;
}

export interface AbcValidationInput {
  candidate_tenant_id: string;
  /** Max age in ms before a webhook price row is considered stale. */
  staleness_ms: number;
  /** Stable "now" injected by caller. */
  now: () => string;
  /** ABC item row (global table). */
  item: AbcItemSnapshot | null;
  /** All tenant-scoped webhook price rows for this abc_item_number. */
  webhook_price_rows: AbcWebhookPriceRow[];
  /** Optional binding.unit_cost fallback. */
  binding_unit_cost: number | null;
  /** True when the operator has explicitly confirmed the binding fallback. */
  binding_unit_cost_user_confirmed: boolean;
}

export interface AbcValidationResult {
  validator_version: typeof PHASE_7_8_ABC_VALIDATOR_VERSION;
  ok: boolean;
  price_source: "webhook_price_row" | "binding.unit_cost" | null;
  trusted_unit_cost: number | null;
  trusted_price_row_id: string | null;
  blockers: Phase7_8AbcBlockerCode[];
  warnings: Phase7_8AbcWarningCode[];
  notes: string[];
}

export function validateAbcPriceSource(input: AbcValidationInput): AbcValidationResult {
  const blockers: Phase7_8AbcBlockerCode[] = [];
  const warnings: Phase7_8AbcWarningCode[] = [];
  const notes: string[] = [];

  if (!input.item || !input.item.item_number) {
    blockers.push("ABC_PRICE_SOURCE_REQUIRED");
    notes.push("abc_catalog_items snapshot missing — cannot verify price source.");
  }

  const tenantRows = (input.webhook_price_rows || []).filter(
    (r) => r.tenant_id === input.candidate_tenant_id &&
           r.abc_item_number &&
           input.item &&
           r.abc_item_number === input.item.item_number,
  );

  const nowMs = Date.parse(input.now());
  let chosen: AbcWebhookPriceRow | null = null;
  if (tenantRows.length === 0 && input.webhook_price_rows.length > 0) {
    blockers.push("ABC_PRICE_SOURCE_TENANT_UNVERIFIED");
  }
  if (tenantRows.length > 1) {
    blockers.push("ABC_PRICE_ROW_AMBIGUOUS");
    notes.push(`Found ${tenantRows.length} tenant-scoped price rows for the same ABC item.`);
  } else if (tenantRows.length === 1) {
    const row = tenantRows[0];
    if (!row.priced_at) {
      blockers.push("ABC_PRICE_ROW_STALE");
    } else {
      const age = nowMs - Date.parse(row.priced_at);
      if (!Number.isFinite(age) || age > input.staleness_ms) {
        blockers.push("ABC_PRICE_ROW_STALE");
      } else if (typeof row.price !== "number" || row.price <= 0) {
        if (row.price === 0) blockers.push("ZERO_DEFAULT_PRICING_UNSAFE");
        else blockers.push("ABC_PRICE_ROW_MISSING");
      } else {
        chosen = row;
      }
    }
  }

  let priceSource: AbcValidationResult["price_source"] = null;
  let trustedCost: number | null = null;
  let trustedRowId: string | null = null;

  if (chosen) {
    priceSource = "webhook_price_row";
    trustedCost = chosen.price as number;
    trustedRowId = chosen.id;
  } else if (typeof input.binding_unit_cost === "number") {
    if (input.binding_unit_cost <= 0) {
      blockers.push("ZERO_DEFAULT_PRICING_UNSAFE");
    } else if (!input.binding_unit_cost_user_confirmed) {
      warnings.push("ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION");
      blockers.push("ABC_PRICE_SOURCE_REQUIRED");
    } else {
      priceSource = "binding.unit_cost";
      trustedCost = input.binding_unit_cost;
    }
  } else if (!chosen) {
    if (!blockers.includes("ABC_PRICE_ROW_AMBIGUOUS") &&
        !blockers.includes("ABC_PRICE_SOURCE_TENANT_UNVERIFIED") &&
        !blockers.includes("ABC_PRICE_ROW_STALE")) {
      blockers.push("ABC_PRICE_ROW_MISSING");
    }
  }

  const ok = blockers.length === 0 && trustedCost !== null && trustedCost > 0;
  return {
    validator_version: PHASE_7_8_ABC_VALIDATOR_VERSION,
    ok,
    price_source: priceSource,
    trusted_unit_cost: trustedCost,
    trusted_price_row_id: trustedRowId,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    notes,
  };
}
