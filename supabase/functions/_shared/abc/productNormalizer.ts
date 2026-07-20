// ABC Product Normalizer — Phase 1A shared core.
//
// Converts raw ABC catalog item / search responses into a stable
// NormalizedAbcCatalogItem shape that the order-payload builder,
// pricing preview, and UI can safely consume.
//
// Contract (see docs/abc-integration-trace.md):
//   - Never invent fields (description, color, UOM, branches, dimensions).
//   - Never coerce a color object into "[object Object]".
//   - Never default a missing UOM to "EA".
//   - Never discard additional valid UOMs.
//   - A family PARENT is NOT the same as any color CHILD SKU.
//   - Family CHILDREN inherit branch availability ONLY when explicitly
//     present on the child; otherwise `branchVerificationRequired = true`.
//
// This module is additive and NOT wired into any handler in Phase 1A.

import type {
  NormalizedAbcCatalogItem,
  NormalizedAbcSearchResponse,
  NormalizeOptions,
  RawAbcCatalogItem,
  RawAbcSearchResponse,
} from "./types.ts";

// ---------- primitive helpers ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = trimOrNull(v);
    if (s) return s;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "y", "yes", "1"].includes(t)) return true;
    if (["false", "n", "no", "0"].includes(t)) return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---------- color ----------

function normalizeColor(raw: unknown): { colorName: string | null; colorCode: string | null } {
  if (raw == null) return { colorName: null, colorCode: null };

  if (typeof raw === "string") {
    return { colorName: trimOrNull(raw), colorCode: null };
  }

  if (isPlainObject(raw)) {
    const name = firstString(
      raw.name,
      raw.colorName,
      raw.color_name,
      raw.displayName,
      raw.display_name,
      raw.label,
    );
    const code = firstString(
      raw.code,
      raw.colorCode,
      raw.color_code,
      raw.id,
      raw.value,
    );
    return { colorName: name, colorCode: code };
  }

  // Arrays / numbers / other exotic shapes — refuse to invent a value
  // rather than emit "[object Object]".
  return { colorName: null, colorCode: null };
}

// ---------- UOMs ----------

interface NormalizedUom {
  code: string;
  description?: string;
  isDefault?: boolean;
}

function normalizeUomEntry(v: unknown): NormalizedUom | null {
  if (typeof v === "string") {
    const code = trimOrNull(v);
    return code ? { code } : null;
  }
  if (isPlainObject(v)) {
    const code = firstString(v.code, v.uom, v.uomCode, v.unitOfMeasure, v.unit_of_measure, v.value);
    if (!code) return null;
    const description = firstString(v.description, v.name, v.label) ?? undefined;
    const isDefault = toBool(v.isDefault ?? v.is_default ?? v.default) ?? undefined;
    const out: NormalizedUom = { code };
    if (description) out.description = description;
    if (isDefault != null) out.isDefault = isDefault;
    return out;
  }
  return null;
}

function normalizeUoms(raw: RawAbcCatalogItem): NormalizedUom[] {
  const uoms: NormalizedUom[] = [];
  const seen = new Set<string>();
  const push = (entry: NormalizedUom | null) => {
    if (!entry) return;
    const key = entry.code.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    uoms.push(entry);
  };

  const arr = raw.uoms ?? raw.unitOfMeasures ?? raw.unit_of_measures;
  if (Array.isArray(arr)) {
    for (const entry of arr) push(normalizeUomEntry(entry));
  }

  // Legacy scalar variants — ONLY used to supplement, never to invent "EA".
  push(normalizeUomEntry(raw.unitOfMeasure));
  push(normalizeUomEntry(raw.unit_of_measure));
  push(normalizeUomEntry(raw.uom));

  return uoms;
}

// ---------- branches ----------

interface NormalizedBranchRef {
  branchNumber: string;
  name?: string;
  available?: number | null;
}

function normalizeBranchEntry(v: unknown): NormalizedBranchRef | null {
  if (typeof v === "string") {
    const bn = trimOrNull(v);
    return bn ? { branchNumber: bn } : null;
  }
  if (isPlainObject(v)) {
    const bn = firstString(
      v.branchNumber,
      v.branch_number,
      v.branch,
      v.branchCode,
      v.branch_code,
      v.code,
      v.number,
      v.id,
    );
    if (!bn) return null;
    const name = firstString(v.name, v.branchName, v.branch_name, v.label) ?? undefined;
    const avail = toNumber(v.available ?? v.availableQty ?? v.availability ?? v.quantity);
    const out: NormalizedBranchRef = { branchNumber: bn };
    if (name) out.name = name;
    if (avail != null) out.available = avail;
    return out;
  }
  return null;
}

