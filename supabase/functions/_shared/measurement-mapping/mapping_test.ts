// Phase 1 regression tests for section-aware measurement mapping.
// Run via: supabase--test_edge_functions (no network required).

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifySurface } from "./classifier.ts";
import { buildScopedContext } from "./context.ts";
import { evaluateFormula, MissingClassMeasurementError } from "./formula.ts";
import { mapMeasurementsToTemplate } from "./mapper.ts";
import type {
  MeasurementFeature,
  MeasurementSegment,
  TemplateItemRule,
  TemplateSectionRule,
} from "./types.ts";
import { isUnavailable } from "./types.ts";

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

let seq = 0;
const uid = (p: string) => `${p}_${++seq}`;

function seg(partial: Partial<MeasurementSegment>): MeasurementSegment {
  return {
    id: partial.id ?? uid("seg"),
    tenant_id: "t1",
    measurement_import_id: "imp1",
    name: partial.name ?? null,
    area_sqft: partial.area_sqft ?? null,
    pitch_rise_over_12: partial.pitch_rise_over_12 ?? null,
    pitch_scope: partial.pitch_scope ?? "none",
    surface_class: partial.surface_class ?? "unknown",
    classification_confidence: partial.classification_confidence ?? 0.5,
    classification_reason: partial.classification_reason ?? null,
    is_synthetic_split: partial.is_synthetic_split ?? false,
    is_split_residual: partial.is_split_residual ?? false,
    reviewed: partial.reviewed ?? false,
    archived_at: partial.archived_at ?? null,
  };
}

function feat(partial: Partial<MeasurementFeature>): MeasurementFeature {
  return {
    id: partial.id ?? uid("feat"),
    tenant_id: "t1",
    measurement_import_id: "imp1",
    feature_type: partial.feature_type ?? "ridge",
    length_ft: partial.length_ft ?? null,
    count_value: partial.count_value ?? null,
    primary_segment_id: partial.primary_segment_id ?? null,
    confidence: partial.confidence ?? 0.8,
    archived_at: null,
  };
}

function makeTemplate(items: Array<{
  id?: string;
  group?: string;
  formula: string;
  unit?: string;
  rule?: Partial<TemplateItemRule>;
  sectionRule?: Partial<TemplateSectionRule>;
}>) {
  const groups: Array<{ id: string; name: string; group_type: null; sort_order: null }> = [];
  const itemRows: Array<{
    id: string; group_id: string; item_name: string; unit: string | null;
    qty_formula: string; measurement_type: null;
  }> = [];
  const sectionRules: TemplateSectionRule[] = [];
  const itemRules: TemplateItemRule[] = [];
  const seenGroups = new Map<string, string>();
  for (const it of items) {
    const groupName = it.group ?? "default";
    let gid = seenGroups.get(groupName);
    if (!gid) {
      gid = uid("grp");
      seenGroups.set(groupName, gid);
      groups.push({ id: gid, name: groupName, group_type: null, sort_order: null });
      if (it.sectionRule) {
        sectionRules.push({
          id: uid("srule"),
          group_id: gid,
          surface_classes: it.sectionRule.surface_classes ?? [],
          feature_types: it.sectionRule.feature_types ?? [],
          min_pitch: it.sectionRule.min_pitch ?? null,
          max_pitch: it.sectionRule.max_pitch ?? null,
          allow_unknown: it.sectionRule.allow_unknown ?? true,
          priority: it.sectionRule.priority ?? 0,
        });
      }
    }
    const itemId = it.id ?? uid("item");
    itemRows.push({
      id: itemId,
      group_id: gid,
      item_name: itemId,
      unit: it.unit ?? "sqft",
      qty_formula: it.formula,
      measurement_type: null,
    });
    if (it.rule) {
      itemRules.push({
        id: uid("irule"),
        item_id: itemId,
        surface_classes: it.rule.surface_classes ?? [],
        feature_types: it.rule.feature_types ?? [],
        measurement_scope: it.rule.measurement_scope ?? "global",
        allow_global_fallback: it.rule.allow_global_fallback ?? true,
        allow_unknown: it.rule.allow_unknown ?? true,
        min_confidence: it.rule.min_confidence ?? 0,
        exclusive_group: it.rule.exclusive_group ?? null,
      });
    }
  }
  return { groups, items: itemRows, sectionRules, itemRules };
}

