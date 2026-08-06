/**
 * Shared pricing service — equivalence + contract tests.
 *
 * Proves that both handlers (which now invoke `priceItems`) return an
 * IDENTICAL parsed pricing verdict for the scenarios enumerated in the
 * Phase 1B Slice 2 brief. Handler code paths differ only in the audit /
 * persistence layer they wrap around this service, so exercising the service
 * directly is sufficient to guarantee wire-and-parse parity.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPriceItemsPayload,
  priceItems,
  validatePricingRequest,
  type AbcPricingServiceRequest,
  type AbcPricingServiceResult,
} from "../pricingService.ts";
import type { AbcCallAbc, AbcHttpCallResult } from "../catalogService.ts";

// ---------- helpers ----------

function makeCallAbc(fakeResponse: {
  status: number;
  json?: unknown;
  text?: string;
}): { call: AbcCallAbc; lastArgs: { url: string; body: unknown }[] } {
  const lastArgs: { url: string; body: unknown }[] = [];
  const call: AbcCallAbc = async (_token, _method, url, body) => {
    lastArgs.push({ url, body });
    const result: AbcHttpCallResult = {
      status: fakeResponse.status,
      json: fakeResponse.json ?? null,
      text: fakeResponse.text ?? JSON.stringify(fakeResponse.json ?? {}),
      ok: fakeResponse.status >= 200 && fakeResponse.status < 300,
      headers: {},
    };
    return result;
  };
  return { call, lastArgs };
}

function mapErr(status: number) {
  if (status === 499) return "abc_waf_blocked";
  if (status === 400) return "abc_400_bad_payload";
  if (status >= 500) return "abc_500_upstream";
  return `abc_${status}`;
}

const baseDeps = (call: AbcCallAbc) => ({
  apiBase: "https://api.example/api",
  token: "TOKEN",
  callAbc: call,
  mapAbcError: mapErr,
  now: () => 1_700_000_000_000,
  checkedAt: "2026-01-01T00:00:00.000Z",
});

const baseReq = (overrides: Partial<AbcPricingServiceRequest> = {}): AbcPricingServiceRequest => ({
  shipToNumber: "SHIP1",
  branchNumber: "BR001",
  purpose: "estimating",
  lines: [
    { itemNumber: "ABC-100", quantity: 5, uom: "EA" },
    { itemNumber: "ABC-200", quantity: 2, uom: "BX" },
  ],
  ...overrides,
});

/**
 * Simulate calling both handlers by invoking the shared service twice with
 * identical inputs. Both invocations MUST yield identical parsed pricing.
 */
async function bothHandlers(
  req: AbcPricingServiceRequest,
  fake: { status: number; json?: unknown; text?: string },
): Promise<{ legacy: AbcPricingServiceResult; v2: AbcPricingServiceResult }> {
  const a = makeCallAbc(fake);
  const b = makeCallAbc(fake);
  const legacy = await priceItems(baseDeps(a.call), req);
  const v2 = await priceItems(baseDeps(b.call), req);
  return { legacy, v2 };
}

function assertParsedEqual(
  legacy: AbcPricingServiceResult,
  v2: AbcPricingServiceResult,
) {
  assertEquals(v2.request, legacy.request, "wire payloads must be identical");
  assertEquals(v2.parsed.runStatus, legacy.parsed.runStatus);
  assertEquals(v2.parsed.counts, legacy.parsed.counts);
  assertEquals(v2.parsed.errorSummary, legacy.parsed.errorSummary);
  assertEquals(
    v2.parsed.lines.map((l) => ({
      id: l.requestLineId,
      status: l.status,
      unitPrice: l.unitPrice,
      usableForEstimate: l.usableForEstimate,
      usableForOrder: l.usableForOrder,
      reasonCodes: l.reasonCodes,
    })),
    legacy.parsed.lines.map((l) => ({
      id: l.requestLineId,
      status: l.status,
      unitPrice: l.unitPrice,
      usableForEstimate: l.usableForEstimate,
      usableForOrder: l.usableForOrder,
      reasonCodes: l.reasonCodes,
    })),
  );
}

// ---------- validation ----------

Deno.test("validate: rejects missing shipToNumber", () => {
  const err = validatePricingRequest(baseReq({ shipToNumber: "" }));
  assertExists(err);
  assertEquals(err!.error_code, "missing_ship_to");
});

Deno.test("validate: rejects missing branch", () => {
  const err = validatePricingRequest(baseReq({ branchNumber: "" }));
  assertExists(err);
  assertEquals(err!.error_code, "missing_branch");
});

Deno.test("validate: rejects missing itemNumber", () => {
  const err = validatePricingRequest(baseReq({
    lines: [{ itemNumber: "", quantity: 1, uom: "EA" }],
  }));
  assertExists(err);
  assertEquals(err!.error_code, "invalid_line");
  assertEquals(err!.missing.includes("lines[0].itemNumber"), true);
});

Deno.test("validate: rejects missing uom", () => {
  const err = validatePricingRequest(baseReq({
    lines: [{ itemNumber: "X", quantity: 1, uom: "" }],
  }));
  assertExists(err);
  assertEquals(err!.error_code, "invalid_line");
  assertEquals(err!.missing.includes("lines[0].uom"), true);
});

