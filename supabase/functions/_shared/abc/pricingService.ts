/**
 * Shared ABC pricing service — Phase 1B, Slice 2.
 *
 * Single authority for the ABC `POST /pricing/v2/prices` (Price Items) call at
 * BOTH the wire and parsing level. Both `abc-api-proxy` (legacy) and
 * `supplier-api/abc/proxy` (v2) import this module so the payload we send to
 * ABC and the parsed pricing verdict returned to callers stay byte-identical
 * across handlers.
 *
 * Non-goals (deliberately excluded from this slice):
 *   • Auth / token acquisition          — handler-owned.
 *   • JWT / tenant resolution           — handler-owned.
 *   • Audit logging                     — handler-owned.
 *   • Pricing-history persistence       — handler-owned
 *                                          (supplier_pricing_runs / supplier_price_history).
 *   • Order submission / payload builder — untouched.
 *
 * Contract rules (mirrors the Phase 1B brief):
 *   • Never fabricate prices; never rewrite itemNumber / UOM silently.
 *   • HTTP 200 is NEVER pricing success — callers must consume
 *     `result.parsed.runStatus`, not `result.status`.
 *   • Zero unit price is NEVER `usableForOrder`. Preserved from the parser.
 *   • Canonical validation rejects: missing shipToNumber / branchNumber /
 *     itemNumber / uom, and quantity <= 0.
 */
import type { AbcCallAbc, AbcMapError } from "./catalogService.ts";
import {
  type AbcPricingParseContext,
  type AbcPricingParserOptions,
  type AbcPricingRequestedLine,
  type ParsedAbcPricingLine,
  type ParsedAbcPricingResponse,
  type ParsedAbcPricingRunStatus,
  parseAbcPricingResponse,
} from "./pricingResponseParser.ts";

// ---------- Public request contract ----------

export type AbcPricePurpose = "estimating" | "quoting" | "ordering";

export interface AbcPricingServiceRequestLine {
  id?: string | null;
  itemNumber: string;
  quantity: number;
  uom: string;
  /** Optional passthrough for history rows (never sent on the wire). */
  itemDescription?: string | null;
  mappingId?: string | null;
  templateItemId?: string | null;
  estimateLineItemId?: string | null;
}

export interface AbcPricingServiceRequest {
  requestId?: string | null;
  shipToNumber: string;
  branchNumber: string;
  purpose?: AbcPricePurpose | null;
  lines: AbcPricingServiceRequestLine[];
}

// ---------- Public output contract ----------

export interface AbcPricingWirePayload {
  requestId: string;
  shipToNumber: string;
  branchNumber: string;
  purpose: AbcPricePurpose;
  lines: Array<{ id: string; itemNumber: string; quantity: number; uom: string }>;
}

export interface AbcPricingServiceCounts {
  requested: number;
  ok: number;
  zeroPrice: number;
  unavailable: number;
  rejected: number;
  missing: number;
  mismatched: number;
  malformed: number;
}

export interface AbcPricingValidationError {
  ok: false;
  error_code:
    | "missing_ship_to"
    | "missing_branch"
    | "missing_lines"
    | "invalid_line";
  missing: string[];
  message: string;
}

export interface AbcPricingServiceResult {
  success: boolean;
  endpoint: string;
  request: AbcPricingWirePayload;
  status: number;
  /** Raw ABC response body (json when parseable, else text). Preserved for audit. */
  body: unknown;
  error_code: string | null;
  parsed: ParsedAbcPricingResponse;
  runStatus: ParsedAbcPricingRunStatus;
  counts: AbcPricingServiceCounts;
  warnings: string[];
}

// ---------- Small helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizePurpose(v: unknown): AbcPricePurpose {
  const s = trim(v).toLowerCase();
  if (s === "ordering") return "ordering";
  if (s === "quoting") return "quoting";
  return "estimating";
}

/** Purpose accepted by the parser (narrower than the wire contract). */
function purposeForParser(p: AbcPricePurpose): "estimating" | "ordering" {
  return p === "ordering" ? "ordering" : "estimating";
}

// ---------- Validation ----------

/**
 * Canonical validation. Returns null when the request is send-safe, or a
 * discriminated error describing which fields failed. Handlers surface this to
 * the caller as HTTP 400 without ever touching the wire.
 */
export function validatePricingRequest(
  req: AbcPricingServiceRequest,
): AbcPricingValidationError | null {
  const missing: string[] = [];
  if (!trim(req?.shipToNumber)) missing.push("shipToNumber");
  if (!trim(req?.branchNumber)) missing.push("branchNumber");
  if (missing.length) {
    return {
      ok: false,
      error_code: missing[0] === "shipToNumber" ? "missing_ship_to" : "missing_branch",
      missing,
      message: `Missing required pricing fields: ${missing.join(", ")}`,
    };
  }
  const lines = Array.isArray(req?.lines) ? req.lines : [];
  if (!lines.length) {
    return {
      ok: false,
      error_code: "missing_lines",
      missing: ["lines"],
      message: "At least one pricing line is required.",
    };
  }
  const lineMissing: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ({} as AbcPricingServiceRequestLine);
    if (!trim(l.itemNumber)) lineMissing.push(`lines[${i}].itemNumber`);
    if (!trim(l.uom)) lineMissing.push(`lines[${i}].uom`);
    const qty = Number(l.quantity);
    if (!Number.isFinite(qty) || qty <= 0) lineMissing.push(`lines[${i}].quantity`);
  }
  if (lineMissing.length) {
    return {
      ok: false,
      error_code: "invalid_line",
      missing: lineMissing,
      message: `Invalid pricing lines: ${lineMissing.join(", ")}`,
    };
  }
  return null;
}

