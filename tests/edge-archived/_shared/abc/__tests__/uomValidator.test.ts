/**
 * Unit tests for supabase/functions/_shared/abc/uomValidator.ts
 *
 * Runs under `deno test`. No handler integration — pure module contract tests.
 */

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chooseDefaultUom, validateAbcUom } from "../uomValidator.ts";
import type { ResolvedAbcChild } from "../types.ts";

// Minimal ResolvedAbcChild shell — the validator only reads validUoms.
function child(validUoms: unknown): ResolvedAbcChild {
  return {
    itemNumber: "X",
    itemDescription: "X",
    familyId: null,
    familyName: null,
    manufacturer: null,
    parentItemNumber: null,
    color: { displayName: null, rawName: null, code: null, aliasOf: null },
    validUoms: validUoms as ResolvedAbcChild["validUoms"],
    branches: [],
    branchVerificationRequired: false,
    status: null,
    isActive: true,
    isOrderable: true,
    orderabilityReasons: [],
    source: null as unknown as ResolvedAbcChild["source"],
  } as unknown as ResolvedAbcChild;
}

async function loadFixture(name: string) {
  const url = new URL(`./fixtures/uom/${name}.json`, import.meta.url);
  const text = await Deno.readTextFile(url);
  return JSON.parse(text);
}

// ---------- Fixture-backed cases ----------

Deno.test("single sellable UOM auto-selects", async () => {
  const fx = await loadFixture("single-sellable");
  const r = validateAbcUom(child(fx.validUoms));
  assert(r.valid);
  assertEquals(r.selectedUom, "BDL");
  assertEquals(r.reason, "ok");
  assertEquals(r.availableUoms.length, 1);
  assertEquals(r.availableUoms[0].normalizedCode, "BUNDLE");
  assert(r.availableUoms[0].isSellable);
});

Deno.test("multiple sellable UOMs with default selects the default", async () => {
  const fx = await loadFixture("multi-sellable-with-default");
  const r = validateAbcUom(child(fx.validUoms));
  assert(r.valid);
  assertEquals(r.selectedUom, "SQ");
  assertEquals(r.reason, "ok");
});

Deno.test("multiple sellable UOMs without default returns multiple_valid_uoms", async () => {
  const fx = await loadFixture("multi-sellable-no-default");
  const r = validateAbcUom(child(fx.validUoms));
  assertFalse(r.valid);
  assertEquals(r.selectedUom, null);
  assertEquals(r.reason, "multiple_valid_uoms");
});

Deno.test("informational-only list rejects without inventing a UOM", async () => {
  const fx = await loadFixture("informational-only");
  const r = validateAbcUom(child(fx.validUoms));
  assertFalse(r.valid);
  assertEquals(r.reason, "informational_only");
  assertEquals(r.selectedUom, null);
  assert(r.availableUoms.every((u) => !u.isSellable));
});

Deno.test("warehouse-only UOM is not sellable", async () => {
  const fx = await loadFixture("warehouse-only");
  const r = validateAbcUom(child(fx.validUoms));
  assertFalse(r.valid);
  assertEquals(r.reason, "informational_only");
});

Deno.test("mixed informational + sellable picks the sellable one", async () => {
  const fx = await loadFixture("mixed-informational-sellable");
  const r = validateAbcUom(child(fx.validUoms));
  assert(r.valid);
  assertEquals(r.selectedUom, "BDL");
});

Deno.test("duplicate UOMs collapse by normalizedCode", async () => {
  const fx = await loadFixture("duplicate-uoms");
  const r = validateAbcUom(child(fx.validUoms));
  assertEquals(r.availableUoms.length, 1);
  assertEquals(r.availableUoms[0].normalizedCode, "BUNDLE");
  // Prefers the isDefault entry from the duplicates.
  assert(r.availableUoms[0].isDefault);
});

Deno.test("empty UOM list returns missing_uom", async () => {
  const fx = await loadFixture("empty-uoms");
  const r = validateAbcUom(child(fx.validUoms));
  assertFalse(r.valid);
  assertEquals(r.reason, "missing_uom");
});

// ---------- Inline behavior cases ----------

Deno.test("requested valid UOM (exact code) validates", () => {
  const r = validateAbcUom(
    child([{ code: "BDL", description: "Bundle" }, { code: "SQ", description: "Square" }]),
    "BDL",
  );
  assert(r.valid);
  assertEquals(r.selectedUom, "BDL");
});

