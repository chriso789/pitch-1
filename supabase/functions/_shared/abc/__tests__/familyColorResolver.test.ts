// Deno tests for familyColorResolver.
// Run: deno test supabase/functions/_shared/abc/__tests__/familyColorResolver.test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAbcCatalogItem, normalizeAbcSearchResponse } from "../productNormalizer.ts";
import {
  rankFamilyCandidates,
  resolveAbcFamilies,
} from "../familyColorResolver.ts";
import type { NormalizedAbcCatalogItem, ResolvedAbcChild } from "../types.ts";

const load = async (name: string) =>
  JSON.parse(
    await Deno.readTextFile(
      new URL(`./fixtures/family-color/${name}`, import.meta.url),
    ),
  );

async function resolveFixture(name: string, options: Parameters<typeof resolveAbcFamilies>[1] = {}) {
  const raw = await load(name);
  const norm = normalizeAbcSearchResponse(raw);
  return resolveAbcFamilies(norm.items, options);
}

function allChildren(fams: Awaited<ReturnType<typeof resolveFixture>>): ResolvedAbcChild[] {
  return fams.flatMap((f) => f.children);
}

Deno.test("single-color standalone product resolves to one orderable child", async () => {
  const fams = await resolveFixture("single-color.json");
  assertEquals(fams.length, 1);
  const f = fams[0];
  assertEquals(f.manufacturer, "GAF");
  assertEquals(f.familyName, "GAF Timberline HDZ");
  assertEquals(f.children.length, 1);
  const c = f.children[0];
  assertEquals(c.itemNumber, "GAF-HDZ-CHRCL");
  assertEquals(c.color.displayName, "Charcoal");
  assert(c.isOrderable);
  assertEquals(c.orderabilityReasons, ["ok"]);
});

Deno.test("multi-color family exposes each child; parent is not children", async () => {
  const fams = await resolveFixture("multi-color-family.json");
  assertEquals(fams.length, 1);
  const f = fams[0];
  assertEquals(f.children.length, 3);
  const names = f.children.map((c) => c.color.displayName).sort();
  assertEquals(names, ["Charcoal", "Pewter Gray", "Weathered Wood"]);
  // Alias normalization must produce ONE canonical display for WeatheredWood.
  const ww = f.children.find((c) => c.color.rawName === "WeatheredWood")!;
  assertEquals(ww.color.displayName, "Weathered Wood");
  // Pewter grey (string, lowercase) → Pewter Gray canonical
  const pg = f.children.find((c) => c.color.rawName === "pewter grey")!;
  assertEquals(pg.color.displayName, "Pewter Gray");
});

Deno.test("children never inherit branches from parent", async () => {
  const fams = await resolveFixture("multi-color-family.json");
  const charcoal = fams[0].children.find((c) => c.itemNumber === "GAF-HDZ-CHRCL")!;
  assertEquals(charcoal.branches.map((b) => b.branchNumber), ["101", "102"]);
  const pewter = fams[0].children.find((c) => c.itemNumber === "GAF-HDZ-PWTR")!;
  assertEquals(pewter.branches.map((b) => b.branchNumber), ["103"]);
});

Deno.test("duplicate itemNumbers collapse to one child", async () => {
  const raw = await load("duplicate-children.json");
  // Bypass the search-level dedupe so both duplicate rows reach the resolver.
  const items: NormalizedAbcCatalogItem[] = (raw[0].familyItems as unknown[]).map((c) =>
    normalizeAbcCatalogItem(
      { ...(c as Record<string, unknown>), familyId: raw[0].familyId, familyName: raw[0].familyName, manufacturer: raw[0].manufacturer, parentItemNumber: raw[0].itemNumber },
      { isFamilyChild: true, parentItemNumber: raw[0].itemNumber },
    )
  );
  const fams = resolveAbcFamilies(items);
  const chrcl = fams.flatMap((f) => f.children).filter((c) => c.itemNumber === "GAF-HDZ-CHRCL");
  assertEquals(chrcl.length, 1);
  assert(chrcl[0].isOrderable);
  assertEquals(chrcl[0].branches[0].branchNumber, "101");
});

Deno.test("duplicate color names DO NOT collapse when itemNumbers differ", async () => {
  const fams = await resolveFixture("duplicate-colors.json");
  assertEquals(fams[0].children.length, 2);
  const codes = fams[0].children.map((c) => c.color.code).sort();
  assertEquals(codes, ["CHRCL-A", "CHRCL-B"]);
});

Deno.test("inactive child is not orderable and reports reason", async () => {
  const fams = await resolveFixture("inactive-child.json");
  const disc = allChildren(fams).find((c) => c.itemNumber === "GAF-HDZ-DISC")!;
  assertFalse(disc.isOrderable);
  assertEquals(disc.isActive, false);
  assert(disc.orderabilityReasons.includes("inactive"));
});

Deno.test("inactive parent does not affect child orderability but is flagged", async () => {
  const fams = await resolveFixture("inactive-parent.json");
  assertFalse(fams[0].parent.isOrderable);
  assertEquals(fams[0].parent.orderabilityReasons, ["parent_not_orderable"]);
  const child = fams[0].children[0];
  assert(child.isOrderable);
});

