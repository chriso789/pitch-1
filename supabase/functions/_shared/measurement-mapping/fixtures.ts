// Phase 1.5 fixture corpus — anonymized, normalized measurement imports used by
// mapping_test.ts. Eight scenarios cover the matrix the mapper must handle
// safely. All PII (addresses, names, claim numbers, emails, phones) stripped.
//
// Shape per fixture:
//   - raw_payload : what the provider gave us (informational only)
//   - import      : the measurement_imports row that normalize would create
//   - segments    : the measurement_segments rows the normalizer would emit
//   - features    : the measurement_features rows
//   - expected    : invariants the mapper output must satisfy

import type {
  MeasurementSegment,
  MeasurementFeature,
  SurfaceClass,
} from "./types.ts";

// Lightweight import row shape — only used by fixtures (the real DB type
// lives in the frontend types module and is not needed by the Deno mapper).
interface MeasurementImportFixtureRow {
  id: string;
  tenant_id: string;
  roof_measurement_id: string | null;
  job_id: string | null;
  provider: string;
  import_status: string;
  raw_payload: Record<string, unknown>;
  created_at: string;
}

export interface MappingFixture {
  key: string;
  description: string;
  raw_payload: Record<string, unknown>;
  import: MeasurementImport;
  segments: MeasurementSegment[];
  features: MeasurementFeature[];
  expected: {
    class_totals: Partial<Record<SurfaceClass, number>>;
    aggregate_only: boolean;
    // For a canonical "mixed" template (see fixtures.canonicalTemplate),
    // what the mapper must produce.
    notes?: string[];
  };
}

const TENANT = "00000000-0000-0000-0000-000000000001";

function imp(key: string, status = "normalized"): MeasurementImportFixtureRow {
  return {
    id: `imp-${key}`,
    tenant_id: TENANT,
    roof_measurement_id: `rm-${key}`,
    job_id: null,
    provider: "anonymized",
    import_status: status,
    raw_payload: {},
    created_at: "2026-05-29T00:00:00Z",
  };
}

function seg(
  importKey: string,
  i: number,
  surface_class: SurfaceClass,
  area: number,
  pitch: number | null,
  opts: Partial<MeasurementSegment> = {},
): MeasurementSegment {
  return {
    id: `seg-${importKey}-${i}`,
    tenant_id: TENANT,
    measurement_import_id: `imp-${importKey}`,
    name: opts.name ?? `${surface_class} ${i}`,
    area_sqft: area,
    pitch_rise_over_12: pitch,
    pitch_scope: opts.pitch_scope ?? (pitch == null ? "none" : "segment"),
    surface_class,
    classification_confidence: opts.classification_confidence ?? 0.9,
    classification_reason: opts.classification_reason ?? "fixture",
    is_synthetic_split: opts.is_synthetic_split ?? false,
    is_split_residual: opts.is_split_residual ?? false,
    reviewed: opts.reviewed ?? false,
    archived_at: null,
  };
}

// Canonical template used by tests: 3 groups (flat / sloped / global) with
// items wired through scoped/unscoped item_rules. Defined here so fixtures
// and tests stay in lockstep.
export const canonicalTemplate = {
  calc_template_id: "tpl-canonical",
  groups: [
    { id: "grp-flat", name: "Flat Roof", group_type: "flat", sort_order: 1 },
    { id: "grp-sloped", name: "Sloped Roof", group_type: "sloped", sort_order: 2 },
    { id: "grp-global", name: "Global Materials", group_type: "global", sort_order: 3 },
  ],
  items: [
    { id: "it-flat-membrane", group_id: "grp-flat", item_name: "TPO membrane", unit: "sqft", qty_formula: "class.flat.area_sqft", measurement_type: "area" },
    { id: "it-sloped-shingles", group_id: "grp-sloped", item_name: "Shingles", unit: "sqft", qty_formula: "class.sloped.area_sqft * 1.10", measurement_type: "area" },
    { id: "it-global-dump", group_id: "grp-global", item_name: "Dump fee", unit: "ea", qty_formula: "1", measurement_type: "count" },
    { id: "it-global-total", group_id: "grp-global", item_name: "Underlayment", unit: "sqft", qty_formula: "global.area_sqft", measurement_type: "area" },
  ],
  section_rules: [
    { id: "sr-flat", group_id: "grp-flat", surface_classes: ["flat", "low_slope"] as SurfaceClass[], feature_types: [], min_pitch: null, max_pitch: null, allow_unknown: false, priority: 100 },
    { id: "sr-sloped", group_id: "grp-sloped", surface_classes: ["sloped"] as SurfaceClass[], feature_types: [], min_pitch: null, max_pitch: null, allow_unknown: false, priority: 100 },
  ],
  item_rules: [
    { id: "ir-flat", item_id: "it-flat-membrane", surface_classes: ["flat", "low_slope"] as SurfaceClass[], feature_types: [], measurement_scope: "class" as const, allow_global_fallback: false, allow_unknown: false, min_confidence: 0, exclusive_group: null },
    { id: "ir-sloped", item_id: "it-sloped-shingles", surface_classes: ["sloped"] as SurfaceClass[], feature_types: [], measurement_scope: "class" as const, allow_global_fallback: false, allow_unknown: false, min_confidence: 0, exclusive_group: null },
    // it-global-dump and it-global-total fall through to the default global rule.
  ],
};

// --- 8 scenarios ---

