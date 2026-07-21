/**
 * ABC mapping resolver — the FINAL policy engine before pricing and ordering.
 *
 * Consumes the outputs of every upstream module (product normalizer, family
 * resolver, UOM validator, branch verifier, availability parser, pricing
 * parser) plus the contractor's canonical material line and the tenant's
 * approved mapping row, and produces a single deterministic decision:
 *
 *   - state         : approved | pricing_only | review_required | blocked
 *   - canPrice      : may we call ABC pricing for this line?
 *   - canOrder      : may we include this line on an ABC order payload?
 *   - repairReasons : machine-readable codes the UI/worker must repair
 *   - approved*     : the exact identity that survived every gate
 *
 * Additive only — no handler currently imports this module. The future
 * orderPayloadBuilder MUST refuse to build an order unless `state==="approved"`
 * AND `canOrder===true`. The builder must never re-derive this business logic.
 *
 * Never:
 *   - calls Supabase or ABC
 *   - mutates any input
 *   - invents an itemNumber, color, UOM, branch, price, or availability
 *   - promotes HTTP 200 to a pricing/order success
 *   - reuses a pricing run for a different tenant/ShipTo/Branch tuple
 */

import type {
  NormalizedAbcCatalogItem,
  ResolvedAbcChild,
} from "./types.ts";
import type { ValidatedAbcUomResult } from "./uomValidator.ts";
import type { BranchVerificationResult } from "./branchVerifier.ts";
import type { ParsedAbcAvailability } from "./availabilityParser.ts";
import type { ParsedAbcPricingLine } from "./pricingResponseParser.ts";

// ---------- Public types ----------

export interface CanonicalMaterialLine {
  /** Contractor line identifier (must match pricing requestLineId). */
  id: string;
  templateItemId?: string | null;
  estimateLineItemId?: string | null;
  description: string;
  /** If the contractor explicitly typed / picked an itemNumber, mark manual. */
  requestedItemNumber?: string | null;
  requestedColorDisplayName?: string | null;
  requestedUom: string;
  requestedQuantity: number;
  manualSku?: boolean;
  manualUom?: boolean;
  manualPrice?: boolean;
  manufacturerHint?: string | null;
  familyHint?: string | null;
}

export type ApprovedMappingStatus =
  | "approved"
  | "review_required"
  | "draft"
  | "stale";

export interface ApprovedMappingColor {
  displayName: string | null;
  rawName: string | null;
  code: string | null;
}

export interface ApprovedMapping {
  id: string;
  status: ApprovedMappingStatus;
  itemNumber: string;
  itemDescription: string | null;
  color: ApprovedMappingColor | null;
  uom: string;
  branchNumber: string;
  shipToNumber: string;
  /** ISO timestamp of last human approval. */
  approvedAt: string;
  /** Cached pricing captured at approval time. Never used to skip re-parse. */
  approvedPrice?: number | null;
  pricingRunId?: string | null;
  /** Set by the mapping UI when more than one candidate remained. */
  ambiguityCount?: number;
  manufacturerUncertain?: boolean;
  /** Additional review reasons the mapping UI wants surfaced verbatim. */
  reviewReasons?: string[];
}

export interface ResolveAbcMappingInput {
  canonicalMaterial: CanonicalMaterialLine;
  approvedMapping: ApprovedMapping | null;
  normalizedProduct: NormalizedAbcCatalogItem | null;
  resolvedChild: ResolvedAbcChild | null;
  validatedUom: ValidatedAbcUomResult | null;
  verifiedBranch: BranchVerificationResult | null;
  parsedAvailability: ParsedAbcAvailability | null;
  parsedPricing: ParsedAbcPricingLine | null;
}

export interface ResolveAbcMappingOptions {
  /** Approved mapping lifetime. Default 30d. */
  mappingLifetimeMs?: number;
  /** Approved pricing lifetime. Default 24h. */
  pricingLifetimeMs?: number;
  /** Clock injection for tests. */
  now?: Date | string | number;
  /** Treat `limited` availability as orderable. Default false. */
  allowLimitedForOrder?: boolean;
  /** Treat `backorder` availability as orderable. Default false. */
  allowBackorderForOrder?: boolean;
}