Deno.test("child missing itemNumber / description / uom / branches → not orderable with correct reasons", async () => {
  const raw = await load("child-missing-fields.json");
  // Feed each raw child directly to the item normalizer so the search-level
  // pipeline (which drops itemless rows) can't hide any evidence.
  const items: NormalizedAbcCatalogItem[] = (raw[0].familyItems as unknown[]).map((c) =>
    normalizeAbcCatalogItem(
      { ...(c as Record<string, unknown>), familyId: raw[0].familyId, familyName: raw[0].familyName, manufacturer: raw[0].manufacturer, parentItemNumber: raw[0].itemNumber },
      { isFamilyChild: true, parentItemNumber: raw[0].itemNumber },
    )
  );
  const fams = resolveAbcFamilies(items);
  const kids = fams.flatMap((f) => f.children);

  const missingItem = kids.find((c) => c.itemDescription === "Missing item number");
  assert(missingItem, "missing-itemNumber child was dropped");
  assertFalse(missingItem!.isOrderable);
  assert(missingItem!.orderabilityReasons.includes("missing_item_number"));

  const noDesc = kids.find((c) => c.itemNumber === "GAF-HDZ-NODESC")!;
  assertFalse(noDesc.isOrderable);
  assert(noDesc.orderabilityReasons.includes("missing_description"));

  const noUom = kids.find((c) => c.itemNumber === "GAF-HDZ-NOUOM")!;
  assertFalse(noUom.isOrderable);
  assert(noUom.orderabilityReasons.includes("missing_uom"));

  const noBr = kids.find((c) => c.itemNumber === "GAF-HDZ-NOBR")!;
  assertFalse(noBr.isOrderable);
  assert(noBr.orderabilityReasons.includes("missing_branches"));
  assert(noBr.orderabilityReasons.includes("branch_verification_required"));
});

Deno.test("selectedBranchNumber flips branch verification when child lacks it", async () => {
  const fams = await resolveFixture("multi-color-family.json", {
    selectedBranchNumber: "999",
  });
  for (const c of fams[0].children) {
    assert(c.branchVerificationRequired);
    assertFalse(c.isOrderable);
  }
});

Deno.test("parent-orderable standalone becomes selectable and stays in its own family", async () => {
  const fams = await resolveFixture("parent-orderable.json");
  assertEquals(fams.length, 1);
  assertEquals(fams[0].children.length, 1);
  assert(fams[0].children[0].isOrderable);
});

Deno.test("multiple manufacturers produce distinct families with canonical manufacturer names", async () => {
  const fams = await resolveFixture("multiple-manufacturers.json");
  assertEquals(fams.length, 3);
  const mfrs = fams.map((f) => f.manufacturer).sort();
  assertEquals(mfrs, ["CertainTeed", "GAF", "Owens Corning"]);
});

Deno.test("manufacturer aliases collapse to canonical name", async () => {
  const fams = await resolveFixture("multiple-manufacturers.json", {
    manufacturerAliases: { "gafmaterials": "GAF", "ct": "CertainTeed" },
  });
  const gaf = fams.find((f) => f.manufacturer === "GAF")!;
  assert(gaf);
  assertEquals(gaf.children.length, 1);
});

Deno.test("cross-manufacturer color aliases resolve to canonical display", async () => {
  const fams = await resolveFixture("multiple-manufacturers.json");
  const ct = fams.find((f) => f.manufacturer === "CertainTeed")!;
  assertEquals(ct.children[0].color.displayName, "Charcoal");
  assertEquals(ct.children[0].color.rawName, "Charcoal Black");
  const oc = fams.find((f) => f.manufacturer === "Owens Corning")!;
  assertEquals(oc.children[0].color.displayName, "Driftwood");
  assertEquals(oc.children[0].color.rawName, "Drifwood");
});

Deno.test("manufacturerColorAliases override wins over defaults", async () => {
  const fams = await resolveFixture("multi-color-family.json", {
    manufacturerColorAliases: {
      GAF: { "pewter grey": "Slate Pewter" },
    },
  });
  const pg = fams[0].children.find((c) => c.color.rawName === "pewter grey")!;
  assertEquals(pg.color.displayName, "Slate Pewter");
  assertEquals(pg.color.aliasOf, "pewter grey");
});

Deno.test("rankFamilyCandidates ranks by active, branch, color, mfr, family, status", async () => {
  const fams = await resolveFixture("multi-color-family.json");
  const kids = allChildren(fams);
  const ranked = rankFamilyCandidates(kids, {
    manufacturer: "GAF",
    familyName: "GAF Timberline HDZ",
    colorDisplayName: "Weathered Wood",
  });
  assertEquals(ranked[0].color.displayName, "Weathered Wood");
});

Deno.test("resolver produces stable ordering across runs", async () => {
  const a = await resolveFixture("multi-color-family.json");
  const b = await resolveFixture("multi-color-family.json");
  assertEquals(
    a.flatMap((f) => f.children.map((c) => c.itemNumber)),
    b.flatMap((f) => f.children.map((c) => c.itemNumber)),
  );
});

Deno.test("resolver never emits [object Object] anywhere in serialized output", async () => {
  for (
    const fx of [
      "single-color.json",
      "multi-color-family.json",
      "duplicate-children.json",
      "duplicate-colors.json",
      "inactive-child.json",
      "inactive-parent.json",
      "child-missing-fields.json",
      "parent-orderable.json",
      "multiple-manufacturers.json",
    ]
  ) {
    const fams = await resolveFixture(fx);
    const s = JSON.stringify(fams);
    assertFalse(s.includes("[object Object]"), `[object Object] leaked in ${fx}`);
  }
});
