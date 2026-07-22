/**
 * ABC order payload builder — the FINAL step before an ABC Place Orders call.
 *
 * Consumes already-approved `ResolvedAbcMappingDecision`s from mappingResolver
 * and assembles a deterministic ABC Place Orders request body. This module
 * MUST NOT re-derive any business logic from upstream modules — it only
 * refuses to build unless every line's mapping decision is
 * `state === "approved"` AND `canOrder === true`.
 *
 * Pure, deterministic, additive. Never calls ABC, Supabase, or logs secrets.
 */

import type {
  ApprovedMappingColor,
  ResolvedAbcMappingDecision,
} from "./mappingResolver.ts";

// ---------- Public types ----------

export type AbcDeliveryService = "CPU" | "OTG" | "OTR";
export type AbcPhoneType = "MOBILE" | "WORK";

export interface BuildAbcOrderInput {
  requestId: string;
  purchaseOrder: string;
  branchNumber: string;
  shipToNumber: string;
  deliveryService: AbcDeliveryService;
  typeCode?: "SO";
  deliveryRequestedFor?: string | null;
  currency?: "USD";
  shipTo: {
    name: string;
    address: {
      line1: string;
      line2?: string | null;
      line3?: string | null;
      city: string;
      state: string;
      postal: string;
      country?: string;
    };
  };
  jobsiteContact: {
    name: string;
    email: string;
    phone: string;
    phoneType?: AbcPhoneType;
    extension?: string | null;
  };
  comments?: Array<{
    code?: string;
    description: string;
  }>;
  lines: Array<{
    id: string;
    canonicalMaterialLineId: string;
    mappingDecision: ResolvedAbcMappingDecision;
    quantity: number;
    instructions?: string | null;
    dimension?: {
      lengthValue: number;
      lengthUom: string;
    } | null;
  }>;
}

export interface BuildAbcOrderOptions {
  /** Max single-comment description length. Default 240. */
  maxCommentLength?: number;
  /**
   * If true, unexpected dimensions on non-dimensional lines cause a
   * preflight failure. Default false (dropped with warning).
   */
  strictDimensions?: boolean;
}

export interface AbcOrderLineProof {
  lineId: string;
  canonicalMaterialLineId: string;
  approvedMappingId: string;
  approvedPricingRunId: string;
  itemNumber: string;
  itemDescription: string;
  color: string | null;
  uom: string;
  quantity: number;
  unitPrice: number;
  branchNumber: string;
  shipToNumber: string;
}

export interface AbcOrderContactPhone {
  number: string;
  type: AbcPhoneType;
  ext: string;
}

export interface AbcOrderContact {
  functionCode: "DC";
  name: string;
  email: string;
  phones: AbcOrderContactPhone[];
}

export interface AbcOrderLine {
  id: string;
  itemNumber: string;
  itemDescription: string;
  orderedQty: { value: number; uom: string };
  unitPrice: { value: number; uom: string; instructions: string };
  dimensions?: { length: { value: number; uom: string } };
}

export interface AbcPlaceOrderRequest {
  requestId: string;
  purchaseOrder: string;
  branchNumber: string;
  deliveryService: AbcDeliveryService;
  typeCode: "SO";
  dates?: { deliveryRequestedFor: string };
  currency: "USD";
  shipTo: {
    name: string;
    number: string;
    address: {
      line1: string;
      line2: string;
      line3: string;
      city: string;
      state: string;
      postal: string;
      country: string;
    };
    contacts: AbcOrderContact[];
  };
  orderComments?: Array<{ code: string; description: string }>;
  lines: AbcOrderLine[];
}

export interface AbcOrderPreflightError {
  code: string;
  message: string;
  lineId?: string | null;
  canonicalMaterialLineId?: string | null;
}

export interface AbcOrderPreflightResult {
  valid: boolean;
  errors: AbcOrderPreflightError[];
  warnings: string[];
}