export type MappingDecisionState =
  | "approved"
  | "pricing_only"
  | "review_required"
  | "blocked";

export interface ResolvedAbcMappingDecision {
  state: MappingDecisionState;
  canPrice: boolean;
  canOrder: boolean;
  repairReasons: string[];
  warnings: string[];
  approvedItemNumber: string | null;
  approvedDescription: string | null;
  approvedColor: ApprovedMappingColor | null;
  approvedUom: string | null;
  approvedBranch: string | null;
  approvedShipTo: string | null;
  approvedPrice: number | null;
  approvedPricingRunId: string | null;
  approvedMappingId: string | null;
  sourceSnapshots: {
    canonicalMaterial: CanonicalMaterialLine;
    mapping: ApprovedMapping | null;
    normalizedProduct: NormalizedAbcCatalogItem | null;
    resolvedChild: ResolvedAbcChild | null;
    validatedUom: ValidatedAbcUomResult | null;
    verifiedBranch: BranchVerificationResult | null;
    parsedAvailability: ParsedAbcAvailability | null;
    parsedPricing: ParsedAbcPricingLine | null;
  };
}

// ---------- Repair reason catalog ----------
//
// Stable, machine-readable codes. Downstream code (UI, worker, order builder)
// switches on these strings — do not rename without a coordinated migration.

export const REPAIR_REASONS = {
  MAPPING_MISSING: "mapping_missing",
  MAPPING_STALE: "mapping_stale",
  MAPPING_DRAFT: "mapping_draft",
  MAPPING_REVIEW_REQUIRED: "mapping_review_required",
  MULTIPLE_MAPPINGS: "multiple_possible_mappings",
  MANUFACTURER_UNCERTAIN: "manufacturer_uncertain",
  AMBIGUOUS_FAMILY: "ambiguous_family",
  DUPLICATE_COLOR: "duplicate_color",
  MANUAL_SKU: "manual_sku",
  MANUAL_UOM: "manual_uom",
  MANUAL_PRICE: "manual_price",
  BRANCH_NOT_VERIFIED: "branch_not_verified",
  BRANCH_VERIFICATION_EXPIRED: "branch_verification_expired",
  BRANCH_UNAVAILABLE: "branch_unavailable",
  UOM_INVALID: "uom_invalid",
  UOM_MISMATCH: "uom_mismatch",
  ITEM_MISMATCH: "item_mismatch",
  COLOR_MISMATCH: "color_mismatch",
  PRICING_MISSING: "pricing_missing",
  PRICING_ZERO: "pricing_zero",
  PRICING_REJECTED: "pricing_rejected",
  PRICING_IDENTITY_MISMATCH: "pricing_identity_mismatch",
  PRICING_UOM_MISMATCH: "pricing_uom_mismatch",
  PRICING_EXPIRED: "pricing_expired",
  AVAILABILITY_UNKNOWN: "availability_unknown",
  AVAILABILITY_LIMITED: "availability_limited",
  AVAILABILITY_BACKORDER: "availability_backorder",
  INACTIVE_PRODUCT: "inactive_product",
  MISSING_DESCRIPTION: "missing_description",
  MISSING_ITEM_NUMBER: "missing_item_number",
} as const;

// ---------- Defaults ----------

const DEFAULT_MAPPING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PRICING_LIFETIME_MS = 24 * 60 * 60 * 1000;

// ---------- Helpers ----------

