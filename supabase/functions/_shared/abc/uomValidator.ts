/**
 * ABC UOM validator — single authority for whether a contractor-selected
 * quantity/UOM can legally be priced or ordered through ABC.
 *
 * Rules (see phase 1A brief):
 *   • Never invent EA.
 *   • Never default to EA.
 *   • Never default to the first UOM unless ABC identifies a preferred selling UOM.
 *   • Reject informational/display/warehouse/internal/non-sellable UOMs.
 *   • Case-insensitive, whitespace-trimmed comparison. Normalize aliases only.
 *
 * Additive only — no handler currently imports this module.
 */

import type { NormalizedAbcUom, ResolvedAbcChild } from "./types.ts";

// ---------- Public types ----------

export type ValidatedUomSource =
  | "abc_uoms"
  | "abc_default_flag"
  | "requested"
  | "alias"
  | "contractor_translation";

/**
 * Enriched UOM entry preserved verbatim for downstream modules (pricing parser
 * and order builder) so they never re-interpret raw Product API UOMs.
 */
export interface ValidatedUom {
  /** Original ABC code as returned on the wire (trimmed only). */
  code: string;
  /** Human display form. Falls back to code when no description was provided. */
  displayName: string;
  /** Original ABC description if any. */
  description: string | null;
  /** Upper-cased, alias-collapsed comparison key (e.g. "BDL" -> "BUNDLE"). */
  normalizedCode: string;
  /** False for informational/display/warehouse/internal entries. */
  isSellable: boolean;
  /** True iff ABC flagged the entry as the preferred selling UOM. */
  isDefault: boolean;
  /** Where this entry originated. Always "abc_uoms" for validator output. */
  source: ValidatedUomSource;
}

export type ValidatedAbcUomReason =
  | "ok"
  | "missing_uom"
  | "invalid_uom"
  | "informational_only"
  | "not_sellable"
  | "multiple_valid_uoms"
  | "default_required";

export interface ValidatedAbcUomResult {
  valid: boolean;
  selectedUom: string | null;
  availableUoms: ValidatedUom[];
  reason: ValidatedAbcUomReason;
  warnings: string[];
}

export interface ValidateUomOptions {
  /**
   * Additional manufacturer-specific alias table. Keys and values are
   * case-insensitive; values are canonical codes (e.g. { "BND": "BUNDLE" }).
   */
  manufacturerAliases?: Record<string, string>;
  /**
   * When true, a caller that does NOT pass requestedUom will never receive an
   * auto-selected UOM. Used by order builders that require explicit intent.
   */
  requireExplicit?: boolean;
}

// ---------- Alias tables (canonical → normalized code) ----------

/**
 * Canonical ABC / industry aliases. All comparison happens upper-case, trimmed.
 * Values are the canonical NORMALIZED code — this is NOT the wire code, it is
 * the equivalence class used for matching.
 */
const CANONICAL_ALIASES: Record<string, string> = {
  // Bundle
  BUNDLE: "BUNDLE",
  BDL: "BUNDLE",
  BD: "BUNDLE",
  BNDL: "BUNDLE",
  // Square (roofing)
  SQUARE: "SQUARE",
  SQ: "SQUARE",
  SQS: "SQUARE",
  // Each
  EACH: "EACH",
  EA: "EACH",
  // Piece
  PIECE: "PIECE",
  PC: "PIECE",
  PCE: "PIECE",
  PCS: "PIECE",
  // Roll
  ROLL: "ROLL",
  RL: "ROLL",
  RLS: "ROLL",
  // Carton
  CARTON: "CARTON",
  CT: "CARTON",
  CTN: "CARTON",
  CTNS: "CARTON",
  // Pallet
  PALLET: "PALLET",
  PL: "PALLET",
  PLT: "PALLET",
  SKID: "PALLET",
  // Foot / linear foot (industry standard sellable units)
  FT: "FT",
  FOOT: "FT",
  LF: "LF",
  LNFT: "LF",
  "LN FT": "LF",
  LINEARFOOT: "LF",
  LINFT: "LF",
  // Square foot
  SF: "SF",
  SQFT: "SF",
  "SQ FT": "SF",
  SQUAREFOOT: "SF",
  // Box
  BOX: "BOX",
  BX: "BOX",
};

