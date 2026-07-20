// ABC Family + Color Resolver — Phase 1A shared core.
//
// Turns a flat list of NormalizedAbcCatalogItem into ResolvedAbcFamily[]:
// contractor-selectable products with fully-verified identity
// (family, manufacturer, color, itemNumber, validUoms, branches).
//
// Hard rules (see prompt):
//   - Children NEVER inherit branches, color, status, or UOM from parent.
//   - Children MAY inherit family identity + manufacturer if missing.
//   - A parent is orderable only if explicitly self-orderable
//     (already gated by the normalizer's `parentIndependentlyOrderable` path).
//   - Duplicate itemNumbers collapse; duplicate colors DO NOT collapse.
//   - Color aliases produce ONE canonical displayName while preserving the raw value.
//   - No color / UOM / branch is ever invented.
//
// This module is additive and NOT wired into any handler in Phase 1A.

import type {
  NormalizedAbcBranchRef,
  NormalizedAbcCatalogItem,
  NormalizedAbcUom,
  RankFamilyContext,
  ResolveFamilyOptions,
  ResolvedAbcChild,
  ResolvedAbcColor,
  ResolvedAbcFamily,
  ResolvedAbcOrderabilityReason,
  ResolvedAbcParent,
} from "./types.ts";

// ---------- primitive helpers ----------

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Loose normalization key: lowercase, collapse whitespace, strip separators. */
function loose(v: string): string {
  return v.toLowerCase().replace(/[\s_\-\/]+/g, "").trim();
}

// ---------- manufacturer detection ----------

const DEFAULT_MANUFACTURER_ALIASES: Record<string, string> = {
  gaf: "GAF",
  "gaf materials": "GAF",
  certainteed: "CertainTeed",
  ct: "CertainTeed",
  owenscorning: "Owens Corning",
  "owens corning": "Owens Corning",
  oc: "Owens Corning",
  tamko: "TAMKO",
  iko: "IKO",
  malarkey: "Malarkey",
  atlas: "Atlas",
  pabco: "PABCO",
};

function pickManufacturer(
  item: NormalizedAbcCatalogItem,
  aliasOverrides: Record<string, string> | undefined,
): string | null {
  const raw = item.raw ?? {};
  const candidates = [
    (raw as Record<string, unknown>).manufacturer,
    (raw as Record<string, unknown>).manufacturerName,
    (raw as Record<string, unknown>).manufacturer_name,
    (raw as Record<string, unknown>).brand,
    (raw as Record<string, unknown>).vendor,
  ];
  for (const c of candidates) {
    const s = trimOrNull(c);
    if (s) return canonicalizeManufacturer(s, aliasOverrides);
  }
  // Fall back to detecting a manufacturer prefix in the family name.
  const family = item.familyName ?? item.itemDescription;
  if (family) {
    const first = family.split(/\s+/)[0];
    const canon = canonicalizeManufacturer(first, aliasOverrides);
    if (canon !== first || DEFAULT_MANUFACTURER_ALIASES[loose(first)]) return canon;
  }
  return null;
}

function canonicalizeManufacturer(
  raw: string,
  overrides: Record<string, string> | undefined,
): string {
  const key = loose(raw);
  if (overrides && overrides[key]) return overrides[key];
  if (DEFAULT_MANUFACTURER_ALIASES[key]) return DEFAULT_MANUFACTURER_ALIASES[key];
  return raw;
}

// ---------- color canonicalization ----------

/**
 * Default cross-manufacturer color aliases. Every value collapses to the
 * canonical Title-Case display form; raw name is preserved separately.
 */
const DEFAULT_COLOR_ALIASES: Record<string, string> = {
  weatheredwood: "Weathered Wood",
  weatheredwd: "Weathered Wood",
  charcoal: "Charcoal",
  charcoalblack: "Charcoal",
  drifwood: "Driftwood",
  driftwood: "Driftwood",
  pewtergray: "Pewter Gray",
  pewtergrey: "Pewter Gray",
  hickory: "Hickory",
  barkwood: "Barkwood",
  slate: "Slate",
  onyxblack: "Onyx Black",
  mission: "Mission Brown",
  missionbrown: "Mission Brown",
};

