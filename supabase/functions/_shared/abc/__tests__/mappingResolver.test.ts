/**
 * Unit tests for supabase/functions/_shared/abc/mappingResolver.ts
 *
 * Pure module contract tests — no handler integration. Runs under `deno test`.
 */

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ApprovedMapping,
  type CanonicalMaterialLine,
  REPAIR_REASONS,
  resolveAbcMapping,
  type ResolveAbcMappingInput,
} from "../mappingResolver.ts";
import type {
  NormalizedAbcCatalogItem,
  ResolvedAbcChild,
} from "../types.ts";
import type { ValidatedAbcUomResult } from "../uomValidator.ts";
import type { BranchVerificationResult } from "../branchVerifier.ts";
import type { ParsedAbcAvailability } from "../availabilityParser.ts";
import type { ParsedAbcPricingLine } from "../pricingResponseParser.ts";

const NOW = "2026-07-21T13:00:00.000Z";
const CHECKED_AT = "2026-07-21T12:00:00.000Z";
const APPROVED_AT = "2026-07-15T12:00:00.000Z";

async function loadFixture(name: string): Promise<unknown> {
  const url = new URL(`./fixtures/mapping/${name}.json`, import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}

// ---------- Builders ----------

function canonical(
  overrides: Partial<CanonicalMaterialLine> = {},
): CanonicalMaterialLine {
  return {
    id: "L1",
    templateItemId: "tpl-1",
    estimateLineItemId: "est-1",
    description: "GAF Timberline HDZ Weathered Wood",
    requestedItemNumber: "SHNGL-WW",
    requestedColorDisplayName: "Weathered Wood",
    requestedUom: "BUNDLE",
    requestedQuantity: 20,
    manualSku: false,
    manualUom: false,
    manualPrice: false,
    manufacturerHint: "GAF",
    familyHint: "Timberline HDZ",
    ...overrides,
  };
}

function mapping(
  overrides: Partial<ApprovedMapping> = {},
): ApprovedMapping {
  return {
    id: "map-1",
    status: "approved",
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    color: {
      displayName: "Weathered Wood",
      rawName: "Weathered Wood",
      code: "WW",
    },
    uom: "BUNDLE",
    branchNumber: "042",
    shipToNumber: "SHIP-1001",
    approvedAt: APPROVED_AT,
    approvedPrice: 45.5,
    pricingRunId: "run-1",
    ambiguityCount: 1,
    manufacturerUncertain: false,
    reviewReasons: [],
    ...overrides,
  };
}

function normalizedProduct(
  overrides: Partial<NormalizedAbcCatalogItem> = {},
): NormalizedAbcCatalogItem {
  return {
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    familyId: "fam-1",
    familyName: "Timberline HDZ",
    parentItemNumber: null,
    isFamilyItem: false,
    isFamilyChild: true,
    colorName: "Weathered Wood",
    colorCode: "WW",
    uoms: [{ code: "BUNDLE", isDefault: true }],
    branches: [{ branchNumber: "042", available: 25 }],
    status: "active",
    isActive: true,
    isDimensional: false,
    lengths: [],
    branchVerificationRequired: false,
    raw: {},
    ...overrides,
  };
}

function resolvedChild(
  overrides: Partial<ResolvedAbcChild> = {},
): ResolvedAbcChild {
  return {
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    familyId: "fam-1",
    familyName: "Timberline HDZ",
    manufacturer: "GAF",
    parentItemNumber: null,
    color: {
      displayName: "Weathered Wood",
      rawName: "Weathered Wood",
      code: "WW",
      aliasOf: null,
    },
    validUoms: [{ code: "BUNDLE", isDefault: true }],
    branches: [{ branchNumber: "042", available: 25 }],
    branchVerificationRequired: false,
    status: "active",
    isActive: true,
    isOrderable: true,
    orderabilityReasons: ["ok"],
    source: null as unknown as ResolvedAbcChild["source"],
    ...overrides,
  } as ResolvedAbcChild;
}

function validatedUom(
  overrides: Partial<ValidatedAbcUomResult> = {},
): ValidatedAbcUomResult {
  return {
    valid: true,
    selectedUom: "BUNDLE",
    availableUoms: [
      {
        code: "BUNDLE",
        displayName: "Bundle",
        description: null,
        normalizedCode: "BUNDLE",
        isSellable: true,
        isDefault: true,
        source: "abc_uoms",
      },
    ],
    reason: "ok",
    warnings: [],
    ...overrides,
  };
}

function verifiedBranch(
  overrides: Partial<BranchVerificationResult> = {},
): BranchVerificationResult {
  return {
    verified: true,
    branchNumber: "042",
    shipToNumber: "SHIP-1001",
    reason: "verified",
    verifiedAt: CHECKED_AT,
    expiresAt: "2026-07-22T12:00:00.000Z",
    warnings: [],
    ...overrides,
  };
}

function availability(
  overrides: Partial<ParsedAbcAvailability> = {},
): ParsedAbcAvailability {
  return {
    status: "available",
    orderable: true,
    quantityAvailable: 25,
    branchNumber: "042",
    shipToNumber: "SHIP-1001",
    itemNumber: "SHNGL-WW",
    source: "product_branches",
    checkedAt: CHECKED_AT,
    expiresAt: "2026-07-21T16:00:00.000Z",
    zeroPriceResolution: "not_applicable",
    reasonCodes: ["positive_quantity"],
    warnings: [],
    raw: {},
    ...overrides,
  };
}

function pricingLine(
  overrides: Partial<ParsedAbcPricingLine> = {},
): ParsedAbcPricingLine {
  return {
    requestLineId: "L1",
    matchedBy: "id",
    requestedItemNumber: "SHNGL-WW",
    returnedItemNumber: "SHNGL-WW",
    requestedUom: "BUNDLE",
    returnedUom: "BUNDLE",
    requestedQuantity: 20,
    returnedQuantity: 20,
    itemDescription: "Weathered Wood Shingle",
    unitPrice: 45.5,
    extendedPrice: 910,
    lineStatusCode: "OK",
    lineStatusMessage: null,
    availability: availability(),
    status: "ok",
    usableForEstimate: true,
    usableForOrder: true,
    reasonCodes: [],
    warnings: [],
    mappingId: "map-1",
    templateItemId: "tpl-1",
    estimateLineItemId: "est-1",
    raw: {},
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<ResolveAbcMappingInput> = {},
): ResolveAbcMappingInput {
  return {
    canonicalMaterial: canonical(),
    approvedMapping: mapping(),
    normalizedProduct: normalizedProduct(),
    resolvedChild: resolvedChild(),
    validatedUom: validatedUom(),
    verifiedBranch: verifiedBranch(),
    parsedAvailability: availability(),
    parsedPricing: pricingLine(),
    ...overrides,
  };
}

const opts = { now: NOW };

// ---------- Approved / exact success ----------

Deno.test("approved: exact success with all evidence green", () => {
  const out = resolveAbcMapping(baseInput(), opts);
  assertEquals(out.state, "approved");
  assert(out.canPrice);
  assert(out.canOrder);
  assertEquals(out.repairReasons, []);
  assertEquals(out.approvedItemNumber, "SHNGL-WW");
  assertEquals(out.approvedUom, "BUNDLE");
  assertEquals(out.approvedBranch, "042");
  assertEquals(out.approvedShipTo, "SHIP-1001");
  assertEquals(out.approvedPrice, 45.5);
  assertEquals(out.approvedMappingId, "map-1");
  assertEquals(out.approvedPricingRunId, "run-1");
});

Deno.test("approved: matches happy-path fixture snapshot", async () => {
  const fx = await loadFixture("happy-path") as { canonical: unknown };
  const out = resolveAbcMapping(baseInput({
    canonicalMaterial: fx.canonical as CanonicalMaterialLine,
  }), opts);
  assertEquals(out.state, "approved");
  assert(out.canOrder);
});

// ---------- Blocked ----------

Deno.test("blocked: mapping missing", () => {
  const out = resolveAbcMapping(baseInput({ approvedMapping: null }), opts);
  assertEquals(out.state, "blocked");
  assertFalse(out.canPrice);
  assertFalse(out.canOrder);
  assert(out.repairReasons.includes(REPAIR_REASONS.MAPPING_MISSING));
});

Deno.test("blocked: mapping stale (past lifetime)", () => {
  const out = resolveAbcMapping(
    baseInput({
      approvedMapping: mapping({ approvedAt: "2026-05-01T00:00:00.000Z" }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.MAPPING_STALE));
});

Deno.test("blocked: item mismatch", () => {
  const out = resolveAbcMapping(
    baseInput({
      resolvedChild: resolvedChild({ itemNumber: "SHNGL-CH" }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.ITEM_MISMATCH));
});

Deno.test("blocked: color mismatch", () => {
  const out = resolveAbcMapping(
    baseInput({
      resolvedChild: resolvedChild({
        color: {
          displayName: "Charcoal",
          rawName: "Charcoal",
          code: "CH",
          aliasOf: null,
        },
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.COLOR_MISMATCH));
});

Deno.test("blocked: branch not verified", () => {
  const out = resolveAbcMapping(
    baseInput({
      verifiedBranch: verifiedBranch({
        verified: false,
        reason: "branch_not_authorized",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.BRANCH_NOT_VERIFIED));
});

Deno.test("blocked: branch unavailable", () => {
  const out = resolveAbcMapping(
    baseInput({
      verifiedBranch: verifiedBranch({
        verified: false,
        reason: "branch_not_available",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.BRANCH_UNAVAILABLE));
});

Deno.test("blocked: invalid UOM", () => {
  const out = resolveAbcMapping(
    baseInput({
      validatedUom: validatedUom({
        valid: false,
        selectedUom: null,
        reason: "invalid_uom",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.UOM_INVALID));
});

Deno.test("blocked: uom mismatch with approved mapping", () => {
  const out = resolveAbcMapping(
    baseInput({ validatedUom: validatedUom({ selectedUom: "SQUARE" }) }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.UOM_MISMATCH));
});

Deno.test("blocked: pricing missing", () => {
  const out = resolveAbcMapping(baseInput({ parsedPricing: null }), opts);
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.PRICING_MISSING));
});

Deno.test("blocked: pricing zero", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedPricing: pricingLine({ status: "zero_price", unitPrice: 0 }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.PRICING_ZERO));
});

Deno.test("blocked: pricing identity mismatch", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedPricing: pricingLine({
        status: "item_mismatch",
        returnedItemNumber: "SHNGL-XX",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(
    out.repairReasons.includes(REPAIR_REASONS.PRICING_IDENTITY_MISMATCH),
  );
});

Deno.test("blocked: pricing uom mismatch", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedPricing: pricingLine({
        status: "uom_mismatch",
        returnedUom: "SQUARE",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.PRICING_UOM_MISMATCH));
});

Deno.test("blocked: pricing rejected", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedPricing: pricingLine({ status: "rejected", unitPrice: null }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.PRICING_REJECTED));
});

Deno.test("blocked: availability unknown", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedAvailability: availability({
        status: "unknown",
        orderable: false,
      }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.AVAILABILITY_UNKNOWN));
});

Deno.test("blocked: inactive product", () => {
  const out = resolveAbcMapping(
    baseInput({
      normalizedProduct: normalizedProduct({ isActive: false }),
      resolvedChild: resolvedChild({ isActive: false }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.INACTIVE_PRODUCT));
});

Deno.test("blocked: missing description on product", () => {
  const out = resolveAbcMapping(
    baseInput({
      normalizedProduct: normalizedProduct({ itemDescription: null }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.MISSING_DESCRIPTION));
});

Deno.test("blocked: missing item number on product", () => {
  const out = resolveAbcMapping(
    baseInput({
      normalizedProduct: normalizedProduct({ itemNumber: "" }),
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.MISSING_ITEM_NUMBER));
});

// ---------- Pricing-only ----------

Deno.test("pricing_only: branch verification expired", () => {
  const out = resolveAbcMapping(
    baseInput({
      verifiedBranch: verifiedBranch({
        verified: false,
        reason: "verification_expired",
      }),
    }),
    opts,
  );
  assertEquals(out.state, "pricing_only");
  assert(out.canPrice);
  assertFalse(out.canOrder);
  assert(
    out.repairReasons.includes(REPAIR_REASONS.BRANCH_VERIFICATION_EXPIRED),
  );
});

Deno.test("pricing_only: availability limited (default)", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedAvailability: availability({
        status: "limited",
        orderable: true,
      }),
    }),
    opts,
  );
  assertEquals(out.state, "pricing_only");
  assert(out.repairReasons.includes(REPAIR_REASONS.AVAILABILITY_LIMITED));
});

Deno.test("pricing_only: availability backorder (default)", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedAvailability: availability({
        status: "backorder",
        orderable: false,
      }),
    }),
    opts,
  );
  assertEquals(out.state, "pricing_only");
  assert(out.repairReasons.includes(REPAIR_REASONS.AVAILABILITY_BACKORDER));
});

Deno.test("pricing_only: pricing expired past lifetime", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedPricing: pricingLine({
        availability: availability({ checkedAt: "2026-07-19T12:00:00.000Z" }),
      }),
    }),
    opts,
  );
  assertEquals(out.state, "pricing_only");
  assert(out.repairReasons.includes(REPAIR_REASONS.PRICING_EXPIRED));
});

Deno.test("approved: allowLimitedForOrder promotes limited to approved", () => {
  const out = resolveAbcMapping(
    baseInput({
      parsedAvailability: availability({
        status: "limited",
        orderable: true,
      }),
    }),
    { ...opts, allowLimitedForOrder: true },
  );
  assertEquals(out.state, "approved");
  assert(out.canOrder);
});

// ---------- Review-required ----------

Deno.test("review_required: multiple possible mappings", () => {
  const out = resolveAbcMapping(
    baseInput({ approvedMapping: mapping({ ambiguityCount: 3 }) }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.canPrice);
  assertFalse(out.canOrder);
  assert(out.repairReasons.includes(REPAIR_REASONS.MULTIPLE_MAPPINGS));
});

Deno.test("review_required: manufacturer uncertain", () => {
  const out = resolveAbcMapping(
    baseInput({
      approvedMapping: mapping({ manufacturerUncertain: true }),
    }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.repairReasons.includes(REPAIR_REASONS.MANUFACTURER_UNCERTAIN));
});

Deno.test("review_required: mapping.status = review_required", () => {
  const out = resolveAbcMapping(
    baseInput({ approvedMapping: mapping({ status: "review_required" }) }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(
    out.repairReasons.includes(REPAIR_REASONS.MAPPING_REVIEW_REQUIRED),
  );
});

Deno.test("review_required: manual SKU", () => {
  const out = resolveAbcMapping(
    baseInput({ canonicalMaterial: canonical({ manualSku: true }) }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.repairReasons.includes(REPAIR_REASONS.MANUAL_SKU));
});

Deno.test("review_required: manual UOM", () => {
  const out = resolveAbcMapping(
    baseInput({ canonicalMaterial: canonical({ manualUom: true }) }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.repairReasons.includes(REPAIR_REASONS.MANUAL_UOM));
});

Deno.test("review_required: manual price", () => {
  const out = resolveAbcMapping(
    baseInput({ canonicalMaterial: canonical({ manualPrice: true }) }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.repairReasons.includes(REPAIR_REASONS.MANUAL_PRICE));
});

Deno.test("review_required: extra reviewReasons preserved verbatim", () => {
  const out = resolveAbcMapping(
    baseInput({
      approvedMapping: mapping({ reviewReasons: ["duplicate_color"] }),
    }),
    opts,
  );
  assertEquals(out.state, "review_required");
  assert(out.repairReasons.includes(REPAIR_REASONS.DUPLICATE_COLOR));
});

// ---------- Precedence ----------

Deno.test("blockers take precedence over reviews and pricing-only", () => {
  const out = resolveAbcMapping(
    baseInput({
      approvedMapping: mapping({
        ambiguityCount: 3, // review
        approvedAt: "2026-05-01T00:00:00.000Z", // stale => block
      }),
      parsedAvailability: availability({ status: "limited" }), // pricing_only
    }),
    opts,
  );
  assertEquals(out.state, "blocked");
  assert(out.repairReasons.includes(REPAIR_REASONS.MAPPING_STALE));
});

Deno.test("approved output leaves approvedItemNumber null when blocked", () => {
  const out = resolveAbcMapping(baseInput({ approvedMapping: null }), opts);
  assertEquals(out.approvedItemNumber, null);
  assertEquals(out.approvedPrice, null);
  assertEquals(out.approvedMappingId, null);
});

Deno.test("sourceSnapshots always contain the raw inputs", () => {
  const input = baseInput();
  const out = resolveAbcMapping(input, opts);
  assertEquals(out.sourceSnapshots.mapping, input.approvedMapping);
  assertEquals(out.sourceSnapshots.parsedPricing, input.parsedPricing);
});
