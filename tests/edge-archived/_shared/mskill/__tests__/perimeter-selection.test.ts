// Pre-rewire verification: perimeter selection hierarchy contract tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectPerimeter,
  isMathOnlyPerimeter,
  type PerimeterCandidate,
} from "../perimeter-selection.ts";
import { resolveSoffitEaveRule, type SoffitEaveRule } from "../soffit-eave-rules.ts";

const c = (
  source: PerimeterCandidate["source"],
  confidence: PerimeterCandidate["confidence"],
  extra: Partial<PerimeterCandidate> = {},
): PerimeterCandidate => ({
  id: `${source}-${Math.random().toString(36).slice(2, 6)}`,
  source,
  geojson: {},
  confidence,
  ...extra,
});

Deno.test("validated_surface with medium confidence is FINAL", () => {
  const r = selectPerimeter([
    c("generic_fallback", "low"),
    c("validated_surface", "medium", { surface_refined: true }),
  ]);
  assertEquals(r.selected.source, "validated_surface");
  assertEquals(r.status, "final");
});

Deno.test("trusted vendor report beats jurisdiction default", () => {
  const r = selectPerimeter([
    c("jurisdiction_default", "low-medium"),
    c("trusted_vendor_report", "high"),
  ]);
  assertEquals(r.selected.source, "trusted_vendor_report");
  assertEquals(r.status, "final");
});

Deno.test("jurisdiction_roof_type is SELECTED but not FINAL", () => {
  const r = selectPerimeter([c("jurisdiction_roof_type", "medium")]);
  assertEquals(r.status, "selected");
});

Deno.test("only generic_fallback ⇒ NEEDS_REVIEW (no math-only final ever)", () => {
  const r = selectPerimeter([c("generic_fallback", "low")]);
  assertEquals(r.selected.source, "generic_fallback");
  assertEquals(r.status, "needs_review");
});

Deno.test("AI mask boundary outranks jurisdiction rules", () => {
  const r = selectPerimeter([
    c("jurisdiction_roof_type", "medium"),
    c("ai_mask_boundary", "medium"),
  ]);
  assertEquals(r.selected.source, "ai_mask_boundary");
});

Deno.test("isMathOnlyPerimeter classifies offset sources correctly", () => {
  assertEquals(isMathOnlyPerimeter("generic_fallback"), true);
  assertEquals(isMathOnlyPerimeter("jurisdiction_default"), true);
  assertEquals(isMathOnlyPerimeter("jurisdiction_roof_type"), true);
  assertEquals(isMathOnlyPerimeter("validated_surface"), false);
  assertEquals(isMathOnlyPerimeter("trusted_vendor_report"), false);
  assertEquals(isMathOnlyPerimeter("ai_mask_boundary"), false);
});

// --- soffit/eave rule resolution -------------------------------------------

const RULES: SoffitEaveRule[] = [
  {
    id: "generic",
    jurisdiction_type: "unknown",
    jurisdiction_key: null,
    roof_type: "unknown",
    structure_type: "unknown",
    eave_exposure_min_ft: 0.5,
    eave_exposure_default_ft: 1.5,
    eave_exposure_max_ft: 3.0,
    rake_exposure_min_ft: 0.5,
    rake_exposure_default_ft: 1.5,
    rake_exposure_max_ft: 3.0,
    confidence: "low",
    source_reference: "generic_fallback",
    notes: null,
  },
  {
    id: "fl-res-unknown",
    jurisdiction_type: "state",
    jurisdiction_key: "FL",
    roof_type: "unknown",
    structure_type: "residential",
    eave_exposure_min_ft: 1.0,
    eave_exposure_default_ft: 2.0,
    eave_exposure_max_ft: 3.0,
    rake_exposure_min_ft: 0.5,
    rake_exposure_default_ft: 1.5,
    rake_exposure_max_ft: 2.5,
    confidence: "low-medium",
    source_reference: "fl_residential_typical",
    notes: null,
  },
  {
    id: "fl-tile",
    jurisdiction_type: "state",
    jurisdiction_key: "FL",
    roof_type: "tile",
    structure_type: "residential",
    eave_exposure_min_ft: 1.5,
    eave_exposure_default_ft: 2.0,
    eave_exposure_max_ft: 3.0,
    rake_exposure_min_ft: 1.5,
    rake_exposure_default_ft: 2.0,
    rake_exposure_max_ft: 3.0,
    confidence: "medium",
    source_reference: "fl_tile_typical",
    notes: null,
  },
];

Deno.test("rule: exact FL/tile/residential match", () => {
  const r = resolveSoffitEaveRule(RULES, {
    state: "FL",
    roof_type: "tile",
    structure_type: "residential",
  });
  assertEquals(r.rule.id, "fl-tile");
  assertEquals(r.match_specificity, "exact");
  assertEquals(r.roof_type_default_used, false);
  assertEquals(r.confidence, "medium");
});

Deno.test("rule: FL with unknown roof type falls back to FL-residential, confidence clamped", () => {
  const r = resolveSoffitEaveRule(RULES, {
    state: "FL",
    roof_type: "unknown",
    structure_type: "residential",
  });
  assertEquals(r.rule.id, "fl-res-unknown");
  assertEquals(r.match_specificity, "state");
  assertEquals(r.roof_type_default_used, true);
});

Deno.test("rule: unknown state + unknown roof type ⇒ generic fallback, low confidence", () => {
  const r = resolveSoffitEaveRule(RULES, {});
  assertEquals(r.rule.id, "generic");
  assertEquals(r.match_specificity, "generic");
  assertEquals(r.jurisdiction_default_used, true);
  assertEquals(r.roof_type_default_used, true);
  assertEquals(r.confidence, "low");
});
