// supabase/functions/_shared/mskill/roof-perimeter-offset-defaults.ts
//
// Adaptive eave/rake offset defaults used by create_roof_edge_candidates.
// Keep these in one place so the UI and the executor agree on which preset
// applies for a given roof type.

export type RoofTypeKey = "florida_residential" | "tile" | "metal" | "unknown";

export type OffsetPreset = {
  key: RoofTypeKey;
  label: string;
  eave_offset_ft: number;
  rake_offset_ft: number;
  notes?: string;
};

export const OFFSET_PRESETS: Record<RoofTypeKey, OffsetPreset> = {
  florida_residential: {
    key: "florida_residential",
    label: "Florida residential (default)",
    eave_offset_ft: 2.0,
    rake_offset_ft: 1.5,
  },
  tile: {
    key: "tile",
    label: "Tile roof",
    eave_offset_ft: 2.0,
    rake_offset_ft: 2.0,
  },
  metal: {
    key: "metal",
    label: "Metal roof",
    eave_offset_ft: 1.5,
    rake_offset_ft: 1.5,
  },
  unknown: {
    key: "unknown",
    label: "Unknown roof type",
    eave_offset_ft: 2.0,
    rake_offset_ft: 1.5,
  },
};

/** Uniform-offset candidate set (in feet) — always generated for every job. */
export const UNIFORM_OFFSETS_FT: ReadonlyArray<number> = [1.0, 1.5, 2.0, 2.5, 3.0];

/** Default selected uniform offset when no roof-type rule overrides it. */
export const DEFAULT_SELECTED_OFFSET_FT = 2.0;

export function presetFor(key?: string | null): OffsetPreset {
  if (!key) return OFFSET_PRESETS.unknown;
  return OFFSET_PRESETS[(key as RoofTypeKey)] ?? OFFSET_PRESETS.unknown;
}
