import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mapLeadSource,
  mapRoofType,
  mapStatus,
  normalizeEmail,
  normalizePhone,
  PIPELINE_STATUS_ENUM,
  ROOF_TYPE_ENUM,
} from "./_helpers.ts";

Deno.test("mapRoofType maps common form values to valid enum values", () => {
  const cases: Array<[string, string]> = [
    ["asphalt", "shingle"],
    ["Asphalt", "shingle"],
    ["ASPHALT SHINGLE", "shingle"],
    ["asphalt_shingle", "shingle"],
    ["asphalt shingles", "shingle"],
    ["shingles", "shingle"],
    ["composition", "shingle"],
    ["architectural", "shingle"],
    ["3-tab", "shingle"],
    ["wood", "cedar"],
    ["shake", "cedar"],
    ["clay", "tile"],
    ["concrete tile", "tile"],
    ["tpo", "flat"],
    ["epdm", "flat"],
    ["rubber", "flat"],
    ["vinyl", "vinyl_siding"],
    ["fiber cement", "fiber_cement_siding"],
    ["hardie", "fiber_cement_siding"],
    ["brick", "brick_veneer"],
    ["stone", "stone_veneer"],
    ["shingle", "shingle"], // already valid
    ["metal", "metal"],
    ["tile", "tile"],
    ["flat", "flat"],
    ["slate", "slate"],
    ["cedar", "cedar"],
  ];
  for (const [input, expected] of cases) {
    assertEquals(mapRoofType(input), expected, `mapRoofType("${input}")`);
  }
});

Deno.test("mapRoofType returns null for null/empty and 'other' for unknown", () => {
  assertEquals(mapRoofType(null), null);
  assertEquals(mapRoofType(undefined), null);
  assertEquals(mapRoofType(""), null);
  assertEquals(mapRoofType("not_a_real_thing"), "other");
  assertEquals(mapRoofType("xyz123"), "other");
});

Deno.test("mapRoofType output is always a valid enum value or null", () => {
  const candidates = [
    "asphalt",
    "tpo",
    "wood",
    "unknown_value",
    "BRICK",
    "  shingle  ",
    "fiber cement",
  ];
  for (const c of candidates) {
    const out = mapRoofType(c);
    if (out !== null) {
      const isValid = (ROOF_TYPE_ENUM as readonly string[]).includes(out);
      assertEquals(isValid, true, `Output "${out}" for "${c}" must be in enum`);
    }
  }
});

Deno.test("mapStatus defaults to 'lead' for null/empty/unknown", () => {
  assertEquals(mapStatus(null), "lead");
  assertEquals(mapStatus(undefined), "lead");
  assertEquals(mapStatus(""), "lead");
  assertEquals(mapStatus("garbage_status"), "lead");
});

Deno.test("mapStatus preserves valid enum values", () => {
  for (const s of PIPELINE_STATUS_ENUM) {
    assertEquals(mapStatus(s), s);
  }
});

Deno.test("mapStatus normalizes common UI status strings", () => {
  const cases: Array<[string, string]> = [
    ["new", "lead"],
    ["NEW", "lead"],
    ["new_lead", "lead"],
    ["new lead", "lead"],
    ["qualified", "lead"],
    ["contracted", "contingency_signed"],
    ["signed", "contingency_signed"],
    ["in production", "production"],
    ["done", "completed"],
    ["won", "completed"],
    ["paid", "final_payment"],
  ];
  for (const [input, expected] of cases) {
    assertEquals(mapStatus(input), expected, `mapStatus("${input}")`);
  }
});

Deno.test("mapLeadSource handles enum, common UI keys, and falls back to 'other'", () => {
  assertEquals(mapLeadSource(null), null);
  assertEquals(mapLeadSource(""), null);
  assertEquals(mapLeadSource("referral"), "referral");
  assertEquals(mapLeadSource("google_ads"), "online");
  assertEquals(mapLeadSource("Google Ads"), "online");
  assertEquals(mapLeadSource("facebook"), "social_media");
  assertEquals(mapLeadSource("door knocking"), "canvassing");
  assertEquals(mapLeadSource("yard sign"), "advertisement");
  assertEquals(mapLeadSource("uuid-like-1234"), "other");
});

Deno.test("normalizePhone strips formatting and keeps last 10 digits", () => {
  assertEquals(normalizePhone("(555) 123-4567"), "5551234567");
  assertEquals(normalizePhone("+1 555-123-4567"), "5551234567");
  assertEquals(normalizePhone("555.123.4567"), "5551234567");
  assertEquals(normalizePhone("5551234567"), "5551234567");
  assertEquals(normalizePhone("123"), null);
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone(null), null);
});

Deno.test("normalizeEmail trims/lowercases and rejects invalid", () => {
  assertEquals(normalizeEmail("Foo@Bar.com"), "foo@bar.com");
  assertEquals(normalizeEmail("  user@example.com  "), "user@example.com");
  assertEquals(normalizeEmail("not-an-email"), null);
  assertEquals(normalizeEmail(""), null);
  assertEquals(normalizeEmail(null), null);
  assertNotEquals(normalizeEmail("a@b.co"), null);
});
