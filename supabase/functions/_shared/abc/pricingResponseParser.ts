/**
 * ABC pricing response parser — single authority for interpreting the ABC
 * Price Items response, at BOTH the HTTP/request level and the individual
 * pricing-line level.
 *
 * Additive only — no handler currently imports this module. Never fabricates
 * prices, never treats HTTP 200 as pricing success, never silently rewrites
 * itemNumber/UOM, never combines quantities across branches.
 *
 * Consumed evidence:
 *   1. Raw ABC response (any of the accepted wrappers below)
 *   2. Requested lines (as sent by the caller)
 *   3. Parser context (requestId / shipTo / branch / purpose / checkedAt)
 *   4. Per-line availability (via availabilityParser)
 */

import {
  type AvailabilityParserOptions,
  parseAbcAvailability,
  type ParsedAbcAvailability,
} from "./availabilityParser.ts";

// ---------- Public types ----------

export interface AbcPricingRequestedLine {
  id: string;
  itemNumber: string;
  itemDescription?: string | null;
  quantity: number;
  uom: string;
  mappingId?: string | null;
  templateItemId?: string | null;
  estimateLineItemId?: string | null;
}

export interface AbcPricingParseContext {
  requestId: string;
  shipToNumber: string;
  branchNumber: string;
  purpose: "estimating" | "ordering";
  checkedAt: string;
}

export type ParsedAbcPricingLineStatus =
  | "ok"
  | "zero_price"
  | "unavailable"
  | "rejected"
  | "missing"
  | "item_mismatch"
  | "uom_mismatch"
  | "malformed";

export interface ParsedAbcPricingLine {
  requestLineId: string;
  matchedBy: "id" | "itemNumber" | "none";
  requestedItemNumber: string;
  returnedItemNumber: string | null;
  requestedUom: string;
  returnedUom: string | null;
  requestedQuantity: number;
  returnedQuantity: number | null;
  itemDescription: string | null;
  unitPrice: number | null;
  extendedPrice: number | null;
  lineStatusCode: string | null;
  lineStatusMessage: string | null;
  availability: ParsedAbcAvailability;
  status: ParsedAbcPricingLineStatus;
  usableForEstimate: boolean;
  usableForOrder: boolean;
  reasonCodes: string[];
  warnings: string[];
  mappingId: string | null;
  templateItemId: string | null;
  estimateLineItemId: string | null;
  raw: unknown;
}

export type ParsedAbcPricingRunStatus = "completed" | "partial" | "failed";

export interface ParsedAbcPricingResponse {
  success: boolean;
  requestId: string;
  shipToNumber: string;
  branchNumber: string;
  purpose: "estimating" | "ordering";
  lines: ParsedAbcPricingLine[];
  counts: {
    requested: number;
    ok: number;
    zeroPrice: number;
    unavailable: number;
    rejected: number;
    missing: number;
    mismatched: number;
    malformed: number;
  };
  runStatus: ParsedAbcPricingRunStatus;
  errorSummary: string | null;
  warnings: string[];
  raw: unknown;
}

export interface AbcPricingParserOptions {
  requireExactReturnedUom?: boolean;
  requireLineStatusOk?: boolean;
  allowMissingLineStatusWhenPricePresent?: boolean;
  availabilityLifetimeMs?: number;
  now?: Date | string | number;
}

// ---------- Constants ----------

const SUCCESS_CODE_TOKENS = new Set([
  "OK",
  "SUCCESS",
  "SUCCEEDED",
  "SUCCESSFUL",
  "PRICED",
  "200",
  "0",
]);

const REJECT_CODE_TOKENS = [
  "ERROR",
  "ERR",
  "FAIL",
  "FAILED",
  "FAILURE",
  "INVALID",
  "REJECT",
  "REJECTED",
  "NOT_FOUND",
  "NOTFOUND",
  "UNAVAILABLE",
  "BAD_REQUEST",
  "BADREQUEST",
];

