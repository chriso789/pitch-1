// Deno tests for productNormalizer.
// Run: deno test supabase/functions/_shared/abc/__tests__/productNormalizer.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeAbcCatalogItem,
  normalizeAbcSearchResponse,
} from "../productNormalizer.ts";

const load = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

Deno.test("simple non-color product", async () => {
  const raw = await load("simple-item.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.itemNumber, "SHNGL-STD-001");
  assertEquals(n.itemDescription, "Standard 3-Tab Shingle Bundle");
  assertEquals(n.colorName, null);
  assertEquals(n.colorCode, null);
  assertEquals(n.uoms.length, 1);
  assertEquals(n.uoms[0].code, "BDL");
  assertEquals(n.branches[0].branchNumber, "101");
  assertEquals(n.isActive, true);
  assertFalse(n.branchVerificationRequired);
});

Deno.test("color as object emits name + code, never [object Object]", async () => {
  const raw = await load("color-object.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.colorName, "Weathered Wood");
  assertEquals(n.colorCode, "WW");
  assert(!JSON.stringify(n).includes("[object Object]"));
});

Deno.test("color as string preserves name, code null", async () => {
  const raw = await load("color-string.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.colorName, "Charcoal");
  assertEquals(n.colorCode, null);
  assertEquals(n.branches.map((b) => b.branchNumber), ["101", "102"]);
});

Deno.test("multiple UOMs preserved and de-duped case-insensitively", async () => {
  const raw = await load("multi-uom.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.uoms.map((u) => u.code), ["RL", "EA", "SQ"]);
  assertEquals(n.uoms[0].isDefault, true);
});

Deno.test("legacy scalar unitOfMeasure preserved without inventing EA", async () => {
  const raw = await load("legacy-scalar-uom.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.uoms.length, 1);
  assertEquals(n.uoms[0].code, "BX");
  assertEquals(n.isActive, true); // "A" → active
});

Deno.test("no UOM data means empty uoms[] — never defaults to EA", async () => {
  const raw = await load("no-uom.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.uoms, []);
});

Deno.test("inactive item flagged, no branches → branchVerificationRequired", async () => {
  const raw = await load("inactive-item.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.isActive, false);
  assertEquals(n.branches, []);
  assert(n.branchVerificationRequired);
});

Deno.test("dimensional item preserves all lengths in order", async () => {
  const raw = await load("dimensional-item.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.isDimensional, true);
  assertEquals(n.lengths, ["10", "12", "16", "20"]);
});

Deno.test("malformed item does not throw, refuses to invent fields", async () => {
  const raw = await load("malformed-item.json");
  const n = normalizeAbcCatalogItem(raw);
  assertEquals(n.itemNumber, "");
  assertEquals(n.itemDescription, null);
  assertEquals(n.colorName, null); // number color → refused
  assertEquals(n.colorCode, null);
  assertEquals(n.uoms, []);
  assertEquals(n.branches, []);
  assert(n.branchVerificationRequired);
});

Deno.test("selectedBranchNumber not present forces branchVerificationRequired", async () => {
  const raw = await load("simple-item.json");
  const n = normalizeAbcCatalogItem(raw, { selectedBranchNumber: "999" });
  assert(n.branchVerificationRequired);
});

Deno.test("family parent flattens into children, parent NOT retained when non-orderable", async () => {
  const raw = await load("family-parent.json");
  const resp = normalizeAbcSearchResponse({ items: [raw] });
  // Parent has isFamilyParent=true, no color, no branches → not retained.
  assertEquals(resp.items.map((i) => i.itemNumber), ["LP-WW", "LP-CH"]);
  const ww = resp.items.find((i) => i.itemNumber === "LP-WW")!;
  const ch = resp.items.find((i) => i.itemNumber === "LP-CH")!;

  // Children inherit family id/name and parent number.
  assertEquals(ww.familyId, "LANDMARK-PRO");
  assertEquals(ww.familyName, "Landmark Pro");
  assertEquals(ww.parentItemNumber, "FAMILY-PARENT-001");
  assert(ww.isFamilyChild);

  // Child WITH explicit branches: not gated.
  assertFalse(ww.branchVerificationRequired);
  assertEquals(ww.branches[0].branchNumber, "101");

  // Child WITHOUT branches: gated for verification.
  assertEquals(ch.branches, []);
  assert(ch.branchVerificationRequired);
});

Deno.test("duplicate child item numbers de-duplicated in flattening", async () => {
  const raw = await load("family-parent.json");
  const resp = normalizeAbcSearchResponse({ items: [raw] });
  const chCount = resp.items.filter((i) => i.itemNumber === "LP-CH").length;
  assertEquals(chCount, 1);
});

Deno.test("child does NOT inherit parent color or branches", async () => {
  const raw = await load("family-parent.json");
  // Add color + branches to the parent to prove they don't leak into children.
  raw.color = { name: "Parent Color", code: "PC" };
  raw.branches = [{ branchNumber: "999" }];
  const resp = normalizeAbcSearchResponse({ items: [raw] });
  const ch = resp.items.find((i) => i.itemNumber === "LP-CH")!;
  assertEquals(ch.colorName, "Charcoal");
  assertEquals(ch.branches, []); // parent branch 999 NOT inherited
});

Deno.test("response wrapped in items[]", async () => {
  const raw = await load("response-items-wrapper.json");
  const resp = normalizeAbcSearchResponse(raw);
  assertEquals(resp.items.length, 1);
  assertEquals(resp.items[0].itemNumber, "WRAP-ITEMS-1");
  assertEquals(resp.pagination?.total, 1);
});

Deno.test("response wrapped in data[]", async () => {
  const raw = await load("response-data-wrapper.json");
  const resp = normalizeAbcSearchResponse(raw);
  assertEquals(resp.items.length, 1);
  assertEquals(resp.items[0].itemNumber, "WRAP-DATA-1");
  assertEquals(resp.pagination?.total, 1);
});

Deno.test("response wrapped in results[]", async () => {
  const raw = await load("response-results-wrapper.json");
  const resp = normalizeAbcSearchResponse(raw);
  assertEquals(resp.items.length, 1);
  assertEquals(resp.items[0].itemNumber, "WRAP-RES-1");
});

Deno.test("no accidental [object Object] anywhere in normalized JSON", async () => {
  const fixtures = [
    "simple-item.json",
    "color-object.json",
    "color-string.json",
    "family-parent.json",
    "multi-uom.json",
    "legacy-scalar-uom.json",
    "no-uom.json",
    "inactive-item.json",
    "dimensional-item.json",
    "malformed-item.json",
  ];
  for (const f of fixtures) {
    const raw = await load(f);
    const n = normalizeAbcCatalogItem(raw);
    assertFalse(JSON.stringify(n).includes("[object Object]"), `leak in ${f}`);
  }
});

Deno.test("family parent retained ONLY when independently orderable", () => {
  const rawOrderableParent = {
    itemNumber: "PARENT-OK",
    color: "SoloColor",
    branches: [{ branchNumber: "101" }],
    familyItems: [
      { itemNumber: "PARENT-OK-CH", color: "Child", branches: [{ branchNumber: "101" }] },
    ],
  };
  const resp = normalizeAbcSearchResponse({ items: [rawOrderableParent] });
  assertEquals(resp.items.map((i) => i.itemNumber).sort(), ["PARENT-OK", "PARENT-OK-CH"]);
});
