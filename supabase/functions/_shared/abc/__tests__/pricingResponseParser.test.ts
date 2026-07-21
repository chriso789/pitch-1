/**
 * Unit tests for supabase/functions/_shared/abc/pricingResponseParser.ts
 *
 * Pure module contract tests — no handler integration. Runs under `deno test`.
 */

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AbcPricingParseContext,
  type AbcPricingParserOptions,
  type AbcPricingRequestedLine,
  parseAbcPricingLine,
  parseAbcPricingResponse,
} from "../pricingResponseParser.ts";

async function loadFixture(name: string): Promise<unknown> {
  const url = new URL(`./fixtures/pricing/${name}.json`, import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}

const CHECKED_AT = "2026-07-21T12:00:00.000Z";
const NOW = "2026-07-21T13:00:00.000Z";

function ctx(overrides: Partial<AbcPricingParseContext> = {}): AbcPricingParseContext {
  return {
    requestId: "req-1",
    shipToNumber: "SHIP-1001",
    branchNumber: "042",
    purpose: "estimating",
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function req(overrides: Partial<AbcPricingRequestedLine> = {}): AbcPricingRequestedLine {
  return {
    id: "L1",
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    quantity: 20,
    uom: "BUNDLE",
    mappingId: "map-1",
    templateItemId: "tpl-1",
    estimateLineItemId: "est-1",
    ...overrides,
  };
}

const opts: AbcPricingParserOptions = { now: NOW };

// 1. valid HTTP-200-style response with successful line
Deno.test("valid successful line", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.runStatus, "completed");
  assert(out.success);
  assertEquals(out.lines[0].status, "ok");
  assert(out.lines[0].usableForEstimate);
  assert(out.lines[0].usableForOrder);
  assertEquals(out.lines[0].unitPrice, 45.5);
  assertEquals(out.lines[0].extendedPrice, 910);
  assertEquals(out.lines[0].mappingId, "map-1");
  assertEquals(out.errorSummary, null);
});

// 2. HTTP 200 with failed line status
Deno.test("http 200 with line error is rejected", async () => {
  const raw = await loadFixture("http200-line-error");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "rejected");
  assertFalse(out.lines[0].usableForEstimate);
  assertFalse(out.lines[0].usableForOrder);
  assertEquals(out.runStatus, "failed");
});

// 3. missing status with positive price rejected by default
Deno.test("missing status rejected by default", async () => {
  const raw = await loadFixture("missing-status-with-price");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "rejected");
  assert(out.lines[0].reasonCodes.includes("line_status_missing"));
});

// 4. missing status optionally accepted
Deno.test("missing status accepted when opt-in and price positive", async () => {
  const raw = await loadFixture("missing-status-with-price");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), {
    ...opts,
    allowMissingLineStatusWhenPricePresent: true,
  });
  assertEquals(out.lines[0].status, "ok");
});

// 5. exact id match
Deno.test("exact id match wins", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].matchedBy, "id");
});

// 6. itemNumber fallback match
Deno.test("itemNumber fallback match when id missing", async () => {
  const raw = { lines: [{ itemNumber: "SHNGL-WW", unitOfMeasure: "BUNDLE", quantity: 20, unitPrice: 45.5, status: "OK" }] };
  const out = parseAbcPricingResponse(raw, [req({ id: "L1" })], ctx(), opts);
  assertEquals(out.lines[0].matchedBy, "itemNumber");
  assertEquals(out.lines[0].status, "ok");
});

// 7. line id wins over itemNumber fallback
Deno.test("line id wins over itemNumber fallback", async () => {
  const raw = await loadFixture("id-wins-over-item");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].matchedBy, "id");
  assertEquals(out.lines[0].unitPrice, 45.5);
});

// 8. missing response line
Deno.test("missing response line", () => {
  const out = parseAbcPricingResponse({ lines: [] }, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "missing");
  assertEquals(out.lines[0].matchedBy, "none");
  assert(out.lines[0].reasonCodes.includes("response_line_missing"));
});

// 9. duplicate response id
Deno.test("duplicate response id warns and is deterministic", async () => {
  const raw = await loadFixture("duplicate-id");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assert(out.warnings.some((w) => w.includes("Duplicate returned line id")));
  // First match wins
  assertEquals(out.lines[0].availability.quantityAvailable, 30);
});

// 10. duplicate response itemNumber
Deno.test("duplicate response itemNumber warns", async () => {
  const raw = await loadFixture("duplicate-itemnumber");
  const out = parseAbcPricingResponse(raw, [req({ id: "no-match" })], ctx(), opts);
  assert(out.warnings.some((w) => w.includes("Duplicate returned itemNumber")));
});

// 11. one response line cannot satisfy two requests
Deno.test("consumed response line not reused", () => {
  const raw = {
    lines: [{ id: "L1", itemNumber: "SHNGL-WW", unitOfMeasure: "BUNDLE", quantity: 20, unitPrice: 45.5, status: "OK" }],
  };
  const out = parseAbcPricingResponse(raw, [req({ id: "L1" }), req({ id: "L2" })], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
  assertEquals(out.lines[1].status, "missing");
});

// 12. item mismatch
Deno.test("item mismatch", async () => {
  const raw = await loadFixture("item-mismatch");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "item_mismatch");
  assertFalse(out.lines[0].usableForEstimate);
  assertFalse(out.lines[0].usableForOrder);
});

// 13. UOM mismatch
Deno.test("UOM mismatch", async () => {
  const raw = await loadFixture("uom-mismatch");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "uom_mismatch");
});

// 14. mixed-case exact identity accepted
Deno.test("mixed-case identity accepted", async () => {
  const raw = await loadFixture("mixed-case-identity");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});

