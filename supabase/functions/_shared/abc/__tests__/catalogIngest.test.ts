// Phase A/B evidence: family expansion, product classification and fingerprint
// stability for the ABC catalog ingest.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSearchProductsPayload,
} from "../catalogService.ts";
import {
  abcUoms,
  classifyAbcProduct,
  fingerprintItem,
  flattenAbcFamilyItems,
} from "../catalogIngest.ts";

const family = {
  itemNumber: "FAM-TIMBERLINE-HDZ",
  itemDescription: "GAF Timberline HDZ",
  familyId: "F1",
  familyName: "Timberline HDZ",
  supplierName: "GAF",
  hierarchy: {
    productGroup: {
      label: "Roofing",
      category: { label: "Steep Slope", productType: { label: "Laminate Shingle" } },
    },
  },
  uoms: [
    { code: "BD", description: "stocking" },
    { code: "SQ", description: "costing" },
  ],
  familyItems: [
    { itemNumber: "GAF-HDZ-CHAR", itemDescription: "Timberline HDZ Charcoal", color: { name: "Charcoal", code: "CHR" } },
    { itemNumber: "GAF-HDZ-WEAT", itemDescription: "Timberline HDZ Weathered Wood", color: { name: "Weathered Wood", code: "WW" } },
  ],
};

Deno.test("search payload requests family expansion", () => {
  const p = buildSearchProductsPayload({ query: "timberline", branchNumber: "1209" }) as Record<string, unknown>;
  assertEquals(p.familyItems, true);
});

Deno.test("family children become separate SKUs and never inherit the parent item number", () => {
  const flat = flattenAbcFamilyItems([family]);
  assertEquals(flat.length, 3);

  const parent = flat[0] as Record<string, unknown>;
  assertEquals(parent.itemNumber, "FAM-TIMBERLINE-HDZ");
  assertEquals(parent.__isFamilyParent, true);

  const children = flat.slice(1) as Record<string, unknown>[];
  assertEquals(children.map((c) => c.itemNumber), ["GAF-HDZ-CHAR", "GAF-HDZ-WEAT"]);
  for (const c of children) {
    assertEquals(c.__isFamilyParent, false);
    assertEquals(c.__parentItemNumber, "FAM-TIMBERLINE-HDZ");
    // descriptive inheritance only
    assertEquals(c.supplierName, "GAF");
    assert(c.hierarchy);
  }
});

Deno.test("two colors of the same product resolve to different item numbers", () => {
  const flat = flattenAbcFamilyItems([family]).filter((i) => !(i as Record<string, unknown>).__isFamilyParent);
  const byColor = new Map(
    flat.map((i) => {
      const r = i as Record<string, unknown>;
      return [((r.color as Record<string, unknown>)?.name as string) ?? "", r.itemNumber as string];
    }),
  );
  assertEquals(byColor.get("Charcoal"), "GAF-HDZ-CHAR");
  assertEquals(byColor.get("Weathered Wood"), "GAF-HDZ-WEAT");
  assert(byColor.get("Charcoal") !== byColor.get("Weathered Wood"));
});

Deno.test("duplicate item numbers across pages collapse to one row", () => {
  const flat = flattenAbcFamilyItems([family, family]);
  assertEquals(flat.length, 3);
});

Deno.test("hip-and-ridge is never classified as field shingle", () => {
  const hr = classifyAbcProduct("Hip & Ridge", "GAF Seal-A-Ridge Charcoal");
  assertEquals(hr.isHipAndRidge, true);
  assertEquals(hr.isFieldShingle, false);

  const field = classifyAbcProduct("Laminate Shingle", "Timberline HDZ Charcoal");
  assertEquals(field.isFieldShingle, true);
  assertEquals(field.isHipAndRidge, false);

  const acc = classifyAbcProduct("Underlayment", "Synthetic underlayment roll");
  assertEquals(acc.isAccessory, true);
});

Deno.test("stocking UOM wins as the order UOM and is never invented", () => {
  assertEquals(abcUoms(family).order, "BD");
  assertEquals(abcUoms({ uoms: [] }).order, null);
});

Deno.test("fingerprint is stable across key ordering and changes with content", async () => {
  const a = await fingerprintItem({ itemNumber: "X", color: { name: "Charcoal" } });
  const b = await fingerprintItem({ color: { name: "Charcoal" }, itemNumber: "X" });
  const c = await fingerprintItem({ itemNumber: "X", color: { name: "Barkwood" } });
  assertEquals(a, b);
  assert(a !== c);
});