// =============================================================================
// 1. Classifier
// =============================================================================

Deno.test("classifier: provider explicit flat beats pitch", () => {
  const r = classifySurface({ pitch_rise_over_12: 8, provider_explicit_flat: true });
  assertEquals(r.surface_class, "flat");
  assert(r.confidence >= 0.95);
});

Deno.test("classifier: pitch < 2 → flat", () => {
  assertEquals(classifySurface({ pitch_rise_over_12: 1.5, pitch_scope: "segment" }).surface_class, "flat");
  assertEquals(classifySurface({ pitch_rise_over_12: 0 }).surface_class, "flat");
});

Deno.test("classifier: 2 <= pitch < 4 → low_slope", () => {
  assertEquals(classifySurface({ pitch_rise_over_12: 2 }).surface_class, "low_slope");
  assertEquals(classifySurface({ pitch_rise_over_12: 3.99 }).surface_class, "low_slope");
});

Deno.test("classifier: pitch >= 4 → sloped", () => {
  assertEquals(classifySurface({ pitch_rise_over_12: 4 }).surface_class, "sloped");
  assertEquals(classifySurface({ pitch_rise_over_12: 12 }).surface_class, "sloped");
});

Deno.test("classifier: missing pitch + no provider → unknown (never guessed)", () => {
  const r = classifySurface({});
  assertEquals(r.surface_class, "unknown");
  assert(r.confidence <= 0.3);
});

Deno.test("classifier: NEVER infers from a 'global totals exist' signal", () => {
  // Caller has only aggregate total; that fact alone must not push to flat/sloped.
  const r = classifySurface({ pitch_rise_over_12: null });
  assertEquals(r.surface_class, "unknown");
});

// =============================================================================
// 2. Formula context
// =============================================================================

Deno.test("context: global.roof_total_sqft available for aggregate import", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    [],
  );
  assertEquals(ctx.global.roof.total_sqft, 2200);
  assert(ctx.meta.aggregate_only);
});

Deno.test("context: class.flat.area_sqft is UNAVAILABLE when no flat segment exists", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 1800, surface_class: "sloped", pitch_scope: "segment", pitch_rise_over_12: 6 })],
    [],
  );
  assert(isUnavailable(ctx.class.flat.area_sqft));
  assertEquals(ctx.class.sloped.area_sqft, 1800);
});

Deno.test("context: class.sloped.area_sqft is UNAVAILABLE when no sloped segment exists", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 400, surface_class: "flat", pitch_scope: "segment", pitch_rise_over_12: 0 })],
    [],
  );
  assert(isUnavailable(ctx.class.sloped.area_sqft));
});

Deno.test("formula: class.<x>.area_sqft throws MissingClassMeasurementError when unavailable", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    [],
  );
  assertThrows(
    () => evaluateFormula("class.flat.area_sqft * 1.10", ctx),
    MissingClassMeasurementError,
  );
});

Deno.test("formula: missing class values NEVER silently evaluate to 0", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    [],
  );
  let threw = false;
  try {
    evaluateFormula("class.sloped.squares", ctx);
  } catch (_e) {
    threw = true;
  }
  assert(threw, "must throw rather than return 0");
});

Deno.test("formula: legacy global formulas still work via global.* and roof.*", () => {
  const ctx = buildScopedContext(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    [],
  );
  assertEquals(evaluateFormula("global.roof.total_sqft / 100", ctx).value, 22);
  assertEquals(evaluateFormula("roof.squares", ctx).value, 22);
});

// =============================================================================
// 3. Mapper
// =============================================================================

const baseInputs = (
  segments: MeasurementSegment[],
  template: ReturnType<typeof makeTemplate>,
  features: MeasurementFeature[] = [],
) => ({
  measurement_import_id: "imp1",
  calc_template_id: "tpl1",
  segments,
  features,
  groups: template.groups,
  items: template.items,
  section_rules: template.sectionRules,
  item_rules: template.itemRules,
});