const UNAVAILABLE_LIKE_CODE_TOKENS = [
  "UNAVAILABLE",
  "NOT_FOUND",
  "NOTFOUND",
  "OUT_OF_STOCK",
  "OUTOFSTOCK",
];

// ---------- Small helpers ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function upperKey(v: unknown): string {
  return trim(v).toUpperCase();
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

function pushUnique<T>(arr: T[], v: T): void {
  if (!arr.includes(v)) arr.push(v);
}

// ---------- Wrapper extraction ----------

/**
 * Extract the array of pricing lines from any of the accepted wrappers. Never
 * discards the raw response; callers keep it for audit. Returns [] if the
 * response is unrecognizable — the parser then treats every requested line as
 * `missing` and the run as `failed`.
 */
function extractResponseLines(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    // Bare array — either lines themselves OR [{lines:[...]}, ...]
    if (raw.length && isObject(raw[0])) {
      const first = raw[0] as Record<string, unknown>;
      const innerKeys = ["lines", "prices", "priceLines", "results"];
      for (const k of innerKeys) {
        const inner = first[k];
        if (Array.isArray(inner)) return inner;
      }
    }
    return raw;
  }
  if (!isObject(raw)) return [];
  const rec = raw as Record<string, unknown>;
  const directKeys = ["lines", "prices", "priceLines", "results"];
  for (const k of directKeys) {
    const v = rec[k];
    if (Array.isArray(v)) return v;
  }
  const data = rec.data;
  if (isObject(data)) {
    for (const k of directKeys) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  } else if (Array.isArray(data)) {
    return data;
  }
  return [];
}

// ---------- Line field extraction ----------

interface ExtractedLineFields {
  id: string | null;
  itemNumber: string | null;
  uom: string | null;
  quantity: number | null;
  description: string | null;
  unitPrice: number | null;
  extendedPrice: number | null;
  statusCode: string | null;
  statusMessage: string | null;
}

function extractLineFields(rawLine: unknown): ExtractedLineFields {
  if (!isObject(rawLine)) {
    return {
      id: null,
      itemNumber: null,
      uom: null,
      quantity: null,
      description: null,
      unitPrice: null,
      extendedPrice: null,
      statusCode: null,
      statusMessage: null,
    };
  }
  const r = rawLine as Record<string, unknown>;
  const id = trim(r.id ?? r.lineId ?? r.line_id ?? r.requestLineId ?? r.request_line_id) || null;
  const itemNumber = trim(
    r.itemNumber ?? r.item_number ?? r.itemNo ?? r.item_no ?? r.sku ?? r.productNumber ??
      r.product_number,
  ) || null;
  const uom = trim(
    r.unitOfMeasure ?? r.unit_of_measure ?? r.uom ?? r.unit ?? r.priceUom ?? r.price_uom,
  ) || null;
  const quantity = toNumber(r.quantity ?? r.qty ?? r.orderedQuantity ?? r.ordered_quantity);
  const description = trim(
    r.itemDescription ?? r.item_description ?? r.description ?? r.name ?? r.productDescription ??
      r.product_description,
  ) || null;

  // Price parsing — support object-with-value AND scalar forms.
  const readPrice = (candidates: unknown[]): number | null => {
    for (const c of candidates) {
      if (c == null) continue;
      if (isObject(c)) {
        const nested = toNumber(
          (c as Record<string, unknown>).value ??
            (c as Record<string, unknown>).amount ??
            (c as Record<string, unknown>).price,
        );
        if (nested != null) return nested;
        continue;
      }
      const n = toNumber(c);
      if (n != null) return n;
    }
    return null;
  };

  const unitPrice = readPrice([
    r.unitPrice,
    r.unit_price,
    r.price,
    r.netPrice,
    r.net_price,
    r.customerPrice,
    r.customer_price,
    r.contractPrice,
    r.contract_price,
  ]);

  const extendedPrice = readPrice([
    r.extendedPrice,
    r.extended_price,
    r.totalPrice,
    r.total_price,
    r.lineTotal,
    r.line_total,
    r.amount,
  ]);

  // Status extraction — code + message from any of the accepted shapes.
  let statusCode: string | null = null;
  let statusMessage: string | null = null;
  const takeStatusFrom = (obj: unknown) => {
    if (!isObject(obj)) return;
    const rec = obj as Record<string, unknown>;
    if (!statusCode) statusCode = trim(rec.code ?? rec.status ?? rec.statusCode ?? rec.status_code) || null;
    if (!statusMessage) {
      statusMessage = trim(rec.message ?? rec.msg ?? rec.reason ?? rec.text ?? rec.description) || null;
    }
  };
  takeStatusFrom(r.status);
  takeStatusFrom(r.lineStatus);
  takeStatusFrom(r.line_status);
  takeStatusFrom(r.error);
  if (!statusCode && typeof r.status === "string") statusCode = trim(r.status) || null;
  if (!statusCode && typeof r.lineStatus === "string") statusCode = trim(r.lineStatus) || null;
  if (!statusCode) statusCode = trim(r.code) || null;
  if (!statusMessage) statusMessage = trim(r.message) || null;

  return {
    id,
    itemNumber,
    uom,
    quantity,
    description,
    unitPrice,
    extendedPrice,
    statusCode,
    statusMessage,
  };
}

