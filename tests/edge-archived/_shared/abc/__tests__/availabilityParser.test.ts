/**
 * Unit tests for supabase/functions/_shared/abc/availabilityParser.ts
 *
 * Pure module contract tests — no handler integration. Runs under `deno test`.
 */

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AvailabilityContext,
  type AvailabilityParserOptions,
  availabilityExpired,
  parseAbcAvailability,
  type RawAbcAvailabilityInput,
} from "../availabilityParser.ts";
import type { NormalizedAbcBranchRef, NormalizedAbcCatalogItem } from "../types.ts";

async function loadFixture(name: string) {
  const url = new URL(`./fixtures/availability/${name}.json`, import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}

function item(branches: unknown): NormalizedAbcCatalogItem {
  return {
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    familyId: null,
    familyName: null,
    parentItemNumber: null,
    isFamilyItem: false,
    isFamilyChild: false,
    colorName: null,
    colorCode: null,
    uoms: [],
    branches: branches as NormalizedAbcBranchRef[],
    status: null,
    isActive: true,
    isDimensional: null,
    lengths: [],
    branchVerificationRequired: false,
    raw: {},
  };
}

function ctx(overrides: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    itemNumber: "SHNGL-WW",
    branchNumber: "042",
    shipToNumber: "SHIP-1001",
    checkedAt: "2026-07-21T12:00:00.000Z",
    unitPrice: 45.5,
    ...overrides,
  };
}

// Freeze "now" at checkedAt + 1h so fresh cases pass.
const nowIso = "2026-07-21T13:00:00.000Z";
const opts: AvailabilityParserOptions = { now: nowIso };

// ---------- Explicit quantity cases ----------

Deno.test("explicit available quantity on Product branch → available + orderable", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.status, "available");
  assert(r.orderable);
  assertEquals(r.quantityAvailable, 24);
  assertEquals(r.branchNumber, "042");
  assertEquals(r.source, "product_branches");
  assertEquals(r.zeroPriceResolution, "not_applicable");
});

Deno.test("explicit zero quantity on Product branch → unavailable, not orderable", async () => {
  const fx = await loadFixture("item-branches-zero");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.status, "unavailable");
  assertFalse(r.orderable);
  assertEquals(r.quantityAvailable, 0);
  assert(r.reasonCodes.includes("hard_zero_quantity"));
});

Deno.test("available text but zero qty → unavailable (precedence beats text)", async () => {
  const fx = await loadFixture("conflicting-available-zero-qty");
  const r = parseAbcAvailability({ pricingLine: fx }, ctx(), opts);
  assertEquals(r.status, "unavailable");
  assertFalse(r.orderable);
});

// ---------- Status text cases ----------

Deno.test("backorder status on Product branch → backorder, not orderable by default", async () => {
  const fx = await loadFixture("item-branches-backorder");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.status, "backorder");
  assertFalse(r.orderable);
});

Deno.test("backorder status with allowBackorder=true → orderable", async () => {
  const fx = await loadFixture("item-branches-backorder");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx(),
    { ...opts, allowBackorder: true },
  );
  assertEquals(r.status, "backorder");
  assert(r.orderable);
});

Deno.test("allocated status → allocated, not orderable (even with positive qty)", async () => {
  const fx = await loadFixture("item-branches-allocated");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.status, "allocated");
  assertFalse(r.orderable);
});

Deno.test("restricted status → restricted (beats positive qty)", async () => {
  const fx = await loadFixture("item-branches-restricted");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.status, "restricted");
  assertFalse(r.orderable);
});

Deno.test("no signals at all → unknown, not orderable", () => {
  const r = parseAbcAvailability({}, ctx(), opts);
  assertEquals(r.status, "unknown");
  assertFalse(r.orderable);
  assertEquals(r.source, "none");
});

// ---------- Branch scoping ----------

Deno.test("only reads the selected branch (never combines other branches)", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ branchNumber: "051" }),
    opts,
  );
  assertEquals(r.quantityAvailable, 12); // Orlando, not Tampa
  assertEquals(r.branchNumber, "051");
});

