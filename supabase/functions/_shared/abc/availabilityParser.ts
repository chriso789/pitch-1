/**
 * ABC availability parser — single authority for interpreting stock/availability
 * signals for an EXACT (itemNumber, branchNumber, shipToNumber) tuple.
 *
 * Additive only — no handler currently imports this module. Never invents
 * availability, never combines quantities across branches, never mutates
 * source items, never silently treats "unknown" as "available".
 *
 * Consumed evidence, in decreasing trust order:
 *   1. Standalone availability response
 *   2. Product API item.branches (from productNormalizer / familyColorResolver)
 *   3. Pricing-line inline availability
 *
 * Freshness: default 4h lifetime. Expired availability is NOT orderable and
 * downgraded to `verification_required`.
 *
 * Zero-price rule: a $0 unitPrice never becomes order-ready automatically —
 * see zero-price rules in the Phase 1A brief.
 */

import type {
  NormalizedAbcBranchRef,
  NormalizedAbcCatalogItem,
  ResolvedAbcChild,
} from "./types.ts";

// ---------- Public types ----------

export interface RawAbcAvailabilityInput {
  item?: NormalizedAbcCatalogItem | ResolvedAbcChild | null;
  productResponse?: unknown;
  pricingLine?: unknown;
  availabilityResponse?: unknown;
}

export interface AvailabilityContext {
  itemNumber: string;
  branchNumber: string;
  shipToNumber: string;
  checkedAt?: string | null;
  unitPrice?: number | null;
}

export type AvailabilityStatus =
  | "available"
  | "limited"
  | "backorder"
  | "allocated"
  | "restricted"
  | "unavailable"
  | "unknown"
  | "verification_required";

export type AvailabilitySource =
  | "product_branches"
  | "pricing_line"
  | "availability_response"
  | "combined"
  | "none";

export type ZeroPriceResolution =
  | "not_applicable"
  | "available_contact_branch"
  | "unavailable_at_branch"
  | "unresolved";

export interface ParsedAbcAvailability {
  status: AvailabilityStatus;
  orderable: boolean;
  quantityAvailable: number | null;
  branchNumber: string;
  shipToNumber: string;
  itemNumber: string;
  source: AvailabilitySource;
  checkedAt: string | null;
  expiresAt: string | null;
  zeroPriceResolution: ZeroPriceResolution;
  reasonCodes: string[];
  warnings: string[];
  raw: unknown;
}

export interface AvailabilityParserOptions {
  /** Availability freshness lifetime in ms. Default 4h. */
  lifetimeMs?: number;
  /** Injectable clock. Accepts Date, ISO string, or epoch ms. */
  now?: Date | string | number;
  /** Treat `backorder` as orderable. Default false. */
  allowBackorder?: boolean;
  /** Treat `limited` as orderable. Default true. */
  allowLimited?: boolean;
}

// ---------- Constants ----------

const DEFAULT_LIFETIME_MS = 4 * 60 * 60 * 1000;

const RESTRICTED_TOKENS = [
  "restricted",
  "blocked",
  "unauthorized",
  "not authorized",
  "not_authorized",
  "prohibited",
];
const UNAVAILABLE_TOKENS = [
  "unavailable",
  "out of stock",
  "out_of_stock",
  "no stock",
  "not available",
  "not_available",
  "discontinued",
  "obsolete",
];
const ALLOCATED_TOKENS = [
  "allocated",
  "reserved",
  "on hold",
  "on_hold",
  "hold",
];
const BACKORDER_TOKENS = [
  "backorder",
  "back order",
  "back_order",
  "backordered",
  "back-ordered",
];
const LIMITED_TOKENS = [
  "limited",
  "low stock",
  "low_stock",
  "low",
];
const AVAILABLE_TOKENS = [
  "available",
  "in stock",
  "in_stock",
  "in-stock",
  "instock",
  "ok",
];

// ---------- Helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function upperKey(v: unknown): string {
  return trim(v).toUpperCase();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (!s) return null;
    if (["true", "t", "yes", "y", "1"].includes(s)) return true;
    if (["false", "f", "no", "n", "0"].includes(s)) return false;
  }
  return null;
}