// ---------- Status classification ----------

type StatusInterpretation = "success" | "rejected" | "unavailable" | "missing";

function interpretLineStatusCode(
  code: string | null,
  message: string | null,
): { kind: StatusInterpretation | "unknown"; matchedToken: string | null } {
  const upper = upperKey(code);
  if (upper) {
    if (SUCCESS_CODE_TOKENS.has(upper)) return { kind: "success", matchedToken: upper };
    for (const t of UNAVAILABLE_LIKE_CODE_TOKENS) {
      if (upper === t || upper.includes(t)) return { kind: "unavailable", matchedToken: t };
    }
    for (const t of REJECT_CODE_TOKENS) {
      if (upper === t || upper.includes(t)) return { kind: "rejected", matchedToken: t };
    }
  }
  const msgUpper = upperKey(message);
  if (msgUpper) {
    for (const t of UNAVAILABLE_LIKE_CODE_TOKENS) {
      if (msgUpper.includes(t)) return { kind: "unavailable", matchedToken: t };
    }
    for (const t of REJECT_CODE_TOKENS) {
      if (msgUpper.includes(t)) return { kind: "rejected", matchedToken: t };
    }
  }
  return { kind: "unknown", matchedToken: null };
}

// ---------- Line matching ----------

interface MatchResult {
  index: number;
  matchedBy: "id" | "itemNumber";
}

function buildLineIndex(responseLines: unknown[]) {
  const byId = new Map<string, number[]>();
  const byItem = new Map<string, number[]>();
  responseLines.forEach((line, idx) => {
    const f = extractLineFields(line);
    if (f.id) {
      const key = f.id;
      const arr = byId.get(key) ?? [];
      arr.push(idx);
      byId.set(key, arr);
    }
    if (f.itemNumber) {
      const key = f.itemNumber.toUpperCase();
      const arr = byItem.get(key) ?? [];
      arr.push(idx);
      byItem.set(key, arr);
    }
  });
  return { byId, byItem };
}

function pickFirstUnconsumed(
  indices: number[] | undefined,
  consumed: Set<number>,
): number | null {
  if (!indices || indices.length === 0) return null;
  for (const idx of indices) {
    if (!consumed.has(idx)) return idx;
  }
  return null;
}

// ---------- Core parser: single line ----------