Deno.test("selected branch not on item → source=none, warns, does not infer", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ branchNumber: "999" }),
    opts,
  );
  assertEquals(r.source, "none");
  assertEquals(r.status, "unknown");
  assert(r.warnings.some((w) => w.includes("999")));
});

Deno.test("duplicate branch entries → first non-null quantity wins", async () => {
  const fx = await loadFixture("item-branches-duplicate");
  const r = parseAbcAvailability({ item: item(fx.branches) }, ctx(), opts);
  assertEquals(r.quantityAvailable, 5);
  assertEquals(r.status, "limited");
  assert(r.orderable);
});

Deno.test("case-insensitive + whitespace-trimmed branch matching", () => {
  const branches = [{ branchNumber: "042", available: 7 }];
  const r = parseAbcAvailability(
    { item: item(branches) },
    ctx({ branchNumber: "  042  " }),
    opts,
  );
  assertEquals(r.quantityAvailable, 7);
  assertEquals(r.branchNumber, "042");
});

// ---------- Precedence ----------

Deno.test("restricted beats available-quantity (precedence rule 1)", () => {
  const r = parseAbcAvailability(
    {
      pricingLine: {
        branchNumber: "042",
        quantityAvailable: 100,
        availabilityStatus: "Restricted",
      },
    },
    ctx(),
    opts,
  );
  assertEquals(r.status, "restricted");
  assertFalse(r.orderable);
});

Deno.test("hard-zero beats available-text (precedence rule 2)", () => {
  const r = parseAbcAvailability(
    { pricingLine: { branchNumber: "042", available: "Yes", quantityAvailable: 0 } },
    ctx(),
    opts,
  );
  assertEquals(r.status, "unavailable");
});

Deno.test("limited signal with positive qty → limited", () => {
  const r = parseAbcAvailability(
    { pricingLine: { branchNumber: "042", quantityAvailable: 3, availabilityStatus: "Low stock" } },
    ctx(),
    opts,
  );
  assertEquals(r.status, "limited");
  assert(r.orderable);
});

Deno.test("allowLimited=false → limited not orderable", () => {
  const r = parseAbcAvailability(
    { pricingLine: { branchNumber: "042", quantityAvailable: 3, availabilityStatus: "Low stock" } },
    ctx(),
    { ...opts, allowLimited: false },
  );
  assertEquals(r.status, "limited");
  assertFalse(r.orderable);
});

// ---------- Zero-price rules ----------

Deno.test("zero price + available → available_contact_branch, not orderable", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ unitPrice: 0 }),
    opts,
  );
  assertEquals(r.status, "available");
  assertFalse(r.orderable);
  assertEquals(r.zeroPriceResolution, "available_contact_branch");
  assert(r.warnings.some((w) => w.toLowerCase().includes("$0")));
});

Deno.test("zero price + unavailable → unavailable_at_branch", async () => {
  const fx = await loadFixture("item-branches-zero");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ unitPrice: 0 }),
    opts,
  );
  assertEquals(r.status, "unavailable");
  assertEquals(r.zeroPriceResolution, "unavailable_at_branch");
  assertFalse(r.orderable);
});

Deno.test("zero price + unknown → unresolved", () => {
  const r = parseAbcAvailability({}, ctx({ unitPrice: 0 }), opts);
  assertEquals(r.status, "unknown");
  assertEquals(r.zeroPriceResolution, "unresolved");
  assertFalse(r.orderable);
});

Deno.test("positive price → zeroPriceResolution=not_applicable", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ unitPrice: 45.5 }),
    opts,
  );
  assertEquals(r.zeroPriceResolution, "not_applicable");
});

// ---------- Freshness ----------

Deno.test("fresh availability → status preserved", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ checkedAt: "2026-07-21T12:00:00.000Z" }),
    { now: "2026-07-21T15:00:00.000Z" }, // +3h < 4h lifetime
  );
  assertEquals(r.status, "available");
  assert(r.orderable);
});

