// Soffit / eave rule resolution.
//
// Rules live in the `soffit_eave_rules` table and are looked up from most
// specific to least specific. They are CANDIDATE-GENERATION inputs only —
// surface / DSM / point-cloud / imagery evidence must outrank them when the
// perimeter selection hierarchy runs.
//
// See: docs/existing-measurement-source-verification.md §3.
//      src/components/measurements/RoofPerimeterCandidatePanel.tsx
//      supabase/functions/_shared/mskill/perimeter-selection.ts

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type SoffitConfidence = "low" | "low-medium" | "medium" | "high";
export type RoofType = "shingle" | "tile" | "metal" | "flat" | "unknown";
export type StructureType = "residential" | "commercial" | "unknown";
export type JurisdictionType = "state" | "county" | "city" | "unknown";

export interface SoffitEaveRule {
  id: string;
  jurisdiction_type: JurisdictionType;
  jurisdiction_key: string | null;
  roof_type: RoofType;
  structure_type: StructureType;
  eave_exposure_min_ft: number | null;
  eave_exposure_default_ft: number;
  eave_exposure_max_ft: number | null;
  rake_exposure_min_ft: number | null;
  rake_exposure_default_ft: number;
  rake_exposure_max_ft: number | null;
  confidence: SoffitConfidence;
  source_reference: string | null;
  notes: string | null;
}

export interface RuleLookupInput {
  state?: string | null;
  county?: string | null;
  city?: string | null;
  roof_type?: RoofType | null;
  structure_type?: StructureType | null;
}

export interface ResolvedSoffitRule {
  rule: SoffitEaveRule;
  match_specificity: "exact" | "state+roof_type" | "state" | "generic";
  jurisdiction_default_used: boolean;
  roof_type_default_used: boolean;
  confidence: SoffitConfidence;
  confidence_reason: string;
}

let cached: SoffitEaveRule[] | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

function buildClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function loadSoffitEaveRules(client?: SupabaseClient): Promise<SoffitEaveRule[]> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const sb = client ?? buildClient();
  const { data, error } = await sb
    .from("soffit_eave_rules")
    .select("*")
    .eq("enabled", true);
  if (error) throw error;
  cached = (data ?? []) as SoffitEaveRule[];
  cachedAt = Date.now();
  return cached;
}

/** Reset the in-process cache. Tests only. */
export function _resetSoffitEaveRuleCache(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * Resolve a soffit/eave rule from most-specific to least-specific.
 *
 * Match order:
 *   1. jurisdiction (state) + roof_type + structure_type  → "exact"
 *   2. jurisdiction (state) + roof_type (any structure)   → "state+roof_type"
 *   3. jurisdiction (state) + unknown roof_type           → "state"
 *   4. unknown jurisdiction + unknown roof_type           → "generic"
 *
 * Confidence never rises above the rule's stored confidence. If the rule
 * required a default substitution (jurisdiction or roof_type unknown), the
 * resolved confidence is clamped to "low".
 */
export function resolveSoffitEaveRule(
  rules: SoffitEaveRule[],
  input: RuleLookupInput,
): ResolvedSoffitRule {
  const roofType: RoofType = (input.roof_type ?? "unknown") as RoofType;
  const structure: StructureType = (input.structure_type ?? "unknown") as StructureType;
  const state = input.state ?? null;

  const byKey = (r: SoffitEaveRule) =>
    state && r.jurisdiction_type === "state" && r.jurisdiction_key === state;

  // 1. exact
  const exact = rules.find(
    (r) => byKey(r) && r.roof_type === roofType && r.structure_type === structure && roofType !== "unknown",
  );
  if (exact) {
    return {
      rule: exact,
      match_specificity: "exact",
      jurisdiction_default_used: false,
      roof_type_default_used: false,
      confidence: exact.confidence,
      confidence_reason: `exact match: ${state}/${roofType}/${structure}`,
    };
  }

  // 2. state + roof_type
  const stateRoof = rules.find((r) => byKey(r) && r.roof_type === roofType && roofType !== "unknown");
  if (stateRoof) {
    return {
      rule: stateRoof,
      match_specificity: "state+roof_type",
      jurisdiction_default_used: false,
      roof_type_default_used: false,
      confidence: stateRoof.confidence,
      confidence_reason: `state+roof_type: ${state}/${roofType}`,
    };
  }

  // 3. state default with unknown roof_type
  const stateOnly = rules.find((r) => byKey(r) && r.roof_type === "unknown");
  if (stateOnly) {
    return {
      rule: stateOnly,
      match_specificity: "state",
      jurisdiction_default_used: false,
      roof_type_default_used: true,
      confidence: clampDown(stateOnly.confidence, "low-medium"),
      confidence_reason: `state default; roof_type unknown`,
    };
  }

  // 4. generic
  const generic = rules.find(
    (r) => r.jurisdiction_type === "unknown" && r.roof_type === "unknown",
  );
  if (!generic) {
    throw new Error("soffit_eave_rules table missing generic fallback row");
  }
  return {
    rule: generic,
    match_specificity: "generic",
    jurisdiction_default_used: true,
    roof_type_default_used: true,
    confidence: "low",
    confidence_reason: "generic fallback; jurisdiction and roof_type unknown",
  };
}

function clampDown(c: SoffitConfidence, ceiling: SoffitConfidence): SoffitConfidence {
  const order: SoffitConfidence[] = ["low", "low-medium", "medium", "high"];
  return order[Math.min(order.indexOf(c), order.indexOf(ceiling))];
}