// ---------- Payload construction ----------

/**
 * Build the exact ABC wire payload from the canonical request. Deterministic:
 * a request that omits `requestId` is stamped with `PITCH-PRICE-<ms>` here so
 * both handlers get identical audit trails when the caller doesn't provide
 * one.
 */
export function buildPriceItemsPayload(
  req: AbcPricingServiceRequest,
  opts: { now?: () => number } = {},
): AbcPricingWirePayload {
  const now = opts.now ?? (() => Date.now());
  const purpose = normalizePurpose(req?.purpose);
  const lines = (Array.isArray(req?.lines) ? req.lines : []).map((l, i) => ({
    id: trim(l?.id) || String(i + 1),
    itemNumber: trim(l?.itemNumber),
    quantity: Number(l?.quantity) || 1,
    uom: trim(l?.uom).toUpperCase() || "EA",
  }));
  return {
    requestId: trim(req?.requestId) || `PITCH-PRICE-${now()}`,
    shipToNumber: trim(req?.shipToNumber),
    branchNumber: trim(req?.branchNumber),
    purpose,
    lines,
  };
}

/** Requested-line objects the parser needs (id/itemNumber/uom/quantity). */
export function toParserRequestedLines(
  req: AbcPricingServiceRequest,
  wire: AbcPricingWirePayload,
): AbcPricingRequestedLine[] {
  const src = Array.isArray(req?.lines) ? req.lines : [];
  return wire.lines.map((w, i) => {
    const orig = src[i] ?? ({} as AbcPricingServiceRequestLine);
    return {
      id: w.id,
      itemNumber: w.itemNumber,
      itemDescription: orig.itemDescription ?? null,
      quantity: w.quantity,
      uom: w.uom,
      mappingId: orig.mappingId ?? null,
      templateItemId: orig.templateItemId ?? null,
      estimateLineItemId: orig.estimateLineItemId ?? null,
    };
  });
}

// ---------- Response parsing ----------

/**
 * Parse a raw ABC pricing response against the wire payload we sent. Extracted
 * so handlers that already made the ABC call (e.g. legacy call sites we
 * haven't fully migrated) can still get a canonical `parsed` verdict.
 */
export function parseAbcPriceItemsResponse(
  rawResponse: unknown,
  req: AbcPricingServiceRequest,
  wire: AbcPricingWirePayload,
  ctxOverrides: Partial<AbcPricingParseContext> = {},
  options: AbcPricingParserOptions = {},
): ParsedAbcPricingResponse {
  const requested = toParserRequestedLines(req, wire);
  const ctx: AbcPricingParseContext = {
    requestId: wire.requestId,
    shipToNumber: wire.shipToNumber,
    branchNumber: wire.branchNumber,
    purpose: purposeForParser(wire.purpose),
    checkedAt: ctxOverrides.checkedAt ?? new Date().toISOString(),
    ...ctxOverrides,
  };
  return parseAbcPricingResponse(rawResponse, requested, ctx, options);
}

// ---------- Service entry point ----------

export interface AbcPricingServiceDeps {
  apiBase: string;
  token: string;
  callAbc: AbcCallAbc;
  mapAbcError: AbcMapError;
  /** Injectable clock — tests pin `Date.now()`. */
  now?: () => number;
  /** Injectable checkedAt — parser stamps availability rows. */
  checkedAt?: string;
  parserOptions?: AbcPricingParserOptions;
}

/**
 * Call ABC Price Items with a canonical request and return the parsed
 * verdict. Handlers layer audit logging, tenant resolution and pricing-history
 * writes on top of this.
 *
 * IMPORTANT: `result.success` mirrors `parsed.runStatus === "completed"`. It is
 * NOT the HTTP status. `result.status` and `result.body` remain available for
 * audit trails but MUST NOT be used to gate order flows.
 */
export async function priceItems(
  deps: AbcPricingServiceDeps,
  req: AbcPricingServiceRequest,
): Promise<AbcPricingServiceResult> {
  const endpoint = `${deps.apiBase}/pricing/v2/prices`;
  const wire = buildPriceItemsPayload(req, { now: deps.now });
  const r = await deps.callAbc(deps.token, "POST", endpoint, wire);
  const body = r.json ?? r.text;
  const error_code = r.ok ? null : deps.mapAbcError(r.status, r.json);

  const parsed = parseAbcPriceItemsResponse(
    // A non-2xx status means the parser has no line data to align. Feed the
    // wrapper `{}` so every requested line resolves to `missing` (parser then
    // marks the run as failed). Preserve the raw body separately for audit.
    r.ok ? r.json : {},
    req,
    wire,
    { checkedAt: deps.checkedAt },
    deps.parserOptions,
  );

  const success = parsed.runStatus === "completed";
  return {
    success,
    endpoint,
    request: wire,
    status: r.status,
    body,
    error_code,
    parsed,
    runStatus: parsed.runStatus,
    counts: parsed.counts,
    warnings: parsed.warnings,
  };
}