export const fixtures: Record<string, MappingFixture> = {
  aggregate_only_roof: {
    key: "aggregate_only_roof",
    description: "Provider supplied only one total area and a global predominant pitch.",
    raw_payload: { total_area_sqft: 2400, predominant_pitch: "6/12" },
    import: imp("aggregate_only_roof"),
    segments: [seg("aggregate_only_roof", 0, "sloped", 2400, 6, { pitch_scope: "global", name: "Whole roof (aggregate)" })],
    features: [],
    expected: {
      class_totals: { sloped: 2400 },
      aggregate_only: true,
      notes: [
        "it-flat-membrane MUST be unresolved with reason global_only_import or missing_class_measurement (no flat evidence).",
        "it-sloped-shingles MAY assign because sloped class is present.",
        "it-global-total MAY assign with reason global_fallback only if scope=global.",
      ],
    },
  },

  mixed_flat_sloped_roof: {
    key: "mixed_flat_sloped_roof",
    description: "Provider broke out flat and sloped segments explicitly.",
    raw_payload: { flat_area_sqft: 800, sloped_area_sqft: 1600, predominant_pitch: "6/12" },
    import: imp("mixed_flat_sloped_roof"),
    segments: [
      seg("mixed_flat_sloped_roof", 0, "flat", 800, 0, { name: "Flat (provider)" }),
      seg("mixed_flat_sloped_roof", 1, "sloped", 1600, 6),
    ],
    features: [],
    expected: {
      class_totals: { flat: 800, sloped: 1600 },
      aggregate_only: false,
      notes: ["Both class-scoped items must assign with real quantities; no global_fallback."],
    },
  },

  flat_only_roof: {
    key: "flat_only_roof",
    description: "Pure flat roof, no sloped area at all.",
    raw_payload: { total_area_sqft: 3200, predominant_pitch: "0/12" },
    import: imp("flat_only_roof"),
    segments: [seg("flat_only_roof", 0, "flat", 3200, 0)],
    features: [],
    expected: {
      class_totals: { flat: 3200 },
      aggregate_only: false,
      notes: ["it-sloped-shingles MUST be unresolved (missing_class_measurement)."],
    },
  },

  low_slope_only_roof: {
    key: "low_slope_only_roof",
    description: "Low-slope roof (pitch 3/12).",
    raw_payload: { total_area_sqft: 1800, predominant_pitch: "3/12" },
    import: imp("low_slope_only_roof"),
    segments: [seg("low_slope_only_roof", 0, "low_slope", 1800, 3)],
    features: [],
    expected: {
      class_totals: { low_slope: 1800 },
      aggregate_only: false,
      notes: ["it-flat-membrane assigns (rule includes low_slope). it-sloped-shingles unresolved."],
    },
  },

  sloped_only_roof: {
    key: "sloped_only_roof",
    description: "Steep roof, multiple sloped facets.",
    raw_payload: { facets: [{ area: 900, pitch: "8/12" }, { area: 1100, pitch: "6/12" }] },
    import: imp("sloped_only_roof"),
    segments: [
      seg("sloped_only_roof", 0, "sloped", 900, 8),
      seg("sloped_only_roof", 1, "sloped", 1100, 6),
    ],
    features: [],
    expected: {
      class_totals: { sloped: 2000 },
      aggregate_only: false,
      notes: ["it-flat-membrane unresolved. it-sloped-shingles assigns ~2200 (2000 * 1.10)."],
    },
  },

  missing_pitch_roof: {
    key: "missing_pitch_roof",
    description: "Provider supplied an area but no pitch at all.",
    raw_payload: { total_area_sqft: 1500, predominant_pitch: null },
    import: imp("missing_pitch_roof"),
    segments: [seg("missing_pitch_roof", 0, "unknown", 1500, null, {
      pitch_scope: "none",
      classification_confidence: 0.4,
      classification_reason: "no_pitch",
    })],
    features: [],
    expected: {
      class_totals: { unknown: 1500 },
      aggregate_only: true,
      notes: [
        "Both class-scoped items MUST be unresolved.",
        "Global-scoped items assign with reason global_fallback.",
      ],
    },
  },

  provider_flat_override_roof: {
    key: "provider_flat_override_roof",
    description: "Provider flag says 'flat' even though pitch reads 4/12 (low_slope). Provider wins.",
    raw_payload: { provider_class: "flat", area_sqft: 2200, pitch: "4/12" },
    import: imp("provider_flat_override_roof"),
    segments: [seg("provider_flat_override_roof", 0, "flat", 2200, 4, {
      classification_reason: "provider_explicit_flat",
      classification_confidence: 0.95,
    })],
    features: [],
    expected: {
      class_totals: { flat: 2200 },
      aggregate_only: false,
      notes: ["Surface_class=flat is honored despite pitch>2; this is the provider-override fixture."],
    },
  },

  weird_provider_labels_roof: {
    key: "weird_provider_labels_roof",
    description: "Provider used non-standard labels; normalizer mapped to 'other'.",
    raw_payload: { sections: [{ label: "deck-style", area: 600 }, { label: "main", area: 1800, pitch: "7/12" }] },
    import: imp("weird_provider_labels_roof"),
    segments: [
      seg("weird_provider_labels_roof", 0, "other", 600, null, {
        pitch_scope: "none",
        classification_reason: "unmapped_label:deck-style",
        classification_confidence: 0.3,
      }),
      seg("weird_provider_labels_roof", 1, "sloped", 1800, 7),
    ],
    features: [],
    expected: {
      class_totals: { other: 600, sloped: 1800 },
      aggregate_only: false,
      notes: [
        "it-flat-membrane unresolved (no flat/low_slope).",
        "it-sloped-shingles assigns from the sloped 1800 sqft.",
        "'other' segment must not silently feed flat or sloped items.",
      ],
    },
  },
};

export const fixtureList = Object.values(fixtures);