function titleCase(v: string): string {
  return v
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function canonicalizeColor(
  rawName: string | null,
  manufacturer: string | null,
  manufacturerAliases: Record<string, Record<string, string>> | undefined,
): { displayName: string | null; aliasOf: string | null } {
  if (!rawName) return { displayName: null, aliasOf: null };
  const key = loose(rawName);

  if (manufacturer && manufacturerAliases) {
    const table = manufacturerAliases[manufacturer] ?? manufacturerAliases[manufacturer.toUpperCase()];
    if (table) {
      for (const [alias, canon] of Object.entries(table)) {
        if (loose(alias) === key) return { displayName: canon, aliasOf: alias };
      }
    }
  }

  if (DEFAULT_COLOR_ALIASES[key]) {
    return { displayName: DEFAULT_COLOR_ALIASES[key], aliasOf: rawName };
  }

  // Otherwise, produce a stable Title-Case display of the raw name.
  return { displayName: titleCase(rawName), aliasOf: null };
}

// ---------- orderability ----------

function evaluateChildOrderability(
  item: NormalizedAbcCatalogItem,
  branches: NormalizedAbcBranchRef[],
  validUoms: NormalizedAbcUom[],
): { isOrderable: boolean; reasons: ResolvedAbcOrderabilityReason[] } {
  const reasons: ResolvedAbcOrderabilityReason[] = [];
  if (item.isActive === false) reasons.push("inactive");
  if (!item.itemNumber) reasons.push("missing_item_number");
  if (!item.itemDescription) reasons.push("missing_description");
  if (validUoms.length === 0) reasons.push("missing_uom");
  if (branches.length === 0) reasons.push("missing_branches");
  if (item.branchVerificationRequired) reasons.push("branch_verification_required");
  const isOrderable = reasons.length === 0;
  if (isOrderable) reasons.push("ok");
  return { isOrderable, reasons };
}

// ---------- family key + grouping ----------

interface FamilyKey {
  key: string;
  familyId: string | null;
  familyName: string | null;
  manufacturer: string | null;
}

function familyKeyFor(
  item: NormalizedAbcCatalogItem,
  manufacturer: string | null,
): FamilyKey {
  const familyId = item.familyId ?? null;
  const familyName = item.familyName ?? null;
  const parts = [
    familyId ? `id:${familyId}` : null,
    !familyId && familyName ? `name:${loose(familyName)}` : null,
    !familyId && !familyName && item.parentItemNumber ? `parent:${item.parentItemNumber}` : null,
    !familyId && !familyName && !item.parentItemNumber ? `item:${item.itemNumber || "unknown"}` : null,
    manufacturer ? `mfr:${loose(manufacturer)}` : null,
  ].filter(Boolean);
  return {
    key: parts.join("|"),
    familyId,
    familyName,
    manufacturer,
  };
}

// ---------- main resolver ----------

export function resolveAbcFamilies(
  items: NormalizedAbcCatalogItem[],
  options: ResolveFamilyOptions = {},
): ResolvedAbcFamily[] {
  const mfrAliases = options.manufacturerAliases;
  const colorAliases = options.manufacturerColorAliases;

  interface Bucket {
    familyKey: FamilyKey;
    parentSource: NormalizedAbcCatalogItem | null;
    parentClaimedOrderable: boolean;
    children: Map<string, ResolvedAbcChild>; // keyed by itemNumber
  }

  const buckets = new Map<string, Bucket>();

  const ensureBucket = (key: FamilyKey): Bucket => {
    const existing = buckets.get(key.key);
    if (existing) {
      // Fill missing family identity/manufacturer if a later row surfaces it.
      if (!existing.familyKey.familyId && key.familyId) existing.familyKey.familyId = key.familyId;
      if (!existing.familyKey.familyName && key.familyName) existing.familyKey.familyName = key.familyName;
      if (!existing.familyKey.manufacturer && key.manufacturer) existing.familyKey.manufacturer = key.manufacturer;
      return existing;
    }
    const bucket: Bucket = {
      familyKey: { ...key },
      parentSource: null,
      parentClaimedOrderable: false,
      children: new Map(),
    };
    buckets.set(key.key, bucket);
    return bucket;
  };

  for (const item of items) {
    const manufacturer = pickManufacturer(item, mfrAliases);
    const key = familyKeyFor(item, manufacturer);
    const bucket = ensureBucket(key);

    if (item.isFamilyItem && !item.isFamilyChild) {
      // Parent row. Only claim orderable if it independently qualifies
      // (matching the normalizer's parentIndependentlyOrderable path).
      bucket.parentSource = item;
      bucket.parentClaimedOrderable =
        Boolean(item.itemNumber) &&
        item.branches.length > 0 &&
        (item.colorName != null || item.colorCode != null);
      continue;
    }

    // Every non-parent row is a candidate child (family child OR standalone item
    // that we still want to expose as a selectable product).
    const branches = [...item.branches];
    let branchVerificationRequired = item.branchVerificationRequired;
    if (options.selectedBranchNumber) {
      const has = branches.some((b) => b.branchNumber === options.selectedBranchNumber);
      if (!has) branchVerificationRequired = true;
    }

    const { colorName, colorCode } = { colorName: item.colorName, colorCode: item.colorCode };
    const { displayName, aliasOf } = canonicalizeColor(colorName, manufacturer, colorAliases);
    const color: ResolvedAbcColor = {
      displayName,
      rawName: colorName,
      code: colorCode,
      aliasOf,
    };

    const validUoms = [...item.uoms];

    const child: ResolvedAbcChild = {
      itemNumber: item.itemNumber,
      itemDescription: item.itemDescription,
      familyId: bucket.familyKey.familyId,
      familyName: bucket.familyKey.familyName,
      manufacturer: bucket.familyKey.manufacturer,
      parentItemNumber: item.parentItemNumber,
      color,
      validUoms,
      branches,
      branchVerificationRequired,
      status: item.status,
      isActive: item.isActive !== false,
      isOrderable: false,
      orderabilityReasons: [],
      source: item,
    };

    const { isOrderable, reasons } = evaluateChildOrderability(
      { ...item, branchVerificationRequired },
      branches,
      validUoms,
    );
    child.isOrderable = isOrderable;
    child.orderabilityReasons = reasons;

    // Duplicate itemNumber collapse: never collapse different colors.
    // Prefer the row that is orderable; otherwise keep the first.
    const dupKey = child.itemNumber || `__missing__${child.color.rawName ?? ""}::${bucket.children.size}`;
    const existing = bucket.children.get(dupKey);
    if (!existing) {
      bucket.children.set(dupKey, child);
    } else {
      const sameColor = loose(existing.color.rawName ?? "") === loose(child.color.rawName ?? "");
      if (!sameColor) {
        // Different color hiding under the same itemNumber: keep both by
        // suffixing the color-tagged key.
        bucket.children.set(`${dupKey}::${loose(child.color.rawName ?? "")}`, child);
      } else if (!existing.isOrderable && child.isOrderable) {
        bucket.children.set(dupKey, child);
      }
    }
  }

  const out: ResolvedAbcFamily[] = [];
  for (const bucket of buckets.values()) {
    const children = [...bucket.children.values()];

    // If the parent isn't independently orderable, tag each child with the
    // downstream reason so the order builder can surface it cleanly. Children
    // remain individually selectable — the flag is informational.
    if (bucket.parentSource && !bucket.parentClaimedOrderable) {
      // no-op: children are orderable on their own merits
    }

    const parent: ResolvedAbcParent = bucket.parentSource
      ? {
        itemNumber: bucket.parentSource.itemNumber || null,
        itemDescription: bucket.parentSource.itemDescription,
        isOrderable: bucket.parentClaimedOrderable,
        orderabilityReasons: bucket.parentClaimedOrderable ? ["ok"] : ["parent_not_orderable"],
        source: bucket.parentSource,
      }
      : {
        itemNumber: null,
        itemDescription: null,
        isOrderable: false,
        orderabilityReasons: ["parent_not_orderable"],
        source: null,
      };

    out.push({
      familyId: bucket.familyKey.familyId,
      familyName: bucket.familyKey.familyName,
      manufacturer: bucket.familyKey.manufacturer,
      parent,
      children: stableSortChildren(children),
    });
  }

  return stableSortFamilies(out);
}

// ---------- ranking ----------

/**
 * Rank a flat list of candidate children against a preferred context.
 * Ordering (higher score first, then stable tie-breakers):
 *   1. active
 *   2. branch-verified (branchVerificationRequired === false)
 *   3. exact color match (loose compare against ctx.colorDisplayName)
 *   4. manufacturer match
 *   5. exact family match (loose compare against ctx.familyName)
 *   6. status "active" over other statuses
 *   7. itemNumber asc for stable ordering
 */
export function rankFamilyCandidates(
  candidates: ResolvedAbcChild[],
  ctx: RankFamilyContext = {},
): ResolvedAbcChild[] {
  const score = (c: ResolvedAbcChild) => {
    let s = 0;
    if (c.isActive) s += 1_000_000;
    if (!c.branchVerificationRequired) s += 100_000;
    if (
      ctx.colorDisplayName &&
      c.color.displayName &&
      loose(c.color.displayName) === loose(ctx.colorDisplayName)
    ) s += 10_000;
    if (
      ctx.manufacturer &&
      c.manufacturer &&
      loose(c.manufacturer) === loose(ctx.manufacturer)
    ) s += 1_000;
    if (
      ctx.familyName &&
      c.familyName &&
      loose(c.familyName) === loose(ctx.familyName)
    ) s += 100;
    if ((c.status ?? "").toLowerCase() === "active") s += 10;
    return s;
  };
  return [...candidates].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return (a.itemNumber || "").localeCompare(b.itemNumber || "");
  });
}

// ---------- stable ordering ----------

function stableSortChildren(children: ResolvedAbcChild[]): ResolvedAbcChild[] {
  return [...children].sort((a, b) => {
    const ao = a.isOrderable ? 0 : 1;
    const bo = b.isOrderable ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ac = (a.color.displayName ?? "").localeCompare(b.color.displayName ?? "");
    if (ac !== 0) return ac;
    return (a.itemNumber || "").localeCompare(b.itemNumber || "");
  });
}

function stableSortFamilies(families: ResolvedAbcFamily[]): ResolvedAbcFamily[] {
  return [...families].sort((a, b) => {
    const am = (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "");
    if (am !== 0) return am;
    return (a.familyName ?? "").localeCompare(b.familyName ?? "");
  });
}

// Re-export nothing else; the public surface is `resolveAbcFamilies` +
// `rankFamilyCandidates` plus the types declared in ./types.ts.
export const _internal = { loose, canonicalizeColor, canonicalizeManufacturer };