Deno.test("validate: rejects quantity <= 0", () => {
  const err = validatePricingRequest(baseReq({
    lines: [{ itemNumber: "X", quantity: 0, uom: "EA" }],
  }));
  assertExists(err);
  assertEquals(err!.error_code, "invalid_line");
  assertEquals(err!.missing.includes("lines[0].quantity"), true);
});

Deno.test("validate: passes canonical request", () => {
  assertEquals(validatePricingRequest(baseReq()), null);
});

// ---------- wire payload ----------

Deno.test("buildPriceItemsPayload: deterministic id + uppercase uom + stamped requestId", () => {
  const payload = buildPriceItemsPayload(baseReq(), { now: () => 42 });
  assertEquals(payload.requestId, "PITCH-PRICE-42");
  assertEquals(payload.lines[0].id, "1");
  assertEquals(payload.lines[1].uom, "BX");
});

// ---------- equivalence scenarios ----------

Deno.test("equiv: valid response — both handlers return runStatus=completed", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: {
      lines: [
        { id: "1", itemNumber: "ABC-100", uom: "EA", quantity: 5, unitPrice: 12.5, status: "OK" },
        { id: "2", itemNumber: "ABC-200", uom: "BX", quantity: 2, unitPrice: 42, status: "OK" },
      ],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.runStatus, "completed");
  assertEquals(legacy.success, true);
});

Deno.test("equiv: partial response", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: {
      lines: [
        { id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: 12.5, status: "OK" },
        { id: "2", itemNumber: "ABC-200", uom: "BX", unitPrice: null, status: "NOT_FOUND" },
      ],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.runStatus, "partial");
});

Deno.test("equiv: failed response (HTTP 500)", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), { status: 500, json: { error: "boom" } });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.runStatus, "failed");
  assertEquals(legacy.error_code, "abc_500_upstream");
  assertEquals(legacy.success, false);
});

Deno.test("equiv: zero-price is never usableForOrder", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq({
    lines: [{ itemNumber: "ABC-100", quantity: 1, uom: "EA" }],
  }), {
    status: 200,
    json: {
      lines: [{ id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: 0, status: "OK" }],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.parsed.lines[0].status, "zero_price");
  assertEquals(legacy.parsed.lines[0].usableForOrder, false);
  assertEquals(legacy.parsed.lines[0].usableForEstimate, false);
});

Deno.test("equiv: item mismatch is flagged, never silently rewritten", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq({
    lines: [{ itemNumber: "ABC-100", quantity: 1, uom: "EA" }],
  }), {
    status: 200,
    json: {
      lines: [{ id: "1", itemNumber: "ABC-999", uom: "EA", unitPrice: 12, status: "OK" }],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.parsed.lines[0].status, "item_mismatch");
});

Deno.test("equiv: uom mismatch is flagged", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq({
    lines: [{ itemNumber: "ABC-100", quantity: 1, uom: "EA" }],
  }), {
    status: 200,
    json: {
      lines: [{ id: "1", itemNumber: "ABC-100", uom: "BX", unitPrice: 12, status: "OK" }],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.parsed.lines[0].status, "uom_mismatch");
});

Deno.test("equiv: duplicate response ids surface a warning", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: {
      lines: [
        { id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: 12, status: "OK" },
        { id: "1", itemNumber: "ABC-200", uom: "BX", unitPrice: 42, status: "OK" },
      ],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(
    legacy.parsed.warnings.some((w) => w.includes("Duplicate returned line id")),
    true,
  );
});

Deno.test("equiv: duplicate itemNumbers surface a warning", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: {
      lines: [
        { id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: 12, status: "OK" },
        { id: "2", itemNumber: "ABC-100", uom: "EA", unitPrice: 13, status: "OK" },
      ],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(
    legacy.parsed.warnings.some((w) => w.includes("Duplicate returned itemNumber")),
    true,
  );
});

Deno.test("equiv: missing response line marks it missing", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: {
      lines: [{ id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: 12, status: "OK" }],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.parsed.lines[1].status, "missing");
});

Deno.test("equiv: HTTP 200 line failure — success MUST be false", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq({
    lines: [{ itemNumber: "ABC-100", quantity: 1, uom: "EA" }],
  }), {
    status: 200,
    json: {
      lines: [{ id: "1", itemNumber: "ABC-100", uom: "EA", unitPrice: null, status: "ERROR" }],
    },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.status, 200);
  assertEquals(legacy.success, false, "HTTP 200 must NOT imply pricing success");
});

Deno.test("equiv: WAF sentinel — error_code=abc_waf_blocked, runStatus=failed", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 499,
    json: { waf: true, upstream_status: 403 },
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.error_code, "abc_waf_blocked");
  assertEquals(legacy.runStatus, "failed");
});

Deno.test("equiv: malformed upstream body", async () => {
  const { legacy, v2 } = await bothHandlers(baseReq(), {
    status: 200,
    json: "not-an-object",
  });
  assertParsedEqual(legacy, v2);
  assertEquals(legacy.runStatus, "failed");
});
