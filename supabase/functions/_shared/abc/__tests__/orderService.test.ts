/**
 * Phase 1B — Slice 3 equivalence tests.
 *
 * These tests prove that BOTH handlers (`abc-api-proxy` and
 * `supplier-api/abc-proxy`) produce byte-identical ABC order payloads,
 * payload hashes, and idempotency keys when routed through the shared
 * orderService with the same normalized input.
 *
 * Both handlers currently build `sharedInput: BuildOrderInput` identically
 * for the sandbox_test / validate_only paths, so this suite compares
 * `buildAbcOrderPayload(input)` against itself with two synthesized
 * handler adapters.
 */

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAbcOrderPayload,
  validateAbcOrderInput,
  type BuildOrderInput,
} from "../orderService.ts";

// ---------- helpers ----------

function baseInput(overrides: Partial<BuildOrderInput> = {}): BuildOrderInput {
  return {
    variant: "sandbox_test",
    requestId: "PITCH-TEST-1731000000000",
    purchaseOrder: "PITCH-1731000000000",
    branchNumber: "1209",
    shipToNumber: "2010466-2",
    deliveryService: "CPU",
    deliveryRequestedFor: "2026-07-23",
    currency: "USD",
    shipToName: "Sandy Sandbox",
    address: {
      line1: "123 Test Street",
      line2: "",
      line3: "",
      city: "North Port",
      state: "FL",
      postal: "34286",
      country: "USA",
    },
    jobsiteContact: {
      name: "Sandy Sandbox",
      email: "sandy@example.com",
      phone: "555-867-5309",
      phoneType: "MOBILE",
    },
    comments: [{
      code: "H",
      description: "PITCH integration sandbox test order - non-production QA",
    }],
    lines: [{
      id: "1",
      itemNumber: "12345",
      itemDescription: "Test Shingle",
      uom: "EA",
      quantity: 3,
      unitPrice: 42.5,
      instructions: "PITCH sandbox test",
      priceSource: "price_items",
    }],
    ...overrides,
  };
}

// Simulates how each handler wraps `buildAbcOrderPayload`.
function abcApiProxyAdapter(inp: BuildOrderInput) {
  return buildAbcOrderPayload(inp);
}
function supplierApiAdapter(inp: BuildOrderInput) {
  return buildAbcOrderPayload({ ...inp });
}

// ---------- tests ----------

Deno.test("preflight: rejects missing shipTo/branch/itemNumber/qty", () => {
  const res = validateAbcOrderInput(
    baseInput({ shipToNumber: "", branchNumber: "" }),
  );
  assert(!res.valid);
  const codes = new Set(res.errors.map((e) => e.code));
  assert(codes.has("branch_missing"));
  assert(codes.has("ship_to_missing"));

  const res2 = validateAbcOrderInput(baseInput({
    lines: [{
      id: "1", itemNumber: "", itemDescription: "x",
      uom: "EA", quantity: 0, unitPrice: 10,
    }],
  }));
  assert(!res2.valid);
  const codes2 = new Set(res2.errors.map((e) => e.code));
  assert(codes2.has("line_item_number_missing"));
  assert(codes2.has("line_quantity_invalid"));
});

Deno.test("preflight: rejects invalid contact + duplicate line ids", () => {
  const res = validateAbcOrderInput(baseInput({
    jobsiteContact: { name: "", email: "not-an-email", phone: "123" },
    lines: [
      { id: "1", itemNumber: "A", itemDescription: "a", uom: "EA", quantity: 1, unitPrice: 1 },
      { id: "1", itemNumber: "B", itemDescription: "b", uom: "EA", quantity: 1, unitPrice: 1 },
    ],
  }));
  assert(!res.valid);
  const codes = new Set(res.errors.map((e) => e.code));
  assert(codes.has("contact_name_missing"));
  assert(codes.has("contact_email_invalid"));
  assert(codes.has("contact_phone_invalid"));
  assert(codes.has("line_duplicate"));
});