/**
 * Contractor-facing canonical UOM vocabulary. Only used when the caller passes
 * a lowercase contractor word (e.g. "bundle"). Ambiguous words are absent.
 */
const CONTRACTOR_ALIASES: Record<string, string> = {
  bundle: "BUNDLE",
  square: "SQUARE",
  piece: "PIECE",
  each: "EACH",
  roll: "ROLL",
  carton: "CARTON",
  pallet: "PALLET",
};

/**
 * Substrings in the UOM description that flag it as NOT sellable. These match
 * ABC's Product API conventions for reference-only or warehouse-only units.
 */
const NON_SELLABLE_MARKERS = [
  "informational",
  "info only",
  "info-only",
  "display only",
  "display-only",
  "warehouse only",
  "warehouse-only",
  "internal",
  "non-sellable",
  "not sellable",
  "not-sellable",
  "reference only",
  "reference-only",
  "not for sale",
];

// ---------- Helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function upperKey(v: unknown): string {
  return trim(v).toUpperCase().replace(/\s+/g, " ");
}

function isNonSellableDescription(desc: string | null | undefined): boolean {
  if (!desc) return false;
  const lower = desc.toLowerCase();
  return NON_SELLABLE_MARKERS.some((m) => lower.includes(m));
}

function resolveAlias(
  code: string,
  overrides?: Record<string, string>,
): { normalized: string; matchedAlias: boolean } {
  const key = upperKey(code);
  if (!key) return { normalized: "", matchedAlias: false };
  if (overrides) {
    // Normalize override keys once per lookup — cheap and keeps callers loose.
    for (const [k, v] of Object.entries(overrides)) {
      if (upperKey(k) === key) {
        const target = upperKey(v);
        return { normalized: target || key, matchedAlias: true };
      }
    }
  }
  const canonical = CANONICAL_ALIASES[key];
  if (canonical) return { normalized: canonical, matchedAlias: canonical !== key };
  return { normalized: key, matchedAlias: false };
}

function translateRequested(
  requested: string,
  overrides?: Record<string, string>,
): string {
  const trimmed = trim(requested);
  if (!trimmed) return "";
  // Contractor lowercase vocabulary — translate ONLY when unambiguous.
  const contractor = CONTRACTOR_ALIASES[trimmed.toLowerCase()];
  if (contractor) return contractor;
  return resolveAlias(trimmed, overrides).normalized;
}

function toValidated(
  entry: NormalizedAbcUom,
  overrides: Record<string, string> | undefined,
): ValidatedUom {
  const code = trim(entry.code);
  const description = trim(entry.description) || null;
  const { normalized } = resolveAlias(code, overrides);
  const isSellable = !isNonSellableDescription(description) &&
    !isNonSellableDescription(code);
  return {
    code,
    displayName: description || code,
    description,
    normalizedCode: normalized,
    isSellable,
    isDefault: !!entry.isDefault,
    source: "abc_uoms",
  };
}

/**
 * Collapse duplicates by normalizedCode, preferring:
 *   1. sellable over non-sellable,
 *   2. default over non-default,
 *   3. first occurrence otherwise (stable order preserved).
 */
function dedupe(entries: ValidatedUom[]): ValidatedUom[] {
  const byKey = new Map<string, ValidatedUom>();
  const order: string[] = [];
  for (const e of entries) {
    const key = e.normalizedCode || e.code.toUpperCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, e);
      order.push(key);
      continue;
    }
    const better =
      (e.isSellable && !existing.isSellable) ||
      (e.isSellable === existing.isSellable && e.isDefault && !existing.isDefault);
    if (better) byKey.set(key, e);
  }
  return order.map((k) => byKey.get(k)!).filter(Boolean);
}