export type BuiltAbcOrderPayload =
  | {
    valid: true;
    payload: [AbcPlaceOrderRequest];
    payloadHash: string;
    idempotencyKey: string;
    lineProofs: AbcOrderLineProof[];
    warnings: string[];
  }
  | {
    valid: false;
    payload: null;
    payloadHash: null;
    idempotencyKey: null;
    lineProofs: [];
    warnings: string[];
    errors: AbcOrderPreflightError[];
  };

// ---------- Error code catalog ----------

export const ORDER_PREFLIGHT_CODES = {
  REQUEST_ID_MISSING: "order_request_id_missing",
  PURCHASE_ORDER_MISSING: "order_purchase_order_missing",
  BRANCH_MISSING: "order_branch_missing",
  SHIP_TO_MISSING: "order_ship_to_missing",
  DELIVERY_SERVICE_INVALID: "order_delivery_service_invalid",
  DELIVERY_DATE_INVALID: "order_delivery_date_invalid",
  ADDRESS_INVALID: "order_address_invalid",
  CONTACT_NAME_MISSING: "order_contact_name_missing",
  CONTACT_EMAIL_INVALID: "order_contact_email_invalid",
  CONTACT_PHONE_INVALID: "order_contact_phone_invalid",
  LINES_MISSING: "order_lines_missing",
  DUPLICATE_LINE_ID: "order_duplicate_line_id",
  DUPLICATE_MATERIAL_LINE: "order_duplicate_material_line",
  LINE_MAPPING_NOT_APPROVED: "line_mapping_not_approved",
  LINE_NOT_ORDERABLE: "line_not_orderable",
  LINE_MAPPING_ID_MISSING: "line_mapping_id_missing",
  LINE_ITEM_NUMBER_MISSING: "line_item_number_missing",
  LINE_DESCRIPTION_MISSING: "line_description_missing",
  LINE_UOM_MISSING: "line_uom_missing",
  LINE_BRANCH_MISMATCH: "line_branch_mismatch",
  LINE_SHIP_TO_MISMATCH: "line_ship_to_mismatch",
  LINE_PRICE_MISSING: "line_price_missing",
  LINE_QUANTITY_INVALID: "line_quantity_invalid",
  LINE_PRICING_REFERENCE_MISSING: "line_pricing_reference_missing",
  LINE_MATERIAL_REFERENCE_MISSING: "line_material_reference_missing",
  LINE_DIMENSION_REQUIRED: "line_dimension_required",
  LINE_DIMENSION_INVALID: "line_dimension_invalid",
} as const;

// ---------- Constants ----------

const VALID_DELIVERY_SERVICES: ReadonlySet<AbcDeliveryService> = new Set([
  "CPU",
  "OTG",
  "OTR",
]);
const DEFAULT_MAX_COMMENT_LENGTH = 240;
const US_STATE_RE = /^[A-Z]{2}$/;
const YYYYMMDD_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function upperTrim(v: unknown): string {
  return trim(v).toUpperCase();
}
function digitsOnly(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D+/g, "") : "";
}