// 15. positive unit price
Deno.test("positive unit price ok", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});

// 16. zero unit price
Deno.test("zero unit price is zero_price and not usable for order", async () => {
  const raw = await loadFixture("zero-price-available");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "zero_price");
  assertFalse(out.lines[0].usableForOrder);
  assertFalse(out.lines[0].usableForEstimate);
});

// 17. negative unit price
Deno.test("negative unit price rejected", async () => {
  const raw = await loadFixture("negative-price");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "rejected");
  assert(out.lines[0].reasonCodes.includes("negative_unit_price"));
});

// 18. missing price
Deno.test("missing price is malformed", async () => {
  const raw = await loadFixture("missing-price");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "malformed");
});

// 19. nested unitPrice.value
Deno.test("nested unitPrice.value parsed", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].unitPrice, 45.5);
});

// 20. nested extendedPrice.value
Deno.test("nested extendedPrice.value parsed", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].extendedPrice, 910);
});

// 21. unavailable availability
Deno.test("availability unavailable downgrades line to unavailable", async () => {
  const raw = await loadFixture("availability-unavailable");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "unavailable");
});

// 22. restricted availability
Deno.test("availability restricted downgrades", async () => {
  const raw = await loadFixture("availability-restricted");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "unavailable");
  assert(out.lines[0].reasonCodes.some((r) => r.startsWith("availability_")));
});

// 23. allocated availability
Deno.test("availability allocated downgrades", async () => {
  const raw = await loadFixture("availability-allocated");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "unavailable");
});

// 24. backorder availability
Deno.test("availability backorder not usable for order", async () => {
  const raw = await loadFixture("availability-backorder");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  // Backorder is not orderable by default → line stays ok but usableForOrder=false
  assertEquals(out.lines[0].status, "ok");
  assertFalse(out.lines[0].usableForOrder);
  assert(out.lines[0].reasonCodes.includes("availability_blocks_order"));
});

// 25. stale availability
Deno.test("stale availability blocks order", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const staleNow = "2026-07-25T12:00:00.000Z"; // days later
  const out = parseAbcPricingResponse(raw, [req()], ctx(), { ...opts, now: staleNow });
  assertFalse(out.lines[0].usableForOrder);
});

// 26. available positive price
Deno.test("available positive price ok+orderable", async () => {
  const raw = {
    lines: [
      { id: "L1", itemNumber: "SHNGL-WW", unitOfMeasure: "BUNDLE", quantity: 20, unitPrice: 45.5, status: "OK", availability: { status: "Available", quantityAvailable: 10 } },
    ],
  };
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
  assert(out.lines[0].usableForOrder);
});

// 27–33. wrapper variants
Deno.test("wrapper lines[]", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("wrapper prices[]", async () => {
  const raw = await loadFixture("valid-prices-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("wrapper priceLines[]", async () => {
  const raw = await loadFixture("valid-priceLines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("wrapper data.lines[]", async () => {
  const raw = await loadFixture("valid-data-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("wrapper results[]", async () => {
  const raw = await loadFixture("valid-results-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("bare array", async () => {
  const raw = await loadFixture("valid-bare-array");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});
Deno.test("first-array-element wraps lines", async () => {
  const raw = await loadFixture("valid-first-array-element-lines");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].status, "ok");
});

// 34. malformed/null response
Deno.test("null response: run failed, all missing", async () => {
  const raw = await loadFixture("null-response");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.runStatus, "failed");
  assertEquals(out.lines[0].status, "missing");
  assertEquals(out.errorSummary, "malformed_pricing_response");
});

// 35. completed run
Deno.test("completed run status", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.runStatus, "completed");
  assert(out.success);
});

// 36. partial run
Deno.test("partial run status", async () => {
  const raw = await loadFixture("partial-run");
  const out = parseAbcPricingResponse(
    raw,
    [req({ id: "L1" }), req({ id: "L2", itemNumber: "SHNGL-BK" })],
    ctx(),
    opts,
  );
  assertEquals(out.runStatus, "partial");
  assertEquals(out.counts.ok, 1);
  assertEquals(out.counts.zeroPrice, 1);
  assertEquals(out.errorSummary, "partial_pricing");
});

// 37. failed run
Deno.test("failed run status when zero ok", async () => {
  const raw = await loadFixture("item-mismatch");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.runStatus, "failed");
  assertEquals(out.errorSummary, "pricing_identity_mismatch");
});

// 38. all requested lines returned in output
Deno.test("all requested lines present in output regardless of matches", () => {
  const raw = { lines: [] };
  const out = parseAbcPricingResponse(
    raw,
    [req({ id: "L1" }), req({ id: "L2", itemNumber: "OTHER" })],
    ctx(),
    opts,
  );
  assertEquals(out.lines.length, 2);
  assertEquals(out.lines[0].status, "missing");
  assertEquals(out.lines[1].status, "missing");
});

// 39. mapping/source IDs preserved
Deno.test("mapping and source ids preserved", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.lines[0].mappingId, "map-1");
  assertEquals(out.lines[0].templateItemId, "tpl-1");
  assertEquals(out.lines[0].estimateLineItemId, "est-1");
});

// 40. raw response preserved
Deno.test("raw response preserved on parsed output", async () => {
  const raw = await loadFixture("valid-lines-wrapper");
  const out = parseAbcPricingResponse(raw, [req()], ctx(), opts);
  assertEquals(out.raw, raw);
  assert(out.lines[0].raw != null);
});

// Extra: parseAbcPricingLine directly with null returns missing
Deno.test("parseAbcPricingLine(null) → missing", () => {
  const line = parseAbcPricingLine(null, req(), ctx(), opts);
  assertEquals(line.status, "missing");
  assertEquals(line.matchedBy, "none");
});