export function parseAbcPricingLine(
  rawLine: unknown,
  requestedLine: AbcPricingRequestedLine,
  ctx: AbcPricingParseContext,
  options: AbcPricingParserOptions = {},
): ParsedAbcPricingLine {
  const reasonCodes: string[] = [];
  const warnings: string[] = [];
  const requireUom = options.requireExactReturnedUom !== false;
  const requireStatus = options.requireLineStatusOk !== false;
  const allowMissingStatusWithPrice = options.allowMissingLineStatusWhenPricePresent === true;

  const fields = extractLineFields(rawLine);
  const matchedBy: "id" | "itemNumber" | "none" =
    rawLine == null ? "none" : fields.id === requestedLine.id
      ? "id"
      : fields.itemNumber && fields.itemNumber.toUpperCase() === trim(requestedLine.itemNumber).toUpperCase()
      ? "itemNumber"
      : rawLine === undefined
      ? "none"
      : "itemNumber";

  // ----- Identity checks -----
  let status: ParsedAbcPricingLineStatus | null = null;

  if (rawLine == null) {
    status = "missing";
    pushUnique(reasonCodes, "response_line_missing");
  }

  const requestedItemUpper = trim(requestedLine.itemNumber).toUpperCase();
  const returnedItemUpper = upperKey(fields.itemNumber);

  if (!status && rawLine != null) {
    if (!fields.itemNumber) {
      status = "malformed";
      pushUnique(reasonCodes, "returned_item_number_missing");
    } else if (returnedItemUpper !== requestedItemUpper) {
      status = "item_mismatch";
      pushUnique(reasonCodes, "item_number_mismatch");
    }
  }

  // ----- UOM check -----
  const requestedUomUpper = trim(requestedLine.uom).toUpperCase();
  const returnedUomUpper = upperKey(fields.uom);
  if (!status && rawLine != null && requireUom) {
    if (!fields.uom) {
      status = "uom_mismatch";
      pushUnique(reasonCodes, "returned_uom_missing");
    } else if (returnedUomUpper !== requestedUomUpper) {
      status = "uom_mismatch";
      pushUnique(reasonCodes, "uom_mismatch");
    }
  }

  // ----- Status code interpretation -----
  const interp = interpretLineStatusCode(fields.statusCode, fields.statusMessage);
  const priceIsPositive = fields.unitPrice != null && Number.isFinite(fields.unitPrice) && fields.unitPrice > 0;
  const priceIsZero = fields.unitPrice === 0;
  const priceIsNegative = fields.unitPrice != null && Number.isFinite(fields.unitPrice) && fields.unitPrice < 0;

  if (!status && rawLine != null) {
    if (interp.kind === "rejected") {
      status = "rejected";
      pushUnique(reasonCodes, "line_status_rejected");
    } else if (interp.kind === "unavailable") {
      status = "unavailable";
      pushUnique(reasonCodes, "line_status_unavailable");
    } else if (interp.kind === "unknown") {
      // No status code at all
      if (!fields.statusCode && !fields.statusMessage) {
        if (requireStatus && !(allowMissingStatusWithPrice && priceIsPositive)) {
          status = "rejected";
          pushUnique(reasonCodes, "line_status_missing");
        }
        // else — status omitted but caller opted-in to price-only success
      } else if (requireStatus) {
        // Non-empty but unrecognized status token — treat as rejected.
        status = "rejected";
        pushUnique(reasonCodes, "line_status_unrecognized");
      }
    }
  }

  // ----- Price parsing -----
  if (!status && rawLine != null) {
    if (priceIsNegative) {
      status = "rejected";
      pushUnique(reasonCodes, "negative_unit_price");
    } else if (fields.unitPrice == null) {
      // No price at all — malformed unless status was already rejected/unavailable
      status = "malformed";
      pushUnique(reasonCodes, "unit_price_missing");
    } else if (priceIsZero) {
      status = "zero_price";
      pushUnique(reasonCodes, "zero_unit_price");
    }
  }

  // ----- Availability integration -----
  const availability = parseAbcAvailability(
    { pricingLine: rawLine ?? undefined },
    {
      itemNumber: trim(requestedLine.itemNumber),
      branchNumber: ctx.branchNumber,
      shipToNumber: ctx.shipToNumber,
      checkedAt: ctx.checkedAt,
      unitPrice: fields.unitPrice ?? null,
    },
    {
      lifetimeMs: options.availabilityLifetimeMs,
      now: options.now,
    },
  );

  // If we haven't decided yet, price is positive AND identity/status passed.
  if (!status) {
    if (priceIsPositive) {
      // Availability may downgrade to unavailable.
      if (
        availability.status === "unavailable" ||
        availability.status === "restricted" ||
        availability.status === "allocated"
      ) {
        status = "unavailable";
        pushUnique(reasonCodes, `availability_${availability.status}`);
      } else {
        status = "ok";
      }
    } else {
      // Fallback — should not really reach here but keep the type total.
      status = "malformed";
      pushUnique(reasonCodes, "indeterminate_line");
    }
  }

  // ----- Usability -----
  let usableForEstimate = false;
  let usableForOrder = false;
  if (status === "ok") {
    usableForEstimate = true;
    usableForOrder = availability.orderable === true;
    if (!usableForOrder) pushUnique(reasonCodes, "availability_blocks_order");
  }

  // Zero-price availability signal — propagate to reason codes only.
  if (availability.zeroPriceResolution && availability.zeroPriceResolution !== "not_applicable") {
    pushUnique(reasonCodes, `zero_price_${availability.zeroPriceResolution}`);
  }

  // Duplicate-quantity sanity warning (do not fail the line — informational).
  if (
    fields.quantity != null &&
    Number.isFinite(fields.quantity) &&
    fields.quantity !== requestedLine.quantity
  ) {
    warnings.push(
      `Returned quantity ${fields.quantity} differs from requested ${requestedLine.quantity}.`,
    );
  }

  return {
    requestLineId: requestedLine.id,
    matchedBy: rawLine == null ? "none" : matchedBy,
    requestedItemNumber: trim(requestedLine.itemNumber),
    returnedItemNumber: fields.itemNumber,
    requestedUom: trim(requestedLine.uom),
    returnedUom: fields.uom,
    requestedQuantity: requestedLine.quantity,
    returnedQuantity: fields.quantity,
    itemDescription: fields.description,
    unitPrice: fields.unitPrice,
    extendedPrice: fields.extendedPrice,
    lineStatusCode: fields.statusCode,
    lineStatusMessage: fields.statusMessage,
    availability,
    status,
    usableForEstimate,
    usableForOrder,
    reasonCodes,
    warnings,
    mappingId: requestedLine.mappingId ?? null,
    templateItemId: requestedLine.templateItemId ?? null,
    estimateLineItemId: requestedLine.estimateLineItemId ?? null,
    raw: rawLine ?? null,
  };
}