function isValidYyyyMmDd(v: string): boolean {
  if (!YYYYMMDD_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map((x) => stableStringify(x)).join(",") + "]";
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" +
    keys
      .map(
        (k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}";
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  // deno-lint-ignore no-explicit-any
  const cryptoObj: any = (globalThis as any).crypto;
  if (cryptoObj?.subtle?.digest) {
    const buf = await cryptoObj.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback: FNV-1a 64-bit-ish for envs without SubtleCrypto (tests only).
  let h1 = 0x811c9dc5, h2 = 0xc9dc5118;
  for (let i = 0; i < enc.length; i++) {
    h1 = Math.imul(h1 ^ enc[i], 0x01000193);
    h2 = Math.imul(h2 ^ enc[enc.length - 1 - i], 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Synchronous, deterministic hash. We hash the semantic order payload with a
 * lightweight FNV-1a; this is stable across runs of the same input. SubtleCrypto
 * is async and we want the builder to remain synchronous for tests. The hash
 * only needs to be deterministic + collision-resistant enough to key
 * idempotency — not a cryptographic authenticator.
 */
export function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  let h3 = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i--) {
    h3 = Math.imul(h3 ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    h3.toString(16).padStart(8, "0")
  );
}

function pushErr(
  errors: AbcOrderPreflightError[],
  code: string,
  message: string,
  lineId: string | null = null,
  canonicalMaterialLineId: string | null = null,
): void {
  errors.push({ code, message, lineId, canonicalMaterialLineId });
}

function colorLabel(c: ApprovedMappingColor | null): string | null {
  if (!c) return null;
  return c.displayName ?? c.rawName ?? c.code ?? null;
}

/**
 * Extract the approved catalog snapshot from a mapping decision. We prefer
 * the normalized parent (which carries `isDimensional`/`lengths`); fall back
 * to the resolved child's source when only the child snapshot is present.
 */
function resolvedProductSnapshot(
  md: ResolvedAbcMappingDecision,
): { isDimensional?: boolean | null; lengths?: string[] } | null {
  const snap = md.sourceSnapshots;
  if (!snap) return null;
  if (snap.normalizedProduct) return snap.normalizedProduct;
  if (snap.resolvedChild?.source) return snap.resolvedChild.source;
  return null;
}

// ---------- Preflight ----------

export function validateAbcOrderInput(
  input: BuildAbcOrderInput,
  options: BuildAbcOrderOptions = {},
): AbcOrderPreflightResult {
  const errors: AbcOrderPreflightError[] = [];
  const warnings: string[] = [];
  const strictDimensions = options.strictDimensions === true;

  // --- Order-level ---
  if (!trim(input.requestId)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.REQUEST_ID_MISSING,
      "requestId is required",
    );
  }
  if (!trim(input.purchaseOrder)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.PURCHASE_ORDER_MISSING,
      "purchaseOrder is required",
    );
  }
  const branchNumber = trim(input.branchNumber);
  if (!branchNumber) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.BRANCH_MISSING,
      "branchNumber is required",
    );
  }
  const shipToNumber = trim(input.shipToNumber);
  if (!shipToNumber) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.SHIP_TO_MISSING,
      "shipToNumber is required",
    );
  }
  if (
    !input.deliveryService ||
    !VALID_DELIVERY_SERVICES.has(input.deliveryService)
  ) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.DELIVERY_SERVICE_INVALID,
      "deliveryService must be one of CPU|OTG|OTR",
    );
  }
  if (
    input.deliveryRequestedFor !== undefined &&
    input.deliveryRequestedFor !== null &&
    input.deliveryRequestedFor !== ""
  ) {
    const dv = trim(input.deliveryRequestedFor);
    if (!isValidYyyyMmDd(dv)) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.DELIVERY_DATE_INVALID,
        "deliveryRequestedFor must be a valid YYYY-MM-DD",
      );
    }
  }

  // --- Address ---
  const shipTo = input.shipTo;
  if (!shipTo || !trim(shipTo.name)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.ADDRESS_INVALID,
      "shipTo.name is required",
    );
  }
  if (!shipTo?.address || !trim(shipTo.address.line1)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.ADDRESS_INVALID,
      "shipTo.address.line1 is required",
    );
  }
  if (!trim(shipTo?.address?.city)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.ADDRESS_INVALID,
      "shipTo.address.city is required",
    );
  }
  const stateRaw = upperTrim(shipTo?.address?.state);
  if (!US_STATE_RE.test(stateRaw)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.ADDRESS_INVALID,
      "shipTo.address.state must be a 2-letter code",
    );
  }
  if (!trim(shipTo?.address?.postal)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.ADDRESS_INVALID,
      "shipTo.address.postal is required",
    );
  }

  // --- Contact ---
  const contact = input.jobsiteContact;
  if (!contact || !trim(contact.name)) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.CONTACT_NAME_MISSING,
      "jobsiteContact.name is required",
    );
  }
  if (!contact || !EMAIL_RE.test(trim(contact.email))) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.CONTACT_EMAIL_INVALID,
      "jobsiteContact.email is invalid",
    );
  }
  if (!contact || digitsOnly(contact.phone).length < 10) {
    pushErr(
      errors,
      ORDER_PREFLIGHT_CODES.CONTACT_PHONE_INVALID,
      "jobsiteContact.phone must contain at least 10 digits",
    );
  }

  // --- Lines ---
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) {
    pushErr(errors, ORDER_PREFLIGHT_CODES.LINES_MISSING, "no order lines");
  }

  const seenLineIds = new Set<string>();
  const seenMaterialIds = new Set<string>();
  for (const line of lines) {
    const lineId = trim(line?.id);
    const canonicalId = trim(line?.canonicalMaterialLineId);
    if (!lineId) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_MATERIAL_REFERENCE_MISSING,
        "line.id is required",
        null,
        canonicalId || null,
      );
      continue;
    }
    if (seenLineIds.has(lineId)) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.DUPLICATE_LINE_ID,
        `duplicate line id: ${lineId}`,
        lineId,
        canonicalId || null,
      );
    }
    seenLineIds.add(lineId);

    if (!canonicalId) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_MATERIAL_REFERENCE_MISSING,
        "canonicalMaterialLineId is required",
        lineId,
        null,
      );
    } else if (seenMaterialIds.has(canonicalId)) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.DUPLICATE_MATERIAL_LINE,
        `duplicate canonical material line: ${canonicalId}`,
        lineId,
        canonicalId,
      );
    } else {
      seenMaterialIds.add(canonicalId);
    }

    const md = line?.mappingDecision;
    if (!md) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_MAPPING_NOT_APPROVED,
        "mappingDecision is required",
        lineId,
        canonicalId || null,
      );
      continue;
    }
    if (md.state !== "approved") {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_MAPPING_NOT_APPROVED,
        `mapping state is ${md.state}, not approved`,
        lineId,
        canonicalId || null,
      );
    }
    if (md.canOrder !== true) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_NOT_ORDERABLE,
        "mappingDecision.canOrder is false",
        lineId,
        canonicalId || null,
      );
    }
    if (!md.approvedMappingId) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_MAPPING_ID_MISSING,
        "approvedMappingId is missing",
        lineId,
        canonicalId || null,
      );
    }
    if (!md.approvedItemNumber) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_ITEM_NUMBER_MISSING,
        "approvedItemNumber is missing",
        lineId,
        canonicalId || null,
      );
    }
    if (!md.approvedDescription) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_DESCRIPTION_MISSING,
        "approvedDescription is missing",
        lineId,
        canonicalId || null,
      );
    }
    if (!md.approvedUom) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_UOM_MISSING,
        "approvedUom is missing",
        lineId,
        canonicalId || null,
      );
    }
    if (
      md.approvedPrice == null ||
      !Number.isFinite(md.approvedPrice) ||
      md.approvedPrice <= 0
    ) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_PRICE_MISSING,
        "approvedPrice is missing or non-positive",
        lineId,
        canonicalId || null,
      );
    }
    if (!md.approvedPricingRunId) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_PRICING_REFERENCE_MISSING,
        "approvedPricingRunId is missing",
        lineId,
        canonicalId || null,
      );
    }
    if (
      branchNumber &&
      md.approvedBranch &&
      upperTrim(md.approvedBranch) !== upperTrim(branchNumber)
    ) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_BRANCH_MISMATCH,
        `line branch ${md.approvedBranch} != order branch ${branchNumber}`,
        lineId,
        canonicalId || null,
      );
    }
    if (
      shipToNumber &&
      md.approvedShipTo &&
      upperTrim(md.approvedShipTo) !== upperTrim(shipToNumber)
    ) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_SHIP_TO_MISMATCH,
        `line ShipTo ${md.approvedShipTo} != order ShipTo ${shipToNumber}`,
        lineId,
        canonicalId || null,
      );
    }
    if (
      typeof line.quantity !== "number" ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    ) {
      pushErr(
        errors,
        ORDER_PREFLIGHT_CODES.LINE_QUANTITY_INVALID,
        "quantity must be a positive number",
        lineId,
        canonicalId || null,
      );
    }

    // Dimensions
    const src = resolvedProductSnapshot(md);
    const isDimensional = Boolean(src?.isDimensional);
    const lengths: string[] = Array.isArray(src?.lengths) ? src!.lengths : [];
    if (isDimensional) {
      const dim = line.dimension;
      if (
        !dim ||
        typeof dim.lengthValue !== "number" ||
        !Number.isFinite(dim.lengthValue) ||
        dim.lengthValue <= 0 ||
        !trim(dim.lengthUom)
      ) {
        pushErr(
          errors,
          ORDER_PREFLIGHT_CODES.LINE_DIMENSION_REQUIRED,
          "dimension is required for dimensional item",
          lineId,
          canonicalId || null,
        );
      } else if (lengths.length > 0) {
        const target = `${dim.lengthValue}${upperTrim(dim.lengthUom)}`;
        const match = lengths.some((v) =>
          upperTrim(v).replace(/\s+/g, "") === target
        );
        if (!match) {
          pushErr(
            errors,
            ORDER_PREFLIGHT_CODES.LINE_DIMENSION_INVALID,
            "selected length not in approved product's valid lengths",
            lineId,
            canonicalId || null,
          );
        }
      }
    } else if (line.dimension) {
      if (strictDimensions) {
        pushErr(
          errors,
          ORDER_PREFLIGHT_CODES.LINE_DIMENSION_INVALID,
          "dimension provided for non-dimensional item",
          lineId,
          canonicalId || null,
        );
      } else {
        warnings.push(
          `line ${lineId}: dropped unexpected dimension on non-dimensional item`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------- Build ----------

export function buildAbcOrderPayload(
  input: BuildAbcOrderInput,
  options: BuildAbcOrderOptions = {},
): BuiltAbcOrderPayload {
  const maxCommentLength = options.maxCommentLength ?? DEFAULT_MAX_COMMENT_LENGTH;
  const preflight = validateAbcOrderInput(input, options);
  const warnings = [...preflight.warnings];

  if (!preflight.valid) {
    return {
      valid: false,
      payload: null,
      payloadHash: null,
      idempotencyKey: null,
      lineProofs: [],
      warnings,
      errors: preflight.errors,
    };
  }

  // Normalize address.
  const addr = input.shipTo.address;
  const normalizedAddress = {
    line1: trim(addr.line1),
    line2: trim(addr.line2 ?? ""),
    line3: trim(addr.line3 ?? ""),
    city: trim(addr.city),
    state: upperTrim(addr.state),
    postal: trim(addr.postal),
    country: upperTrim(addr.country ?? "USA") || "USA",
  };

  // Normalize contact.
  const contact = input.jobsiteContact;
  const phones: AbcOrderContactPhone[] = [{
    number: digitsOnly(contact.phone),
    type: contact.phoneType ?? "MOBILE",
    ext: trim(contact.extension ?? ""),
  }];

  const dcContact: AbcOrderContact = {
    functionCode: "DC",
    name: trim(contact.name),
    email: trim(contact.email),
    phones,
  };

  // Normalize comments.
  const orderComments = normalizeComments(
    input.comments ?? [],
    maxCommentLength,
    warnings,
  );

  // Build lines from approved mapping decisions.
  const lineProofs: AbcOrderLineProof[] = [];
  const orderLines: AbcOrderLine[] = input.lines.map((line) => {
    const md = line.mappingDecision;
    const itemNumber = md.approvedItemNumber as string;
    const description = md.approvedDescription as string;
    const uom = md.approvedUom as string;
    const price = md.approvedPrice as number;

    const src = resolvedProductSnapshot(md);
    const isDimensional = Boolean(src?.isDimensional);

    const built: AbcOrderLine = {
      id: trim(line.id),
      itemNumber,
      itemDescription: description,
      orderedQty: { value: line.quantity, uom },
      unitPrice: {
        value: price,
        uom,
        instructions: trim(line.instructions ?? ""),
      },
    };

    if (isDimensional && line.dimension) {
      built.dimensions = {
        length: {
          value: line.dimension.lengthValue,
          uom: upperTrim(line.dimension.lengthUom),
        },
      };
    }

    lineProofs.push({
      lineId: built.id,
      canonicalMaterialLineId: trim(line.canonicalMaterialLineId),
      approvedMappingId: md.approvedMappingId as string,
      approvedPricingRunId: md.approvedPricingRunId as string,
      itemNumber,
      itemDescription: description,
      color: colorLabel(md.approvedColor),
      uom,
      quantity: line.quantity,
      unitPrice: price,
      branchNumber: trim(input.branchNumber),
      shipToNumber: trim(input.shipToNumber),
    });

    return built;
  });

  const order: AbcPlaceOrderRequest = {
    requestId: trim(input.requestId),
    purchaseOrder: trim(input.purchaseOrder),
    branchNumber: trim(input.branchNumber),
    deliveryService: input.deliveryService,
    typeCode: input.typeCode ?? "SO",
    currency: input.currency ?? "USD",
    shipTo: {
      name: trim(input.shipTo.name),
      number: trim(input.shipToNumber),
      address: normalizedAddress,
      contacts: [dcContact],
    },
    lines: orderLines,
  };

  if (input.deliveryRequestedFor) {
    order.dates = { deliveryRequestedFor: trim(input.deliveryRequestedFor) };
  }
  if (orderComments.length > 0) {
    order.orderComments = orderComments;
  }

  const payload: [AbcPlaceOrderRequest] = [order];

  // Deterministic hash — semantic subset only (no volatile fields).
  const semanticKeyInput = {
    requestId: order.requestId,
    purchaseOrder: order.purchaseOrder,
    branchNumber: order.branchNumber,
    shipToNumber: order.shipTo.number,
    lines: order.lines.map((l) => ({
      id: l.id,
      itemNumber: l.itemNumber,
      quantity: l.orderedQty.value,
      uom: l.orderedQty.uom,
      unitPrice: l.unitPrice.value,
      dimension: l.dimensions?.length ?? null,
    })),
  };
  const semanticString = stableStringify(semanticKeyInput);
  const idempotencyKey = fnv1aHex(semanticString);
  const payloadHash = fnv1aHex(stableStringify(payload));

  return {
    valid: true,
    payload,
    payloadHash,
    idempotencyKey,
    lineProofs,
    warnings,
  };
}

function normalizeComments(
  comments: Array<{ code?: string; description: string }>,
  maxLen: number,
  warnings: string[],
): Array<{ code: string; description: string }> {
  const out: Array<{ code: string; description: string }> = [];
  for (const c of comments) {
    const desc = trim(c?.description);
    if (!desc) continue;
    const code = trim(c?.code) || "H";
    let description = desc;
    if (description.length > maxLen) {
      warnings.push(`comment truncated from ${description.length} to ${maxLen}`);
      description = description.slice(0, maxLen);
    }
    out.push({ code, description });
  }
  return out;
}

// Kept for callers that want the async-crypto path in production.
export async function computePayloadHashSha256(
  payload: unknown,
): Promise<string> {
  return await sha256Hex(stableStringify(payload));
}