function normalizeBranches(raw: RawAbcCatalogItem): NormalizedBranchRef[] {
  const branches: NormalizedBranchRef[] = [];
  const seen = new Set<string>();
  const push = (entry: NormalizedBranchRef | null) => {
    if (!entry) return;
    if (seen.has(entry.branchNumber)) return;
    seen.add(entry.branchNumber);
    branches.push(entry);
  };

  const candidates = [raw.branches, raw.branchAvailability, raw.branch_availability, raw.availability];
  for (const c of candidates) {
    if (Array.isArray(c)) for (const e of c) push(normalizeBranchEntry(e));
  }

  return branches;
}

// ---------- dimensions / lengths ----------

function normalizeLengths(raw: RawAbcCatalogItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = String(v);
      if (!seen.has(s)) { seen.add(s); out.push(s); }
      return;
    }
    const s = trimOrNull(v);
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  };
  const arr = raw.lengths ?? raw.availableLengths ?? raw.available_lengths;
  if (Array.isArray(arr)) for (const e of arr) push(isPlainObject(e) ? (e.value ?? e.length ?? e.code) : e);
  return out;
}

function normalizeDimensional(raw: RawAbcCatalogItem): boolean | null {
  const candidates = [
    raw.isDimensional,
    raw.is_dimensional,
    raw.dimensional,
    raw.dimensionalIndicator,
    raw.dimensional_indicator,
  ];
  for (const c of candidates) {
    const b = toBool(c);
    if (b != null) return b;
  }
  return null;
}

// ---------- status ----------

function normalizeStatus(raw: RawAbcCatalogItem): { status: string | null; isActive: boolean | null } {
  const status = firstString(raw.status, raw.itemStatus, raw.item_status);
  const explicitActive = toBool(raw.isActive ?? raw.is_active ?? raw.active);
  let isActive: boolean | null = explicitActive;
  if (isActive == null && status) {
    const s = status.toLowerCase();
    if (["active", "a", "available"].includes(s)) isActive = true;
    else if (["inactive", "i", "discontinued", "obsolete", "deleted"].includes(s)) isActive = false;
  }
  return { status, isActive };
}

// ---------- core item normalizer ----------

export function normalizeAbcCatalogItem(
  raw: RawAbcCatalogItem,
  options: NormalizeOptions = {},
): NormalizedAbcCatalogItem {
  const itemNumber = firstString(raw.itemNumber, raw.item_number, raw.itemNo, raw.item_no, raw.sku) ?? "";
  const itemDescription = firstString(
    raw.itemDescription,
    raw.item_description,
    raw.description,
    raw.name,
    raw.longDescription,
    raw.long_description,
  );

  const familyId = firstString(raw.familyId, raw.family_id) ?? null;
  const familyName = firstString(raw.familyName, raw.family_name) ?? null;
  const parentItemNumber = firstString(
    raw.parentItemNumber,
    raw.parent_item_number,
    raw.parentItem,
    raw.parent_item,
    options.parentItemNumber,
  );

  const familyChildrenRaw = Array.isArray(raw.familyItems)
    ? raw.familyItems
    : Array.isArray(raw.family_items)
      ? raw.family_items
      : [];
  const isFamilyItem = familyChildrenRaw.length > 0 || Boolean(raw.isFamilyParent ?? raw.is_family_parent);

  const { colorName, colorCode } = normalizeColor(raw.color ?? raw.colorName ?? raw.color_name);
  const uoms = normalizeUoms(raw);
  const branches = normalizeBranches(raw);
  const lengths = normalizeLengths(raw);
  const isDimensional = normalizeDimensional(raw);
  const { status, isActive } = normalizeStatus(raw);

  // Branch verification gate:
  //   - explicit child (options.isFamilyChild) with no branches → verify
  //   - any item with no branches at all → verify
  //   - selectedBranch provided but not present in normalized branches → verify
  let branchVerificationRequired = false;
  if (options.isFamilyChild && branches.length === 0) branchVerificationRequired = true;
  if (branches.length === 0) branchVerificationRequired = true;
  if (options.selectedBranchNumber) {
    const found = branches.some((b) => b.branchNumber === options.selectedBranchNumber);
    if (!found) branchVerificationRequired = true;
  }

  return {
    itemNumber,
    itemDescription,
    familyId,
    familyName,
    parentItemNumber: parentItemNumber ?? null,
    isFamilyItem,
    isFamilyChild: Boolean(options.isFamilyChild),
    colorName,
    colorCode,
    uoms,
    branches,
    status,
    isActive,
    isDimensional,
    lengths,
    branchVerificationRequired,
    raw,
  };
}

