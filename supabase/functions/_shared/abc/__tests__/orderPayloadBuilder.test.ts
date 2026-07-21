/**
 * Unit tests for supabase/functions/_shared/abc/orderPayloadBuilder.ts
 * Deno test runner. Pure module contract — no handler integration.
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type BuildAbcOrderInput,
  buildAbcOrderPayload,
  ORDER_PREFLIGHT_CODES,
  validateAbcOrderInput,
} from "../orderPayloadBuilder.ts";
import type { ResolvedAbcMappingDecision } from "../mappingResolver.ts";

// ---------- Builders ----------

function approvedDecision(
  overrides: Partial<ResolvedAbcMappingDecision> = {},
): ResolvedAbcMappingDecision {
  return {
    state: "approved",
    canPrice: true,
    canOrder: true,
    repairReasons: [],
    warnings: [],
    approvedItemNumber: "SHNGL-WW",
    approvedDescription: "GAF Timberline HDZ Weathered Wood",
    approvedColor: {
      displayName: "Weathered Wood",
      rawName: "Weathered Wood",
      code: "WW",
    },
    approvedUom: "BUNDLE",
    approvedBranch: "0123",
    approvedShipTo: "SHIP-1",
    approvedPrice: 42.5,
    approvedPricingRunId: "pr-1",
    approvedMappingId: "map-1",
    // deno-lint-ignore no-explicit-any
    sourceSnapshots: {} as any,
    ...overrides,
  };
}

function inputWith(
  overrides: Partial<BuildAbcOrderInput> = {},
): BuildAbcOrderInput {
  return {
    requestId: "req-1",
    purchaseOrder: "PO-1",
    branchNumber: "0123",
    shipToNumber: "SHIP-1",
    deliveryService: "OTG",
    deliveryRequestedFor: "2026-08-01",
    shipTo: {
      name: "Fonsica Job Site",
      address: {
        line1: "4063 Fonsica Ave",
        city: "Sarasota",
        state: "fl",
        postal: "34232",
      },
    },
    jobsiteContact: {
      name: "John Owner",
      email: "john@example.com",
      phone: "(941) 555-1212",
      phoneType: "MOBILE",
    },
    lines: [
      {
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision(),
        quantity: 20,
      },
    ],
    ...overrides,
  };
}

// ---------- 1. Valid single-line order ----------
Deno.test("1. valid single-line order", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload!.length, 1);
  assertEquals(out.payload![0].lines.length, 1);
});

// ---------- 2. Valid multi-line order ----------
Deno.test("2. valid multi-line order", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision(),
          quantity: 20,
        },
        {
          id: "L2",
          canonicalMaterialLineId: "cm-2",
          mappingDecision: approvedDecision({
            approvedItemNumber: "UNDERLAY",
            approvedDescription: "GAF Deck-Armor",
          }),
          quantity: 8,
        },
      ],
    }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].lines.length, 2);
});

// ---------- 3. Body is always an array ----------
Deno.test("3. body is always array", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assert(Array.isArray(out.payload));
});

// ---------- 4-7. Approved identity fields used ----------
Deno.test("4. exact approved itemNumber used", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].itemNumber, "SHNGL-WW");
});
Deno.test("5. exact approved description used", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(
    out.payload![0].lines[0].itemDescription,
    "GAF Timberline HDZ Weathered Wood",
  );
});
Deno.test("6. exact approved UOM used for quantity and price", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  const l = out.payload![0].lines[0];
  assertEquals(l.orderedQty.uom, "BUNDLE");
  assertEquals(l.unitPrice.uom, "BUNDLE");
});
Deno.test("7. exact approved price used", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].unitPrice.value, 42.5);
});

// ---------- 8. DC contact required ----------
Deno.test("8. DC contact required (single)", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  const contacts = out.payload![0].shipTo.contacts;
  assertEquals(contacts.length, 1);
  assertEquals(contacts[0].functionCode, "DC");
});

// ---------- 9. DC phone normalized ----------
Deno.test("9. DC phone normalized to digits", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(
    out.payload![0].shipTo.contacts[0].phones[0].number,
    "9415551212",
  );
});

// ---------- 10. Invalid DC email rejected ----------
Deno.test("10. invalid DC email rejected", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      jobsiteContact: {
        name: "X",
        email: "not-an-email",
        phone: "9415551212",
      },
    }),
  );
  assertFalse(out.valid);
  assert(
    (out as { errors: { code: string }[] }).errors.some((e) =>
      e.code === ORDER_PREFLIGHT_CODES.CONTACT_EMAIL_INVALID
    ),
  );
});

// ---------- 11-13. Order-level required fields ----------
Deno.test("11. missing Ship-To blocked", () => {
  const out = buildAbcOrderPayload(inputWith({ shipToNumber: "" }));
  assertFalse(out.valid);
});
Deno.test("12. missing branch blocked", () => {
  const out = buildAbcOrderPayload(inputWith({ branchNumber: "" }));
  assertFalse(out.valid);
});
Deno.test("13. unsupported delivery service blocked", () => {
  const out = buildAbcOrderPayload(
    // deno-lint-ignore no-explicit-any
    inputWith({ deliveryService: "BOGUS" as any }),
  );
  assertFalse(out.valid);
});

// ---------- 14-15. Line mismatches ----------
Deno.test("14. branch mismatch blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision({ approvedBranch: "9999" }),
          quantity: 20,
        },
      ],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("15. Ship-To mismatch blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision({ approvedShipTo: "OTHER" }),
          quantity: 20,
        },
      ],
    }),
  );
  assertFalse(out.valid);
});

// ---------- 16-17. Mapping state gates ----------
Deno.test("16. mapping state not approved blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ state: "review_required" }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("17. canOrder=false blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ canOrder: false }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});

// ---------- 18-19. Missing approved references ----------
Deno.test("18. missing mapping id blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedMappingId: null }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("19. missing pricing reference blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedPricingRunId: null }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});

// ---------- 20-22. Price + quantity gates ----------
Deno.test("20. zero price blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedPrice: 0 }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("21. negative price blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedPrice: -5 }),
        quantity: 20,
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("22. invalid quantity blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision(),
        quantity: 0,
      }],
    }),
  );
  assertFalse(out.valid);
});

// ---------- 23-24. Duplicates ----------
Deno.test("23. duplicate line id blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision(),
          quantity: 1,
        },
        {
          id: "L1",
          canonicalMaterialLineId: "cm-2",
          mappingDecision: approvedDecision(),
          quantity: 2,
        },
      ],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("24. duplicate canonical material line blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision(),
          quantity: 1,
        },
        {
          id: "L2",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision(),
          quantity: 2,
        },
      ],
    }),
  );
  assertFalse(out.valid);
});

// ---------- 25-26. Date gates ----------
Deno.test("25. invalid delivery date blocked (format)", () => {
  const out = buildAbcOrderPayload(
    inputWith({ deliveryRequestedFor: "08/01/2026" }),
  );
  assertFalse(out.valid);
});
Deno.test("26. impossible date blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({ deliveryRequestedFor: "2026-02-31" }),
  );
  assertFalse(out.valid);
});

// ---------- 27-28. Address normalization ----------
Deno.test("27. country defaults to USA", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload![0].shipTo.address.country, "USA");
});
Deno.test("28. state uppercased", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload![0].shipTo.address.state, "FL");
});

// ---------- 29-31. Comments ----------
Deno.test("29. comments normalized (default code H)", () => {
  const out = buildAbcOrderPayload(
    inputWith({ comments: [{ description: "Deliver to backyard" }] }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].orderComments![0].code, "H");
  assertEquals(
    out.payload![0].orderComments![0].description,
    "Deliver to backyard",
  );
});
Deno.test("30. empty comments removed", () => {
  const out = buildAbcOrderPayload(
    inputWith({ comments: [{ description: "   " }, { description: "" }] }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].orderComments, undefined);
});
Deno.test("31. long comment truncated with warning", () => {
  const long = "x".repeat(500);
  const out = buildAbcOrderPayload(
    inputWith({ comments: [{ description: long }] }),
    { maxCommentLength: 100 },
  );
  assert(out.valid);
  assertEquals(out.payload![0].orderComments![0].description.length, 100);
  assert(out.warnings.some((w) => w.includes("truncated")));
});

// ---------- 32-35. Dimensional handling ----------
const dimensionalDecision = () =>
  approvedDecision({
    // deno-lint-ignore no-explicit-any
    sourceSnapshots: {
      normalizedProduct: {
        isDimensional: true,
        lengths: ["12FT", "16FT"],
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  });

Deno.test("32. dimensional item with valid length", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: dimensionalDecision(),
        quantity: 5,
        dimension: { lengthValue: 12, lengthUom: "FT" },
      }],
    }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].dimensions!.length.value, 12);
  assertEquals(out.payload![0].lines[0].dimensions!.length.uom, "FT");
});
Deno.test("33. dimensional item missing length blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: dimensionalDecision(),
        quantity: 5,
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("34. dimensional item invalid length blocked", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: dimensionalDecision(),
        quantity: 5,
        dimension: { lengthValue: 20, lengthUom: "FT" },
      }],
    }),
  );
  assertFalse(out.valid);
});
Deno.test("35. non-dimensional extra length drops with warning", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision(),
        quantity: 5,
        dimension: { lengthValue: 12, lengthUom: "FT" },
      }],
    }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].dimensions, undefined);
  assert(out.warnings.some((w) => w.includes("dimension")));
});

// ---------- 36-41. Hash/idempotency ----------
Deno.test("36. deterministic payload hash", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(inputWith());
  assert(a.valid && b.valid);
  assertEquals(a.payloadHash, b.payloadHash);
});
Deno.test("37. deterministic idempotency key", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(inputWith());
  assert(a.valid && b.valid);
  assertEquals(a.idempotencyKey, b.idempotencyKey);
});
Deno.test("38. quantity changes key", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision(),
        quantity: 99,
      }],
    }),
  );
  assert(a.valid && b.valid);
  assertNotEquals(a.idempotencyKey, b.idempotencyKey);
});
Deno.test("39. price changes key", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedPrice: 99.9 }),
        quantity: 20,
      }],
    }),
  );
  assert(a.valid && b.valid);
  assertNotEquals(a.idempotencyKey, b.idempotencyKey);
});
Deno.test("40. branch changes key", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(
    inputWith({
      branchNumber: "0456",
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedBranch: "0456" }),
        quantity: 20,
      }],
    }),
  );
  assert(a.valid && b.valid);
  assertNotEquals(a.idempotencyKey, b.idempotencyKey);
});
Deno.test("41. Ship-To changes key", () => {
  const a = buildAbcOrderPayload(inputWith());
  const b = buildAbcOrderPayload(
    inputWith({
      shipToNumber: "SHIP-2",
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedShipTo: "SHIP-2" }),
        quantity: 20,
      }],
    }),
  );
  assert(a.valid && b.valid);
  assertNotEquals(a.idempotencyKey, b.idempotencyKey);
});

// ---------- 42-44. No browser identity overrides ----------
Deno.test("42. contractor name cannot override itemNumber", () => {
  // Even though input carries no itemNumber field, this asserts that the built
  // line always comes from mappingDecision.approvedItemNumber.
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].itemNumber, "SHNGL-WW");
});
Deno.test("43. browser UOM cannot override approved UOM", () => {
  // Approved UOM is BUNDLE; there is no path to inject a different UOM.
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedUom: "SQ" }),
        quantity: 20,
      }],
    }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].orderedQty.uom, "SQ");
  assertEquals(out.payload![0].lines[0].unitPrice.uom, "SQ");
});
Deno.test("44. manually supplied price cannot override approved price", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [{
        id: "L1",
        canonicalMaterialLineId: "cm-1",
        mappingDecision: approvedDecision({ approvedPrice: 77.77 }),
        quantity: 20,
      }],
    }),
  );
  assert(out.valid);
  assertEquals(out.payload![0].lines[0].unitPrice.value, 77.77);
});

// ---------- 45. Line proofs complete ----------
Deno.test("45. line proofs complete", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  const p = out.lineProofs[0];
  assertEquals(p.lineId, "L1");
  assertEquals(p.canonicalMaterialLineId, "cm-1");
  assertEquals(p.approvedMappingId, "map-1");
  assertEquals(p.approvedPricingRunId, "pr-1");
  assertEquals(p.itemNumber, "SHNGL-WW");
  assertEquals(p.uom, "BUNDLE");
  assertEquals(p.quantity, 20);
  assertEquals(p.unitPrice, 42.5);
  assertEquals(p.branchNumber, "0123");
  assertEquals(p.shipToNumber, "SHIP-1");
  assertEquals(p.color, "Weathered Wood");
});

// ---------- 46. Preflight reports every invalid line ----------
Deno.test("46. preflight reports every invalid line", () => {
  const pf = validateAbcOrderInput(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision({ approvedPrice: 0 }),
          quantity: 20,
        },
        {
          id: "L2",
          canonicalMaterialLineId: "cm-2",
          mappingDecision: approvedDecision({ canOrder: false }),
          quantity: 5,
        },
      ],
    }),
  );
  assertFalse(pf.valid);
  const lineIds = new Set(pf.errors.map((e) => e.lineId));
  assert(lineIds.has("L1"));
  assert(lineIds.has("L2"));
});

// ---------- 47. No partial payload when one line fails ----------
Deno.test("47. no partial payload when one line fails", () => {
  const out = buildAbcOrderPayload(
    inputWith({
      lines: [
        {
          id: "L1",
          canonicalMaterialLineId: "cm-1",
          mappingDecision: approvedDecision(),
          quantity: 20,
        },
        {
          id: "L2",
          canonicalMaterialLineId: "cm-2",
          mappingDecision: approvedDecision({ approvedPrice: 0 }),
          quantity: 5,
        },
      ],
    }),
  );
  assertFalse(out.valid);
  assertEquals(out.payload, null);
});

// ---------- 48. Inputs not mutated ----------
Deno.test("48. inputs not mutated", () => {
  const input = inputWith();
  const snapshot = JSON.stringify(input);
  buildAbcOrderPayload(input);
  assertEquals(JSON.stringify(input), snapshot);
});

// ---------- 49. Stable semantic ordering (hash unaffected by key order) ----------
Deno.test("49. stable semantic object ordering", () => {
  // Build two payloads whose *input object key insertion order* differs but
  // whose semantic content is identical. The hash must match.
  const base = inputWith();
  const reordered: BuildAbcOrderInput = {
    lines: base.lines,
    jobsiteContact: base.jobsiteContact,
    shipTo: base.shipTo,
    deliveryRequestedFor: base.deliveryRequestedFor,
    deliveryService: base.deliveryService,
    shipToNumber: base.shipToNumber,
    branchNumber: base.branchNumber,
    purchaseOrder: base.purchaseOrder,
    requestId: base.requestId,
  };
  const a = buildAbcOrderPayload(base);
  const b = buildAbcOrderPayload(reordered);
  assert(a.valid && b.valid);
  assertEquals(a.idempotencyKey, b.idempotencyKey);
  assertEquals(a.payloadHash, b.payloadHash);
});

// ---------- 50. Sandbox validate-only shape remains compatible ----------
Deno.test("50. sandbox validate-only shape remains compatible", () => {
  const out = buildAbcOrderPayload(inputWith());
  assert(out.valid);
  const body = out.payload![0];
  // Required top-level shape ABC's sandbox validator expects.
  assertEquals(body.typeCode, "SO");
  assertEquals(body.currency, "USD");
  assert(Array.isArray(body.lines));
  assert(Array.isArray(body.shipTo.contacts));
  const line = body.lines[0];
  assert("orderedQty" in line && "unitPrice" in line);
});