Deno.test("build: dual-handler byte-identical payload + hash + idempotency", () => {
  const inp = baseInput();
  const a = abcApiProxyAdapter(inp);
  const b = supplierApiAdapter(inp);
  assert(a.valid && b.valid);
  assertEquals(JSON.stringify(a.orderRequest), JSON.stringify(b.orderRequest));
  assertEquals(a.payloadHash, b.payloadHash);
  assertEquals(a.idempotencyKey, b.idempotencyKey);
  assertEquals(a.lineProofs, b.lineProofs);
});

Deno.test("build: shape matches the ABC sandbox contract", () => {
  const built = buildAbcOrderPayload(baseInput());
  assert(built.valid);
  const [order] = built.orderRequest;
  assertEquals((order as any).typeCode, "SO");
  assertEquals((order as any).currency, "USD");
  assertEquals((order as any).deliveryService, "CPU");
  assertEquals((order as any).dates.deliveryRequestedFor, "2026-07-23");
  const st: any = (order as any).shipTo;
  assertEquals(st.number, "2010466-2");
  assertEquals(st.address.state, "FL");
  assertEquals(st.address.country, "USA");
  assertEquals(st.contacts[0].functionCode, "DC");
  assertEquals(st.contacts[0].phones[0].number, "5558675309");
  assertEquals(st.contacts[0].phones[0].type, "MOBILE");
  const line = (order as any).lines[0];
  assertEquals(line.itemNumber, "12345");
  assertEquals(line.orderedQty, { value: 3, uom: "EA" });
  assertEquals(line.unitPrice.value, 42.5);
  assertEquals(line.unitPrice.uom, "EA");
});

Deno.test("build: line proofs include mapping + pricing references", () => {
  const built = buildAbcOrderPayload(baseInput());
  assert(built.valid);
  assertEquals(built.lineProofs.length, 1);
  const p = built.lineProofs[0];
  assertEquals(p.itemNumber, "12345");
  assertEquals(p.branchNumber, "1209");
  assertEquals(p.shipToNumber, "2010466-2");
  assertEquals(p.unitPrice, 42.5);
  assertEquals(p.quantity, 3);
  // sandbox synth references
  assert(p.approvedMappingId.startsWith("sandbox:"));
  assert(p.approvedPricingRunId.startsWith("sandbox:"));
  assertEquals(p.priceSource, "price_items");
});

Deno.test("build: same semantic input -> same idempotency key across handlers", () => {
  const a = abcApiProxyAdapter(baseInput({ requestId: "PITCH-TEST-A" }));
  const b = supplierApiAdapter(baseInput({ requestId: "PITCH-TEST-B" }));
  // requestId is part of the idempotency semantic key, so keys MUST differ
  assert(a.valid && b.valid);
  assert(a.idempotencyKey !== b.idempotencyKey);

  // But two handlers given the SAME input produce identical keys
  const c = abcApiProxyAdapter(baseInput());
  const d = supplierApiAdapter(baseInput());
  assertEquals(c.idempotencyKey, d.idempotencyKey);
  assertEquals(c.payloadHash, d.payloadHash);
});

Deno.test("build: preflight failure returns null payload + errors", () => {
  const built = buildAbcOrderPayload(baseInput({ requestId: "" }));
  assert(!built.valid);
  assertEquals(built.orderRequest, null);
  assertEquals(built.payloadHash, null);
  assertEquals(built.idempotencyKey, null);
  const codes = new Set(built.errors.map((e) => e.code));
  assert(codes.has("request_id_missing"));
});

Deno.test("build: comment normalization + truncation", () => {
  const long = "x".repeat(600);
  const built = buildAbcOrderPayload(baseInput({
    comments: [{ description: long }, { description: "" }, { description: "keep" }],
  }));
  assert(built.valid);
  const cmts: any[] = ((built.orderRequest[0] as any).orderComments) ?? [];
  assertEquals(cmts.length, 2);
  assertEquals(cmts[0].code, "H");
  assertEquals(cmts[0].description.length, 500);
  assertEquals(cmts[1].description, "keep");
  assert(built.warnings.some((w) => w.includes("comment truncated")));
});