// ---------- search-response normalizer ----------

function extractItems(rawResponse: RawAbcSearchResponse): RawAbcCatalogItem[] {
  if (Array.isArray(rawResponse)) return rawResponse as RawAbcCatalogItem[];
  if (!isPlainObject(rawResponse)) return [];
  const candidates: unknown[] = [
    rawResponse.items,
    rawResponse.data,
    rawResponse.results,
    isPlainObject(rawResponse.data) ? (rawResponse.data as Record<string, unknown>).items : undefined,
    isPlainObject(rawResponse.data) ? (rawResponse.data as Record<string, unknown>).results : undefined,
    rawResponse.products,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c as RawAbcCatalogItem[];
  return [];
}

function extractPagination(rawResponse: RawAbcSearchResponse): Record<string, unknown> | null {
  if (!isPlainObject(rawResponse)) return null;
  const p = rawResponse.pagination ?? rawResponse.paging ?? rawResponse.page;
  if (isPlainObject(p)) return p as Record<string, unknown>;
  const total = toNumber(rawResponse.total ?? rawResponse.totalCount ?? rawResponse.total_count);
  const limit = toNumber(rawResponse.limit ?? rawResponse.pageSize ?? rawResponse.page_size);
  const offset = toNumber(rawResponse.offset ?? rawResponse.skip);
  if (total == null && limit == null && offset == null) return null;
  const out: Record<string, unknown> = {};
  if (total != null) out.total = total;
  if (limit != null) out.limit = limit;
  if (offset != null) out.offset = offset;
  return out;
}

export function normalizeAbcSearchResponse(
  rawResponse: RawAbcSearchResponse,
  options: NormalizeOptions = {},
): NormalizedAbcSearchResponse {
  const raws = extractItems(rawResponse);
  const flat: NormalizedAbcCatalogItem[] = [];
  const seen = new Set<string>();

  const pushIfNew = (item: NormalizedAbcCatalogItem) => {
    if (!item.itemNumber) return;
    if (seen.has(item.itemNumber)) return;
    seen.add(item.itemNumber);
    flat.push(item);
  };

  for (const rawItem of raws) {
    if (!isPlainObject(rawItem)) continue;

    const childrenRaw = Array.isArray(rawItem.familyItems)
      ? rawItem.familyItems
      : Array.isArray(rawItem.family_items)
        ? rawItem.family_items
        : [];

    if (childrenRaw.length > 0) {
      const parentNumber = firstString(rawItem.itemNumber, rawItem.item_number);
      const parentFamilyId = firstString(rawItem.familyId, rawItem.family_id) ?? null;
      const parentFamilyName = firstString(rawItem.familyName, rawItem.family_name) ?? null;

      // Retain parent ONLY if independently orderable (has its own color +
      // branches and no explicit `isFamilyParent` flag suppressing it).
      const parentIndependentlyOrderable =
        rawItem.isFamilyParent !== true &&
        rawItem.is_family_parent !== true &&
        (rawItem.color != null || rawItem.colorName != null || rawItem.color_name != null) &&
        (Array.isArray(rawItem.branches) && rawItem.branches.length > 0);

      if (parentIndependentlyOrderable) {
        pushIfNew(normalizeAbcCatalogItem(rawItem, options));
      }

      for (const child of childrenRaw) {
        if (!isPlainObject(child)) continue;
        // Family children inherit familyId/familyName/parent number when
        // missing on the child, but NEVER inherit color or branches.
        const merged: RawAbcCatalogItem = {
          ...child,
          familyId: (child as Record<string, unknown>).familyId ?? (child as Record<string, unknown>).family_id ?? parentFamilyId,
          familyName: (child as Record<string, unknown>).familyName ?? (child as Record<string, unknown>).family_name ?? parentFamilyName,
          parentItemNumber:
            (child as Record<string, unknown>).parentItemNumber ??
            (child as Record<string, unknown>).parent_item_number ??
            parentNumber ??
            null,
        };
        pushIfNew(normalizeAbcCatalogItem(merged, { ...options, isFamilyChild: true, parentItemNumber: parentNumber ?? undefined }));
      }
    } else {
      pushIfNew(normalizeAbcCatalogItem(rawItem, options));
    }
  }

  return {
    items: flat,
    pagination: extractPagination(rawResponse),
    raw: rawResponse,
  };
}