function parseInstant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  const s = trim(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveNow(now: AvailabilityParserOptions["now"]): Date {
  if (now == null) return new Date();
  const d = parseInstant(now);
  return d ?? new Date();
}

function containsAny(text: string, tokens: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

// ---------- Signal extraction ----------

interface ExtractedSignal {
  /** Ordered from strongest to weakest interpretation. */
  restricted?: boolean;
  hardUnavailable?: boolean;
  allocated?: boolean;
  backorder?: boolean;
  limited?: boolean;
  availableText?: boolean;
  quantity?: number | null;
  branchMatched?: boolean;
  statusText?: string;
}

function extractQuantity(source: Record<string, unknown>): number | null {
  const candidates = [
    "quantityAvailable",
    "availableQuantity",
    "qtyAvailable",
    "quantity_available",
    "available_quantity",
    "qty_available",
    "onHand",
    "on_hand",
    "onhand",
    "quantity",
    "qty",
    "available",
  ];
  for (const key of candidates) {
    if (!(key in source)) continue;
    const v = source[key];
    // Skip "available" if it's a boolean/string — that's a status flag not a qty.
    if (key === "available" && (typeof v === "boolean" || typeof v === "string")) continue;
    const n = toNumber(v);
    if (n != null) return n;
  }
  return null;
}

function extractStatusText(source: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = trim(v);
    if (s) parts.push(s);
  };
  push(source.availabilityStatus);
  push(source.status);
  push(source.stockStatus);
  push(source.stock_status);
  const availability = source.availability;
  if (isObject(availability)) {
    push(availability.status);
    push(availability.message);
    push(availability.code);
  } else if (typeof availability === "string") {
    push(availability);
  }
  const status = source.status;
  if (isObject(status)) {
    push(status.code);
    push(status.message);
    push(status.text);
  }
  // "available" as string flag (e.g. "available": "Yes")
  if (typeof source.available === "string") push(source.available);
  return parts.join(" | ");
}

function extractFlagSignals(source: Record<string, unknown>): ExtractedSignal {
  const sig: ExtractedSignal = {};
  const availableBool = toBool(source.available);
  const backorderBool = toBool(source.backorder ?? source.backOrdered ?? source.back_order);
  const allocatedBool = toBool(source.allocated ?? source.isAllocated);
  const restrictedBool = toBool(source.restricted ?? source.isRestricted ?? source.blocked);

  if (restrictedBool === true) sig.restricted = true;
  if (allocatedBool === true) sig.allocated = true;
  if (backorderBool === true) sig.backorder = true;
  if (availableBool === true) sig.availableText = true;
  if (availableBool === false) sig.hardUnavailable = true;

  const text = extractStatusText(source);
  if (text) {
    sig.statusText = text;
    if (containsAny(text, RESTRICTED_TOKENS)) sig.restricted = true;
    if (containsAny(text, UNAVAILABLE_TOKENS)) sig.hardUnavailable = true;
    if (containsAny(text, ALLOCATED_TOKENS)) sig.allocated = true;
    if (containsAny(text, BACKORDER_TOKENS)) sig.backorder = true;
    if (containsAny(text, LIMITED_TOKENS)) sig.limited = true;
    if (containsAny(text, AVAILABLE_TOKENS)) sig.availableText = true;
  }

  const qty = extractQuantity(source);
  if (qty != null) sig.quantity = qty;

  return sig;
}

/**
 * Find the SELECTED branch on an item.branches array. Returns null if no match.
 * Never combines quantities across branches. If duplicates exist for the same
 * branch, the first non-null quantity wins and remaining duplicates are ignored.
 */
function pickSelectedBranch(
  branches: unknown,
  wantedUpper: string,
): NormalizedAbcBranchRef | null {
  if (!Array.isArray(branches)) return null;
  let firstMatch: NormalizedAbcBranchRef | null = null;
  for (const b of branches) {
    if (!isObject(b)) continue;
    const bn = trim((b as Record<string, unknown>).branchNumber);
    if (!bn) continue;
    if (bn.toUpperCase() !== wantedUpper) continue;
    const ref = b as unknown as NormalizedAbcBranchRef;
    if (!firstMatch) firstMatch = ref;
    // If first match had null available and this one has a number, prefer it.
    else if (
      (firstMatch.available == null) &&
      typeof (b as Record<string, unknown>).available === "number"
    ) {
      firstMatch = ref;
    }
  }
  return firstMatch;
}

function signalFromBranchRef(ref: NormalizedAbcBranchRef): ExtractedSignal {
  const sig: ExtractedSignal = { branchMatched: true };
  const rec = ref as unknown as Record<string, unknown>;
  const qty = typeof ref.available === "number" ? ref.available : extractQuantity(rec);
  if (qty != null) sig.quantity = qty;
  const text = extractStatusText(rec);
  if (text) {
    sig.statusText = text;
    if (containsAny(text, RESTRICTED_TOKENS)) sig.restricted = true;
    if (containsAny(text, UNAVAILABLE_TOKENS)) sig.hardUnavailable = true;
    if (containsAny(text, ALLOCATED_TOKENS)) sig.allocated = true;
    if (containsAny(text, BACKORDER_TOKENS)) sig.backorder = true;
    if (containsAny(text, LIMITED_TOKENS)) sig.limited = true;
    if (containsAny(text, AVAILABLE_TOKENS)) sig.availableText = true;
  }
  return sig;
}

/** Locate a per-branch record inside an availability response payload. */
function pickBranchRecord(
  payload: unknown,
  wantedUpper: string,
): Record<string, unknown> | null {
  const scanArray = (arr: unknown[]): Record<string, unknown> | null => {
    for (const entry of arr) {
      if (!isObject(entry)) continue;
      const bn = upperKey(
        entry.branchNumber ?? entry.branch ?? entry.branchCode ?? entry.branch_number,
      );
      if (bn && bn === wantedUpper) return entry;
    }
    return null;
  };
  if (Array.isArray(payload)) return scanArray(payload);
  if (!isObject(payload)) return null;
  // Common wrappers: { branches: [] } / { availability: [] } / { data: [] } / { items: [] }
  const wrappers = ["branches", "availability", "data", "items", "results", "records"];
  for (const w of wrappers) {
    const inner = (payload as Record<string, unknown>)[w];
    if (Array.isArray(inner)) {
      const hit = scanArray(inner);
      if (hit) return hit;
    }
  }
  // Some responses are per-item with a top-level branchNumber.
  const bn = upperKey(
    (payload as Record<string, unknown>).branchNumber ??
      (payload as Record<string, unknown>).branch ??
      (payload as Record<string, unknown>).branchCode,
  );
  if (bn && bn === wantedUpper) return payload as Record<string, unknown>;
  return null;
}

function mergeSignals(a: ExtractedSignal, b: ExtractedSignal): ExtractedSignal {
  const out: ExtractedSignal = { ...a };
  // Booleans OR together — any evidence of restriction/unavailable stands.
  out.restricted = a.restricted || b.restricted || undefined;
  out.hardUnavailable = a.hardUnavailable || b.hardUnavailable || undefined;
  out.allocated = a.allocated || b.allocated || undefined;
  out.backorder = a.backorder || b.backorder || undefined;
  out.limited = a.limited || b.limited || undefined;
  out.availableText = a.availableText || b.availableText || undefined;
  out.branchMatched = a.branchMatched || b.branchMatched || undefined;
  // Quantity: prefer explicit number; if both, prefer the more restrictive (min for zero, else first).
  if (a.quantity == null) out.quantity = b.quantity ?? null;
  else if (b.quantity == null) out.quantity = a.quantity;
  else out.quantity = a.quantity <= 0 || b.quantity <= 0 ? Math.min(a.quantity, b.quantity) : a.quantity;
  // Status text: concatenate for reason trail.
  const texts = [a.statusText, b.statusText].filter((t): t is string => !!t);
  if (texts.length) out.statusText = texts.join(" || ");
  return out;
}

// ---------- Core parser ----------

/**
 * Interpret a signal + quantity into a status.
 * Applies the required precedence:
 *   restricted > hardUnavailable > allocated > backorder > available-quantity
 *   > generic availability text > unknown
 */
function classify(sig: ExtractedSignal): { status: AvailabilityStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (sig.restricted) {
    reasons.push("restricted");
    return { status: "restricted", reasons };
  }
  if (sig.hardUnavailable) {
    reasons.push("hard_unavailable");
    return { status: "unavailable", reasons };
  }
  if (sig.quantity != null && sig.quantity <= 0 && !sig.backorder && !sig.allocated) {
    reasons.push("hard_zero_quantity");
    return { status: "unavailable", reasons };
  }
  if (sig.allocated) {
    reasons.push("allocated");
    return { status: "allocated", reasons };
  }
  if (sig.backorder) {
    reasons.push("backorder");
    return { status: "backorder", reasons };
  }
  if (sig.quantity != null && sig.quantity > 0) {
    reasons.push("positive_quantity");
    if (sig.limited) {
      reasons.push("limited");
      return { status: "limited", reasons };
    }
    return { status: "available", reasons };
  }
  if (sig.limited) {
    reasons.push("limited_text");
    return { status: "limited", reasons };
  }
  if (sig.availableText) {
    reasons.push("available_text_only");
    return { status: "available", reasons };
  }
  reasons.push("no_signal");
  return { status: "unknown", reasons };
}

function decideOrderable(
  status: AvailabilityStatus,
  options: AvailabilityParserOptions,
): boolean {
  switch (status) {
    case "available":
      return true;
    case "limited":
      return options.allowLimited !== false;
    case "backorder":
      return options.allowBackorder === true;
    case "allocated":
    case "restricted":
    case "unavailable":
    case "unknown":
    case "verification_required":
      return false;
  }
}

// ---------- Public API ----------

export function parseAbcAvailability(
  input: RawAbcAvailabilityInput,
  ctx: AvailabilityContext,
  options: AvailabilityParserOptions = {},
): ParsedAbcAvailability {
  const warnings: string[] = [];
  const itemNumber = trim(ctx?.itemNumber);
  const branchNumber = trim(ctx?.branchNumber);
  const shipToNumber = trim(ctx?.shipToNumber);
  const wantedBranchUpper = branchNumber.toUpperCase();

  const now = resolveNow(options.now);
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
  const checkedAt = parseInstant(ctx?.checkedAt);
  const checkedAtIso = checkedAt ? checkedAt.toISOString() : null;
  const expiresAt = checkedAt
    ? new Date(checkedAt.getTime() + lifetimeMs).toISOString()
    : null;

  const raw: Record<string, unknown> = {
    productResponse: input?.productResponse ?? null,
    pricingLine: input?.pricingLine ?? null,
    availabilityResponse: input?.availabilityResponse ?? null,
    itemBranches: null as unknown,
  };

  // ---- Guard: missing identity ----
  if (!itemNumber || !branchNumber || !shipToNumber) {
    warnings.push("Missing itemNumber/branchNumber/shipToNumber; cannot parse availability.");
    return {
      status: "unknown",
      orderable: false,
      quantityAvailable: null,
      branchNumber,
      shipToNumber,
      itemNumber,
      source: "none",
      checkedAt: checkedAtIso,
      expiresAt,
      zeroPriceResolution: "unresolved",
      reasonCodes: ["missing_identity"],
      warnings,
      raw,
    };
  }

  // ---- Collect signals from each evidence source ----
  const sources: AvailabilitySource[] = [];
  let combined: ExtractedSignal = {};

  // 1. Standalone availability response (highest trust for the SKU × branch tuple).
  if (input?.availabilityResponse != null) {
    const rec = pickBranchRecord(input.availabilityResponse, wantedBranchUpper);
    if (rec) {
      combined = mergeSignals(combined, extractFlagSignals(rec));
      combined.branchMatched = true;
      sources.push("availability_response");
    }
  }

  // 2. Product API branches on the item.
  const item = input?.item ?? null;
  const itemBranches = item && Array.isArray((item as { branches?: unknown }).branches)
    ? (item as { branches: NormalizedAbcBranchRef[] }).branches
    : null;
  raw.itemBranches = itemBranches;
  if (itemBranches) {
    const branchRef = pickSelectedBranch(itemBranches, wantedBranchUpper);
    if (branchRef) {
      combined = mergeSignals(combined, signalFromBranchRef(branchRef));
      sources.push("product_branches");
    } else if (itemBranches.length > 0) {
      warnings.push(
        `Selected branch ${branchNumber} not present on Product API item branches; not inferring from other branches.`,
      );
    }
  }

  // 3. Pricing-line inline availability (weakest — only if it matches).
  if (input?.pricingLine != null && isObject(input.pricingLine)) {
    const line = input.pricingLine;
    const lineBranch = upperKey(
      (line as Record<string, unknown>).branchNumber ??
        (line as Record<string, unknown>).branch ??
        (line as Record<string, unknown>).branchCode,
    );
    // Accept pricing-line signals only if the line targets our branch OR carries no branch scope.
    if (!lineBranch || lineBranch === wantedBranchUpper) {
      const sig = extractFlagSignals(line);
      if (sig.quantity != null || sig.statusText || sig.restricted || sig.hardUnavailable ||
          sig.allocated || sig.backorder || sig.limited || sig.availableText) {
        combined = mergeSignals(combined, sig);
        sources.push("pricing_line");
      }
    }
  }

  const source: AvailabilitySource =
    sources.length === 0 ? "none" : sources.length === 1 ? sources[0] : "combined";

  // ---- Classify ----
  const { status: baseStatus, reasons } = classify(combined);
  let status: AvailabilityStatus = baseStatus;
  const reasonCodes = [...reasons];

  // Warn when we only have generic text with no quantity signal.
  if (baseStatus === "available" && combined.quantity == null && combined.availableText) {
    warnings.push("Availability inferred from status text only; no quantity reported.");
  }

  // ---- Freshness ----
  if (!checkedAt) {
    warnings.push("Missing checkedAt; availability freshness cannot be established.");
    // Only downgrade to verification_required if we had ANY positive signal.
    if (status === "available" || status === "limited") {
      status = "verification_required";
      reasonCodes.push("checkedAt_missing");
    }
  } else if (now.getTime() > checkedAt.getTime() + lifetimeMs) {
    status = "verification_required";
    reasonCodes.push("availability_expired");
  }

  // ---- Orderability (pre zero-price rule) ----
  let orderable = decideOrderable(status, options);

  // ---- Zero-price rules ----
  const unitPrice = typeof ctx.unitPrice === "number" ? ctx.unitPrice : null;
  let zeroPriceResolution: ZeroPriceResolution;
  if (unitPrice == null) {
    zeroPriceResolution = "not_applicable";
  } else if (unitPrice > 0) {
    zeroPriceResolution = "not_applicable";
  } else if (unitPrice === 0) {
    if (status === "available" || status === "limited") {
      zeroPriceResolution = "available_contact_branch";
      orderable = false;
      reasonCodes.push("zero_price_contact_branch");
      warnings.push(
        "ABC returned $0 for an available item; contact branch or verify contract pricing.",
      );
    } else if (status === "unavailable") {
      zeroPriceResolution = "unavailable_at_branch";
      orderable = false;
    } else {
      // unknown, backorder, allocated, restricted, verification_required
      zeroPriceResolution = "unresolved";
      orderable = false;
    }
  } else {
    // Negative price — never orderable, treat as unresolved.
    zeroPriceResolution = "unresolved";
    orderable = false;
    warnings.push("Negative unit price reported; treating as unresolved.");
  }

  const quantityAvailable = combined.quantity ?? null;

  return {
    status,
    orderable,
    quantityAvailable,
    branchNumber,
    shipToNumber,
    itemNumber,
    source,
    checkedAt: checkedAtIso,
    expiresAt,
    zeroPriceResolution,
    reasonCodes,
    warnings,
    raw,
  };
}

/**
 * Cheap freshness-only helper. Does NOT re-check any availability signal —
 * just answers "is this timestamp still within the freshness window?".
 */
export function availabilityExpired(
  checkedAt: string,
  options: AvailabilityParserOptions = {},
): boolean {
  const parsed = parseInstant(checkedAt);
  if (!parsed) return true;
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
  const now = resolveNow(options.now);
  return now.getTime() > parsed.getTime() + lifetimeMs;
}
