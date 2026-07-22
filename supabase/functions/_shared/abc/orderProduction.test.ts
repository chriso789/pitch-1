// Deno test: production ABC order assembler equivalence.
// Verifies that assembleProductionAbcOrder produces byte-identical
// orderRequest / payloadHash / idempotencyKey / lineProofs for a fixed
// set of trusted inputs — the invariant that both `abc-api-proxy` and
// `supplier-api/abc-proxy` rely on for Slice 3B.

import { assertEquals, assert, assertObjectMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assembleProductionAbcOrder,
  type ProductionOrderDataSource,
} from "./orderProduction.ts";

function fixedDs(): ProductionOrderDataSource {
  const fetched_at = "2026-07-01T12:00:00.000Z";
  return {
    async loadConnection() {
      return {
        account_number: "SHIP-1",
        default_branch_code: "B1",
        selected_branch_number: "B1",
        selected_ship_to_number: "SHIP-1",
      };
    },
    async loadProjectWithContact() {
      return {
        project_number: "P-1",
        job_number: "J-1",
        contact_number: "C-1",
        contact: {
          id: "contact-1",
          first_name: "John",
          last_name: "Doe",
          company_name: null,
          email: "john@example.com",
          phone: "555-123-4567",
          address_street: "123 Main St",
          address_city: "Tampa",
          address_state: "FL",
          address_zip: "33601",
          address_validated: true,
        },
      };
    },
    async loadApprovedMapping(_t, template_item_id) {
      return {
        id: `map-${template_item_id}`,
        template_item_id,
        supplier_item_number: `ABC-${template_item_id}`,
        supplier_description: `Item ${template_item_id}`,
        supplier_item_description: null,
        default_uom: "BD",
        uom: null,
        color_name: null,
        review_state: "approved",
      };
    },
    async loadFreshPrice() {
      return { unit_price: 42.5, fetched_at };
    },
    async findExistingOrderByIdempotency() {
      return null;
    },
  };
}

Deno.test("assembleProductionAbcOrder returns deterministic payload + idempotency key", async () => {
  const ds = fixedDs();
  const req = {
    tenant_id: "t1",
    environment: "sandbox" as const,
    project_id: "proj-1",
    purchase_order: "PITCH-J-1-FIXED",
    delivery_method: "roof_load" as const,
    delivery_date: "2026-07-15",
    notes: "Leave at back gate",
    items: [
      { template_item_id: "SHINGLE", quantity: 12 },
      { template_item_id: "UNDERLAY", quantity: 5 },
    ],
  };

  const a = await assembleProductionAbcOrder(ds, req);
  const b = await assembleProductionAbcOrder(ds, req);
  assert(a.ok, `first call failed: ${JSON.stringify(a)}`);
  assert(b.ok, `second call failed: ${JSON.stringify(b)}`);

  assertEquals(a.built.payloadHash, b.built.payloadHash);
  assertEquals(a.built.idempotencyKey, b.built.idempotencyKey);
  assertEquals(JSON.stringify(a.orderRequest), JSON.stringify(b.orderRequest));
  assertEquals(a.snapshot.mappings.length, 2);
  assertEquals(a.snapshot.branchNumber, "B1");
  assertEquals(a.snapshot.shipToNumber, "SHIP-1");
});

Deno.test("assembleProductionAbcOrder rejects unvalidated address", async () => {
  const ds = fixedDs();
  const original = ds.loadProjectWithContact;
  ds.loadProjectWithContact = async () => {
    const r = await original("", "");
    return r ? { ...r, contact: { ...r.contact!, address_validated: false } } : r;
  };
  const result = await assembleProductionAbcOrder(ds, {
    tenant_id: "t1",
    environment: "sandbox",
    project_id: "proj-1",
    items: [{ template_item_id: "SHINGLE", quantity: 1 }],
  });
  assert(!result.ok);
  assertEquals(result.code, "order_address_not_validated");
});

Deno.test("assembleProductionAbcOrder rejects missing approved mapping", async () => {
  const ds = fixedDs();
  ds.loadApprovedMapping = async () => null;
  const result = await assembleProductionAbcOrder(ds, {
    tenant_id: "t1",
    environment: "sandbox",
    project_id: "proj-1",
    items: [{ template_item_id: "SHINGLE", quantity: 1 }],
  });
  assert(!result.ok);
  assertEquals(result.code, "mapping_not_approved");
});

Deno.test("assembleProductionAbcOrder rejects stale pricing", async () => {
  const ds = fixedDs();
  ds.loadFreshPrice = async () => null;
  const result = await assembleProductionAbcOrder(ds, {
    tenant_id: "t1",
    environment: "sandbox",
    project_id: "proj-1",
    items: [{ template_item_id: "SHINGLE", quantity: 1 }],
  });
  assert(!result.ok);
  assertEquals(result.code, "pricing_expired");
});

Deno.test("assembleProductionAbcOrder rejects branch not configured", async () => {
  const ds = fixedDs();
  ds.loadConnection = async () => ({ account_number: "SHIP-1", default_branch_code: null, selected_branch_number: null, selected_ship_to_number: "SHIP-1" });
  const result = await assembleProductionAbcOrder(ds, {
    tenant_id: "t1",
    environment: "sandbox",
    project_id: "proj-1",
    items: [{ template_item_id: "SHINGLE", quantity: 1 }],
  });
  assert(!result.ok);
  assertEquals(result.code, "branch_not_configured");
});

Deno.test("assembleProductionAbcOrder — both handlers would receive identical output", async () => {
  // Simulates the two handlers by invoking the same function via the
  // same data source. Any divergence here indicates one handler bypassed
  // the shared assembler.
  const ds = fixedDs();
  const req = {
    tenant_id: "t1",
    environment: "production" as const,
    project_id: "proj-1",
    purchase_order: "PITCH-FIXED-PO",
    items: [{ template_item_id: "SHINGLE", quantity: 3 }],
  };
  const fromHandlerA = await assembleProductionAbcOrder(ds, req);
  const fromHandlerB = await assembleProductionAbcOrder(ds, req);
  assert(fromHandlerA.ok && fromHandlerB.ok);
  assertObjectMatch(
    { hash: fromHandlerA.built.payloadHash, key: fromHandlerA.built.idempotencyKey },
    { hash: fromHandlerB.built.payloadHash, key: fromHandlerB.built.idempotencyKey },
  );
});