Deno.test("expired availability → verification_required, not orderable", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ checkedAt: "2026-07-21T08:00:00.000Z" }),
    { now: "2026-07-21T13:00:00.000Z" }, // +5h > 4h lifetime
  );
  assertEquals(r.status, "verification_required");
  assertFalse(r.orderable);
  assert(r.reasonCodes.includes("availability_expired"));
});

Deno.test("missing checkedAt with positive signal → verification_required + warning", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ checkedAt: null }),
    opts,
  );
  assertEquals(r.status, "verification_required");
  assertFalse(r.orderable);
  assert(r.warnings.some((w) => w.includes("checkedAt")));
});

// ---------- Malformed / null payload ----------

Deno.test("null payloads and null item → unknown, not orderable", () => {
  const input: RawAbcAvailabilityInput = {
    item: null,
    productResponse: null,
    pricingLine: null,
    availabilityResponse: null,
  };
  const r = parseAbcAvailability(input, ctx(), opts);
  assertEquals(r.status, "unknown");
  assertFalse(r.orderable);
  assertEquals(r.source, "none");
});

Deno.test("malformed pricingLine (non-object) → ignored gracefully", () => {
  const r = parseAbcAvailability(
    { pricingLine: "not an object" as unknown },
    ctx(),
    opts,
  );
  assertEquals(r.status, "unknown");
});

// ---------- Response variants ----------

Deno.test("standalone availability-response variant is honored", async () => {
  const fx = await loadFixture("availability-response-available");
  const r = parseAbcAvailability({ availabilityResponse: fx }, ctx(), opts);
  assertEquals(r.status, "available");
  assertEquals(r.quantityAvailable, 18);
  assertEquals(r.source, "availability_response");
});

Deno.test("pricing-line availability variant with branch filter", async () => {
  const fx = await loadFixture("pricing-line-with-branch");
  const r = parseAbcAvailability({ pricingLine: fx }, ctx(), opts);
  assertEquals(r.status, "available");
  assertEquals(r.quantityAvailable, 12);
  assertEquals(r.source, "pricing_line");
});

Deno.test("pricing-line for a different branch is ignored", () => {
  const r = parseAbcAvailability(
    { pricingLine: { branchNumber: "999", quantityAvailable: 500, availabilityStatus: "In stock" } },
    ctx(),
    opts,
  );
  assertEquals(r.source, "none");
  assertEquals(r.status, "unknown");
});

Deno.test("multi-source combined → source=combined", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    {
      item: item(fx.branches),
      pricingLine: { branchNumber: "042", availabilityStatus: "In stock" },
    },
    ctx(),
    opts,
  );
  assertEquals(r.source, "combined");
  assertEquals(r.status, "available");
});

// ---------- Identity preservation ----------

Deno.test("itemNumber, branchNumber, shipToNumber echoed exactly", async () => {
  const fx = await loadFixture("item-branches-available");
  const r = parseAbcAvailability(
    { item: item(fx.branches) },
    ctx({ itemNumber: "SHNGL-WW", branchNumber: "042", shipToNumber: "SHIP-1001" }),
    opts,
  );
  assertEquals(r.itemNumber, "SHNGL-WW");
  assertEquals(r.branchNumber, "042");
  assertEquals(r.shipToNumber, "SHIP-1001");
});

Deno.test("missing identity → guarded with warning", () => {
  const r = parseAbcAvailability(
    {},
    { itemNumber: "", branchNumber: "", shipToNumber: "" },
    opts,
  );
  assertEquals(r.status, "unknown");
  assert(r.reasonCodes.includes("missing_identity"));
});

// ---------- availabilityExpired helper ----------

Deno.test("availabilityExpired: fresh timestamp within window", () => {
  assertFalse(
    availabilityExpired("2026-07-21T12:00:00.000Z", { now: "2026-07-21T15:00:00.000Z" }),
  );
});

Deno.test("availabilityExpired: expired timestamp beyond window", () => {
  assert(
    availabilityExpired("2026-07-21T08:00:00.000Z", { now: "2026-07-21T13:00:00.000Z" }),
  );
});

Deno.test("availabilityExpired: malformed timestamp → expired", () => {
  assert(availabilityExpired("nope", { now: nowIso }));
});