// ---------- Core parser: entire response ----------

export function parseAbcPricingResponse(
  rawResponse: unknown,
  requestedLines: AbcPricingRequestedLine[],
  ctx: AbcPricingParseContext,
  options: AbcPricingParserOptions = {},
): ParsedAbcPricingResponse {
  const warnings: string[] = [];
  const requested = Array.isArray(requestedLines) ? requestedLines : [];
  const responseLines = extractResponseLines(rawResponse);
  const malformedResponse =
    rawResponse == null ||
    (typeof rawResponse !== "object") ||
    (Array.isArray(rawResponse) && rawResponse.length === 0 && requested.length > 0) ||
    (!Array.isArray(rawResponse) && isObject(rawResponse) && responseLines.length === 0 && requested.length > 0);

  if (rawResponse == null) {
    warnings.push("Null pricing response received.");
  } else if (!isObject(rawResponse) && !Array.isArray(rawResponse)) {
    warnings.push("Pricing response is not an object or array.");
  } else if (responseLines.length === 0 && requested.length > 0) {
    warnings.push("Pricing response did not contain a recognized lines/prices/results array.");
  }

  const { byId, byItem } = buildLineIndex(responseLines);
  const consumed = new Set<number>();

  // Detect duplicate keys for warnings
  for (const [key, arr] of byId) {
    if (arr.length > 1) warnings.push(`Duplicate returned line id "${key}" (${arr.length} occurrences).`);
  }
  for (const [key, arr] of byItem) {
    if (arr.length > 1) warnings.push(`Duplicate returned itemNumber "${key}" (${arr.length} occurrences).`);
  }

  const lines: ParsedAbcPricingLine[] = [];

  for (const req of requested) {
    let matched: MatchResult | null = null;
    if (req.id) {
      const idIdx = pickFirstUnconsumed(byId.get(req.id), consumed);
      if (idIdx != null) matched = { index: idIdx, matchedBy: "id" };
    }
    if (!matched && req.itemNumber) {
      const key = trim(req.itemNumber).toUpperCase();
      const itemIdx = pickFirstUnconsumed(byItem.get(key), consumed);
      if (itemIdx != null) matched = { index: itemIdx, matchedBy: "itemNumber" };
    }

    if (matched) {
      consumed.add(matched.index);
      const parsed = parseAbcPricingLine(responseLines[matched.index], req, ctx, options);
      // Override matchedBy to the actual matching path (extraction inside
      // parseAbcPricingLine is a best-effort inspection, but the authoritative
      // decision is what the response-level index resolved).
      parsed.matchedBy = matched.matchedBy;
      lines.push(parsed);
    } else {
      lines.push(parseAbcPricingLine(null, req, ctx, options));
    }
  }

  // Counts
  const counts = {
    requested: requested.length,
    ok: 0,
    zeroPrice: 0,
    unavailable: 0,
    rejected: 0,
    missing: 0,
    mismatched: 0,
    malformed: 0,
  };
  for (const l of lines) {
    switch (l.status) {
      case "ok":
        counts.ok++;
        break;
      case "zero_price":
        counts.zeroPrice++;
        break;
      case "unavailable":
        counts.unavailable++;
        break;
      case "rejected":
        counts.rejected++;
        break;
      case "missing":
        counts.missing++;
        break;
      case "item_mismatch":
      case "uom_mismatch":
        counts.mismatched++;
        break;
      case "malformed":
        counts.malformed++;
        break;
    }
  }

  // Run status
  let runStatus: ParsedAbcPricingRunStatus;
  if (counts.requested === 0) {
    runStatus = malformedResponse ? "failed" : "completed";
  } else if (counts.ok === counts.requested) {
    runStatus = "completed";
  } else if (counts.ok === 0) {
    runStatus = "failed";
  } else {
    runStatus = "partial";
  }

  // Error summary (most specific dominant failure)
  let errorSummary: string | null = null;
  if (runStatus !== "completed") {
    if (malformedResponse && counts.ok === 0) {
      errorSummary = "malformed_pricing_response";
    } else if (counts.mismatched > 0 && counts.mismatched >= counts.rejected && counts.mismatched >= counts.unavailable) {
      // Prefer the more specific mismatch reason if identity vs uom dominates
      const identityCount = lines.filter((l) => l.status === "item_mismatch").length;
      const uomCount = lines.filter((l) => l.status === "uom_mismatch").length;
      errorSummary = identityCount >= uomCount ? "pricing_identity_mismatch" : "pricing_uom_mismatch";
    } else if (counts.ok === 0) {
      errorSummary = "no_lines_priced";
    } else {
      errorSummary = "partial_pricing";
    }
  }

  return {
    success: runStatus === "completed",
    requestId: ctx.requestId,
    shipToNumber: ctx.shipToNumber,
    branchNumber: ctx.branchNumber,
    purpose: ctx.purpose,
    lines,
    counts,
    runStatus,
    errorSummary,
    warnings,
    raw: rawResponse ?? null,
  };
}