Deno.test("mapper: legacy parity — aggregate-only + global item → assigned_global_fallback", () => {
  const tpl = makeTemplate([{
    id: "legacy_item",
    formula: "global.roof.total_sqft",
    rule: { measurement_scope: "global", allow_global_fallback: true },
  }]);
  const result = mapMeasurementsToTemplate(baseInputs(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    tpl,
  ));
  assertEquals(result.assignments.length, 1);
  const a = result.assignments[0];
  assertEquals(a.status, "assigned_global_fallback");
  assertEquals(a.reason_code, "global_fallback");
  assertEquals(a.quantity, 2200);
});

Deno.test("mapper: mixed roof split — flat item gets 300, sloped item gets 1800, no cross-assignment", () => {
  const tpl = makeTemplate([
    {
      id: "flat_membrane",
      formula: "class.flat.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["flat"], allow_global_fallback: false },
    },
    {
      id: "shingles",
      formula: "class.sloped.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["sloped"], allow_global_fallback: false },
    },
  ]);
  const result = mapMeasurementsToTemplate(baseInputs(
    [
      seg({ area_sqft: 300, surface_class: "flat", pitch_scope: "segment", pitch_rise_over_12: 0 }),
      seg({ area_sqft: 1800, surface_class: "sloped", pitch_scope: "segment", pitch_rise_over_12: 6 }),
    ],
    tpl,
  ));
  assertEquals(result.unresolved.length, 0);
  const flat = result.assignments.find((a) => a.template_item_id === "flat_membrane")!;
  const sloped = result.assignments.find((a) => a.template_item_id === "shingles")!;
  assertEquals(flat.quantity, 300);
  assertEquals(sloped.quantity, 1800);
  assertEquals(flat.status, "assigned");
  assertEquals(sloped.status, "assigned");
  assertEquals(flat.reason_code, null);
  assertEquals(sloped.reason_code, null);
});

Deno.test("mapper: aggregate-only + class-scoped items → unresolved, no guessed split", () => {
  const tpl = makeTemplate([
    {
      id: "flat_membrane",
      formula: "class.flat.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["flat"], allow_global_fallback: false },
    },
    {
      id: "shingles",
      formula: "class.sloped.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["sloped"], allow_global_fallback: false },
    },
  ]);
  const result = mapMeasurementsToTemplate(baseInputs(
    [seg({ area_sqft: 2200, surface_class: "unknown", pitch_scope: "none" })],
    tpl,
  ));
  assertEquals(result.assignments.length, 0);
  assertEquals(result.unresolved.length, 2);
  for (const u of result.unresolved) {
    assertEquals(u.status, "unresolved");
    assertEquals(u.quantity, null);
    assert(
      u.reason_code === "global_only_import" || u.reason_code === "missing_class_measurement",
      `unexpected reason_code: ${u.reason_code}`,
    );
  }
});

Deno.test("mapper: manual split path — synthetic reviewed segments feed class items with manual_split provenance", () => {
  const tpl = makeTemplate([
    {
      id: "flat_membrane",
      formula: "class.flat.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["flat"], allow_global_fallback: false },
    },
    {
      id: "shingles",
      formula: "class.sloped.area_sqft",
      rule: { measurement_scope: "class", surface_classes: ["sloped"], allow_global_fallback: false },
    },
  ]);
  const result = mapMeasurementsToTemplate(baseInputs(
    [
      seg({
        area_sqft: 350, surface_class: "flat", pitch_scope: "segment",
        pitch_rise_over_12: 0, is_synthetic_split: true, reviewed: true,
        classification_confidence: 1, classification_reason: "manual_split",
      }),
      seg({
        area_sqft: 1850, surface_class: "sloped", pitch_scope: "segment",
        pitch_rise_over_12: 6, is_synthetic_split: true, reviewed: true,
        classification_confidence: 1, classification_reason: "manual_split",
      }),
    ],
    tpl,
  ));
  assertEquals(result.unresolved.length, 0);
  const flat = result.assignments.find((a) => a.template_item_id === "flat_membrane")!;
  const sloped = result.assignments.find((a) => a.template_item_id === "shingles")!;
  assertEquals(flat.quantity, 350);
  assertEquals(sloped.quantity, 1850);
  assertEquals(flat.reason_code, "manual_split");
  assertEquals(sloped.reason_code, "manual_split");
  assertEquals((flat.matched_by as Record<string, unknown>).manual_split, true);
});