function upperTrim(v: unknown): string {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

function looseColor(v: string | null | undefined): string {
  return typeof v === "string"
    ? v.toLowerCase().replace(/[\s_\-\/]+/g, "").trim()
    : "";
}

function parseInstant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function resolveNow(now: ResolveAbcMappingOptions["now"]): Date {
  return parseInstant(now) ?? new Date();
}

function pushUnique(arr: string[], v: string): void {
  if (!arr.includes(v)) arr.push(v);
}

// ---------- Public API ----------

export function resolveAbcMapping(
  input: ResolveAbcMappingInput,
  options: ResolveAbcMappingOptions = {},
): ResolvedAbcMappingDecision {
  const blockers: string[] = [];
  const reviews: string[] = [];
  const pricingOnly: string[] = [];
  const warnings: string[] = [];

  const now = resolveNow(options.now);
  const mappingLifetimeMs = options.mappingLifetimeMs ?? DEFAULT_MAPPING_LIFETIME_MS;
  const pricingLifetimeMs = options.pricingLifetimeMs ?? DEFAULT_PRICING_LIFETIME_MS;
  const allowLimitedForOrder = options.allowLimitedForOrder === true;
  const allowBackorderForOrder = options.allowBackorderForOrder === true;

  const {
    canonicalMaterial,
    approvedMapping,
    normalizedProduct,
    resolvedChild,
    validatedUom,
    verifiedBranch,
    parsedAvailability,
    parsedPricing,
  } = input;

  const sourceSnapshots = {
    canonicalMaterial,
    mapping: approvedMapping,
    normalizedProduct,
    resolvedChild,
    validatedUom,
    verifiedBranch,
    parsedAvailability,
    parsedPricing,
  };

  // ---------- 1. Approved mapping presence + freshness ----------

  if (!approvedMapping) {
    blockers.push(REPAIR_REASONS.MAPPING_MISSING);
  } else {
    // Draft / review-required mappings do not authorize ordering.
    if (approvedMapping.status === "draft") {
      blockers.push(REPAIR_REASONS.MAPPING_DRAFT);
    } else if (approvedMapping.status === "stale") {
      blockers.push(REPAIR_REASONS.MAPPING_STALE);
    } else if (approvedMapping.status === "review_required") {
      reviews.push(REPAIR_REASONS.MAPPING_REVIEW_REQUIRED);
    }

    const approvedAt = parseInstant(approvedMapping.approvedAt);
    if (!approvedAt) {
      blockers.push(REPAIR_REASONS.MAPPING_STALE);
    } else if (now.getTime() - approvedAt.getTime() > mappingLifetimeMs) {
      blockers.push(REPAIR_REASONS.MAPPING_STALE);
    }

    if ((approvedMapping.ambiguityCount ?? 0) > 1) {
      reviews.push(REPAIR_REASONS.MULTIPLE_MAPPINGS);
    }
    if (approvedMapping.manufacturerUncertain) {
      reviews.push(REPAIR_REASONS.MANUFACTURER_UNCERTAIN);
    }
    for (const extra of approvedMapping.reviewReasons ?? []) {
      if (typeof extra === "string" && extra) pushUnique(reviews, extra);
    }
  }

  // ---------- 2. Manual overrides ----------

  if (canonicalMaterial.manualSku) reviews.push(REPAIR_REASONS.MANUAL_SKU);
  if (canonicalMaterial.manualUom) reviews.push(REPAIR_REASONS.MANUAL_UOM);
  if (canonicalMaterial.manualPrice) reviews.push(REPAIR_REASONS.MANUAL_PRICE);

  // ---------- 3. Product identity ----------

  if (!normalizedProduct) {
    blockers.push(REPAIR_REASONS.MISSING_ITEM_NUMBER);
  } else {
    if (!normalizedProduct.itemNumber) {
      blockers.push(REPAIR_REASONS.MISSING_ITEM_NUMBER);
    }
    if (!normalizedProduct.itemDescription) {
      blockers.push(REPAIR_REASONS.MISSING_DESCRIPTION);
    }
    if (normalizedProduct.isActive === false) {
      blockers.push(REPAIR_REASONS.INACTIVE_PRODUCT);
    }
  }

  if (!resolvedChild) {
    // No orderable child at all — treat as identity failure.
    if (!blockers.includes(REPAIR_REASONS.MISSING_ITEM_NUMBER)) {
      blockers.push(REPAIR_REASONS.MISSING_ITEM_NUMBER);
    }
  } else {
    if (resolvedChild.isActive === false) {
      pushUnique(blockers, REPAIR_REASONS.INACTIVE_PRODUCT);
    }
    if (!resolvedChild.itemDescription) {
      pushUnique(blockers, REPAIR_REASONS.MISSING_DESCRIPTION);
    }
    if (!resolvedChild.itemNumber) {
      pushUnique(blockers, REPAIR_REASONS.MISSING_ITEM_NUMBER);
    }
  }

  // Identity must match approvedMapping (case-insensitive, trimmed).
  if (approvedMapping && resolvedChild) {
    if (
      upperTrim(approvedMapping.itemNumber) !==
        upperTrim(resolvedChild.itemNumber)
    ) {
      blockers.push(REPAIR_REASONS.ITEM_MISMATCH);
    }
    const approvedColor = approvedMapping.color?.displayName ??
      approvedMapping.color?.rawName ?? null;
    const childColor = resolvedChild.color.displayName ??
      resolvedChild.color.rawName ?? null;
    // Only enforce color match if the mapping actually captured a color.
    if (approvedColor) {
      if (looseColor(approvedColor) !== looseColor(childColor)) {
        blockers.push(REPAIR_REASONS.COLOR_MISMATCH);
      }
    }
  }

  // ---------- 4. UOM validation ----------

  if (!validatedUom) {
    blockers.push(REPAIR_REASONS.UOM_INVALID);
  } else if (!validatedUom.valid || !validatedUom.selectedUom) {
    blockers.push(REPAIR_REASONS.UOM_INVALID);
  } else if (approvedMapping) {
    if (upperTrim(validatedUom.selectedUom) !== upperTrim(approvedMapping.uom)) {
      blockers.push(REPAIR_REASONS.UOM_MISMATCH);
    }
  }

  // ---------- 5. Branch verification ----------

  if (!verifiedBranch) {
    blockers.push(REPAIR_REASONS.BRANCH_NOT_VERIFIED);
  } else {
    switch (verifiedBranch.reason) {
      case "verified":
        // ok
        break;
      case "verification_expired":
        // Expired verification is a repairable pricing-only state.
        pricingOnly.push(REPAIR_REASONS.BRANCH_VERIFICATION_EXPIRED);
        break;
      case "branch_not_available":
        blockers.push(REPAIR_REASONS.BRANCH_UNAVAILABLE);
        break;
      case "branch_not_authorized":
      case "branch_not_found":
      case "verification_required":
      case "missing_branch":
      default:
        blockers.push(REPAIR_REASONS.BRANCH_NOT_VERIFIED);
        break;
    }
    // Approved mapping's branch must match the verified branch.
    if (
      approvedMapping &&
      verifiedBranch.branchNumber &&
      upperTrim(verifiedBranch.branchNumber) !==
        upperTrim(approvedMapping.branchNumber)
    ) {
      pushUnique(blockers, REPAIR_REASONS.BRANCH_NOT_VERIFIED);
    }
  }

  // ---------- 6. Availability ----------

  if (!parsedAvailability) {
    blockers.push(REPAIR_REASONS.AVAILABILITY_UNKNOWN);
  } else {
    switch (parsedAvailability.status) {
      case "available":
        break;
      case "limited":
        if (!allowLimitedForOrder) {
          pricingOnly.push(REPAIR_REASONS.AVAILABILITY_LIMITED);
        }
        break;
      case "backorder":
        if (!allowBackorderForOrder) {
          pricingOnly.push(REPAIR_REASONS.AVAILABILITY_BACKORDER);
        }
        break;
      case "allocated":
      case "restricted":
      case "unavailable":
        blockers.push(REPAIR_REASONS.BRANCH_UNAVAILABLE);
        break;
      case "verification_required":
        pricingOnly.push(REPAIR_REASONS.BRANCH_VERIFICATION_EXPIRED);
        break;
      case "unknown":
      default:
        blockers.push(REPAIR_REASONS.AVAILABILITY_UNKNOWN);
        break;
    }
  }

  // ---------- 7. Pricing ----------

  if (!parsedPricing) {
    blockers.push(REPAIR_REASONS.PRICING_MISSING);
  } else {
    switch (parsedPricing.status) {
      case "ok":
        // ok — additional zero/mismatch guards below
        break;
      case "zero_price":
        blockers.push(REPAIR_REASONS.PRICING_ZERO);
        break;
      case "item_mismatch":
        blockers.push(REPAIR_REASONS.PRICING_IDENTITY_MISMATCH);
        break;
      case "uom_mismatch":
        blockers.push(REPAIR_REASONS.PRICING_UOM_MISMATCH);
        break;
      case "rejected":
      case "malformed":
      case "missing":
      case "unavailable":
      default:
        blockers.push(REPAIR_REASONS.PRICING_REJECTED);
        break;
    }
    if (
      parsedPricing.unitPrice == null ||
      !Number.isFinite(parsedPricing.unitPrice) ||
      parsedPricing.unitPrice <= 0
    ) {
      if (parsedPricing.status !== "zero_price") {
        pushUnique(blockers, REPAIR_REASONS.PRICING_MISSING);
      }
    }
    // Pricing identity must match approvedMapping identity (defence in depth).
    if (approvedMapping) {
      if (
        parsedPricing.returnedItemNumber &&
        upperTrim(parsedPricing.returnedItemNumber) !==
          upperTrim(approvedMapping.itemNumber)
      ) {
        pushUnique(blockers, REPAIR_REASONS.PRICING_IDENTITY_MISMATCH);
      }
      if (
        parsedPricing.returnedUom &&
        upperTrim(parsedPricing.returnedUom) !== upperTrim(approvedMapping.uom)
      ) {
        pushUnique(blockers, REPAIR_REASONS.PRICING_UOM_MISMATCH);
      }
    }
    // Freshness. Pricing lines carry checkedAt via availability.checkedAt.
    const priceCheckedAt = parseInstant(parsedPricing.availability?.checkedAt);
    if (priceCheckedAt) {
      if (now.getTime() - priceCheckedAt.getTime() > pricingLifetimeMs) {
        pricingOnly.push(REPAIR_REASONS.PRICING_EXPIRED);
      }
    }
  }

  // ---------- 8. Compose decision ----------

  const state: MappingDecisionState = blockers.length > 0
    ? "blocked"
    : reviews.length > 0
    ? "review_required"
    : pricingOnly.length > 0
    ? "pricing_only"
    : "approved";

  const canPrice = state !== "blocked";
  const canOrder = state === "approved";

  // repairReasons order: blockers -> reviews -> pricingOnly (each de-duped).
  const repairReasons: string[] = [];
  for (const r of [...blockers, ...reviews, ...pricingOnly]) {
    pushUnique(repairReasons, r);
  }

  const approvedItemNumber = state === "approved"
    ? (resolvedChild?.itemNumber ?? approvedMapping?.itemNumber ?? null)
    : null;
  const approvedDescription = state === "approved"
    ? (resolvedChild?.itemDescription ??
      approvedMapping?.itemDescription ?? null)
    : null;
  const approvedColor = state === "approved"
    ? (resolvedChild?.color ?? approvedMapping?.color ?? null)
    : null;
  const approvedUom = state === "approved"
    ? (validatedUom?.selectedUom ?? approvedMapping?.uom ?? null)
    : null;
  const approvedBranch = state === "approved"
    ? (verifiedBranch?.branchNumber ?? approvedMapping?.branchNumber ?? null)
    : null;
  const approvedShipTo = state === "approved"
    ? (verifiedBranch?.shipToNumber ?? approvedMapping?.shipToNumber ?? null)
    : null;
  const approvedPrice = state === "approved"
    ? (parsedPricing?.unitPrice ?? null)
    : null;
  const approvedPricingRunId = state === "approved"
    ? (approvedMapping?.pricingRunId ?? null)
    : null;
  const approvedMappingId = state === "approved"
    ? (approvedMapping?.id ?? null)
    : null;

  return {
    state,
    canPrice,
    canOrder,
    repairReasons,
    warnings,
    approvedItemNumber,
    approvedDescription,
    approvedColor,
    approvedUom,
    approvedBranch,
    approvedShipTo,
    approvedPrice,
    approvedPricingRunId,
    approvedMappingId,
    sourceSnapshots,
  };
}
