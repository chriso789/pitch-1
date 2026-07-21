// Snapshot / contract test for the SRS /orders/v2/submit payload.
//
// The current shape is the QA-verified production contract (OAuth → validate
// → submit → real Order ID → webhook → audit). Any change to the top-level
// field set OR to line-item fields is intentionally destabilizing — update
// this test only when SRS confirms a new contract.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSubmitOrderPayload } from "../index.ts";

const REQUIRED_TOP_LEVEL_FIELDS = [
  "sourceSystem",
  "customerCode",
  "shipToSequenceNumber",
  "branchCode",
  "accountNumber",
  "transactionID",
  "transactionDate",
  "notes",
  "shipTo",
  "poDetails",
  "orderLineItemDetails",
  "customerContactInfo",
].sort();

const REQUIRED_LINE_ITEM_FIELDS = [
  "productId",
  "productName",
  "option",
  "quantity",
  "uom",
  "customerItem",
].sort();

function sampleArgs() {
  return {
    sourceSystem: "PITCH",
    customerCode: "S046834",
    accountNumber: "S046834",
    shipToSequenceNumber: 1,
    branchCode: "047",
    poNumber: "PO-TEST-1",
    reference: "REF-1",
    jobNumber: "JOB-1",
    orderDate: "2026-05-18",
    expectedDeliveryDate: "2026-05-19",
    expectedDeliveryTime: "Anytime",
    orderType: "WHSE" as const,
    shippingMethod: "Ground Drop",
    shipTo: {
      addressLine1: "123 Main St",
      city: "Tampa",
      state: "FL",
      zipCode: "33601",
    },
    customerContact: {
      customerContactName: "Jane Doe",
      customerContactPhone: "8135551212",
      customerContactEmail: "jane@example.com",
    },
    notes: "",
    items: [
      { productId: 12345, productName: "Shingle Bundle", option: "N/A", quantity: 30, uom: "EA" },
      { productId: 67890, productName: "Underlayment", option: "N/A", quantity: 5, uom: "RL" },
    ],
  };
}

Deno.test("Submit payload — QA-verified contract: top-level field set is frozen", () => {
  const payload = buildSubmitOrderPayload(sampleArgs());
  const keys = Object.keys(payload).sort();
  assertEquals(keys, REQUIRED_TOP_LEVEL_FIELDS,
    "Top-level payload keys drifted from QA-verified contract. Do NOT edit this test without SRS sign-off.");
});

Deno.test("Submit payload — top-level `jobAccountNumber` is NEVER present", () => {
  const payload = buildSubmitOrderPayload(sampleArgs()) as Record<string, unknown>;
  assert(!("jobAccountNumber" in payload),
    "SRS QA contract omits top-level jobAccountNumber. SRS resolves it from customerCode+shipToSequenceNumber.");
});

Deno.test("Submit payload — line items OMIT price (SRS prices server-side)", () => {
  const payload = buildSubmitOrderPayload(sampleArgs()) as any;
  for (const item of payload.orderLineItemDetails) {
    assert(!("price" in item), "line-item price must be omitted — sending it triggers price-mismatch drops");
    const keys = Object.keys(item).sort();
    assertEquals(keys, REQUIRED_LINE_ITEM_FIELDS,
      "Line-item field set drifted from QA-verified contract.");
  }
});

Deno.test("Submit payload — shipToSequenceNumber defaults to 1", () => {
  const args = sampleArgs();
  // deno-lint-ignore no-explicit-any
  delete (args as any).shipToSequenceNumber;
  const payload = buildSubmitOrderPayload(args) as any;
  assertEquals(payload.shipToSequenceNumber, 1);
});