Deno.test("requested invalid UOM returns invalid_uom", () => {
  const r = validateAbcUom(
    child([{ code: "BDL", description: "Bundle" }]),
    "GALLON",
  );
  assertFalse(r.valid);
  assertEquals(r.reason, "invalid_uom");
});

Deno.test("EA is never invented when ABC does not expose it", () => {
  const r = validateAbcUom(child([{ code: "BDL", description: "Bundle" }]));
  assert(r.valid);
  assertEquals(r.selectedUom, "BDL");
  assert(r.availableUoms.every((u) => u.normalizedCode !== "EACH"));
});

Deno.test("EA is never picked as default when multiple sellable UOMs exist without ABC default flag", () => {
  const r = validateAbcUom(
    child([
      { code: "EA", description: "Each" },
      { code: "BDL", description: "Bundle" },
    ]),
  );
  assertFalse(r.valid);
  assertEquals(r.reason, "multiple_valid_uoms");
  assertEquals(r.selectedUom, null);
});

Deno.test("bundle aliases (BDL, BD, BNDL) all match a Bundle request", () => {
  for (const code of ["BDL", "BD", "BNDL"]) {
    const r = validateAbcUom(child([{ code, description: "Bundle" }]), "bundle");
    assert(r.valid, `expected ${code} to validate for "bundle"`);
    assertEquals(r.selectedUom, code);
  }
});

Deno.test("square aliases (SQ, SQS) match SQUARE", () => {
  for (const code of ["SQ", "SQS", "SQUARE"]) {
    const r = validateAbcUom(child([{ code, description: "Square" }]), "square");
    assert(r.valid, `expected ${code} to validate for "square"`);
    assertEquals(r.selectedUom, code);
  }
});

Deno.test("mixed-case and whitespace UOMs are normalized", () => {
  const r = validateAbcUom(
    child([{ code: "  bDl  ", description: "Bundle" }]),
    "  BUNDLE ",
  );
  assert(r.valid);
  assertEquals(r.selectedUom, "bDl");
  assertEquals(r.availableUoms[0].normalizedCode, "BUNDLE");
});

Deno.test("manufacturer override maps a custom alias", () => {
  const r = validateAbcUom(
    child([{ code: "PKG", description: "Package (mfr bundle)" }]),
    "bundle",
    { manufacturerAliases: { PKG: "BUNDLE" } },
  );
  assert(r.valid);
  assertEquals(r.selectedUom, "PKG");
});

Deno.test("legacy scalar UOM shape (single string entry) is validated", () => {
  // Simulates what the normalizer would produce when only raw.uom exists.
  const r = validateAbcUom(child([{ code: "SQ" }]));
  assert(r.valid);
  assertEquals(r.selectedUom, "SQ");
});

Deno.test("null / non-array validUoms is treated as missing", () => {
  // deno-lint-ignore no-explicit-any
  const bogus = child(null as any);
  const r = validateAbcUom(bogus);
  assertFalse(r.valid);
  assertEquals(r.reason, "missing_uom");
});

Deno.test("requireExplicit blocks auto-selection even when unambiguous", () => {
  const r = validateAbcUom(
    child([{ code: "BDL", description: "Bundle" }]),
    undefined,
    { requireExplicit: true },
  );
  assertFalse(r.valid);
  assertEquals(r.reason, "default_required");
});

Deno.test("requested UOM that resolves to an informational entry is rejected", () => {
  const r = validateAbcUom(
    child([{ code: "BDL", description: "Bundle (Informational only)" }]),
    "bundle",
  );
  assertFalse(r.valid);
  assertEquals(r.reason, "informational_only");
});

Deno.test("chooseDefaultUom returns null when ambiguous", () => {
  assertEquals(
    chooseDefaultUom(
      child([
        { code: "BDL", description: "Bundle" },
        { code: "SQ", description: "Square" },
      ]),
    ),
    null,
  );
});

Deno.test("chooseDefaultUom returns code when unambiguous", () => {
  assertEquals(
    chooseDefaultUom(child([{ code: "SQ", description: "Square", isDefault: true }])),
    "SQ",
  );
});

Deno.test("availableUoms preserve full ValidatedUom shape for downstream modules", () => {
  const r = validateAbcUom(
    child([{ code: "BDL", description: "Bundle", isDefault: true }]),
  );
  const u = r.availableUoms[0];
  assertEquals(u.code, "BDL");
  assertEquals(u.description, "Bundle");
  assertEquals(u.displayName, "Bundle");
  assertEquals(u.normalizedCode, "BUNDLE");
  assertEquals(u.isSellable, true);
  assertEquals(u.isDefault, true);
  assertEquals(u.source, "abc_uoms");
});