// ---------- Public API ----------

/**
 * Validate the caller's UOM intent against a ResolvedAbcChild.
 *
 * NEVER mutates the input item. NEVER invents a UOM. Returns the enriched
 * ValidatedUom list so downstream modules can rely on a single canonical shape.
 */
export function validateAbcUom(
  item: ResolvedAbcChild,
  requestedUom?: string,
  options: ValidateUomOptions = {},
): ValidatedAbcUomResult {
  const warnings: string[] = [];
  const overrides = options.manufacturerAliases;

  const rawList = Array.isArray(item?.validUoms) ? item.validUoms : [];
  const enriched = rawList
    .map((u) => (u && typeof u === "object" ? u : null))
    .filter((u): u is NormalizedAbcUom => !!u && typeof u.code === "string" && !!u.code.trim())
    .map((u) => toValidated(u, overrides));

  const available = dedupe(enriched);
  const sellable = available.filter((u) => u.isSellable);
  const informationalOnly = available.length > 0 && sellable.length === 0;

  // ---- No UOMs at all ----
  if (available.length === 0) {
    return {
      valid: false,
      selectedUom: null,
      availableUoms: [],
      reason: "missing_uom",
      warnings,
    };
  }

  // ---- Requested UOM path ----
  if (requestedUom != null && trim(requestedUom) !== "") {
    const requested = trim(requestedUom);
    const normalizedRequest = translateRequested(requested, overrides);
    if (!normalizedRequest) {
      warnings.push(`Requested UOM "${requested}" could not be normalized`);
      return {
        valid: false,
        selectedUom: null,
        availableUoms: available,
        reason: "invalid_uom",
        warnings,
      };
    }
    const match = available.find((u) => u.normalizedCode === normalizedRequest);
    if (!match) {
      // If ABC only exposes informational entries, be explicit about that.
      if (informationalOnly) {
        return {
          valid: false,
          selectedUom: null,
          availableUoms: available,
          reason: "informational_only",
          warnings,
        };
      }
      return {
        valid: false,
        selectedUom: null,
        availableUoms: available,
        reason: "invalid_uom",
        warnings,
      };
    }
    if (!match.isSellable) {
      return {
        valid: false,
        selectedUom: null,
        availableUoms: available,
        reason: "informational_only",
        warnings: [
          ...warnings,
          `Requested UOM "${match.code}" is informational-only per ABC`,
        ],
      };
    }
    return {
      valid: true,
      selectedUom: match.code,
      availableUoms: available,
      reason: "ok",
      warnings,
    };
  }

  // ---- No requested UOM: infer only when unambiguous ----
  if (informationalOnly) {
    return {
      valid: false,
      selectedUom: null,
      availableUoms: available,
      reason: "informational_only",
      warnings,
    };
  }
  if (sellable.length === 0) {
    return {
      valid: false,
      selectedUom: null,
      availableUoms: available,
      reason: "not_sellable",
      warnings,
    };
  }
  if (options.requireExplicit) {
    return {
      valid: false,
      selectedUom: null,
      availableUoms: available,
      reason: "default_required",
      warnings,
    };
  }
  if (sellable.length === 1) {
    return {
      valid: true,
      selectedUom: sellable[0].code,
      availableUoms: available,
      reason: "ok",
      warnings,
    };
  }
  const defaults = sellable.filter((u) => u.isDefault);
  if (defaults.length === 1) {
    return {
      valid: true,
      selectedUom: defaults[0].code,
      availableUoms: available,
      reason: "ok",
      warnings,
    };
  }
  return {
    valid: false,
    selectedUom: null,
    availableUoms: available,
    reason: "multiple_valid_uoms",
    warnings,
  };
}

/**
 * Return the ABC code that would be auto-selected as the default UOM, or null
 * when no unambiguous default exists. Never invents EA.
 */
export function chooseDefaultUom(item: ResolvedAbcChild): string | null {
  const result = validateAbcUom(item);
  return result.valid ? result.selectedUom : null;
}
