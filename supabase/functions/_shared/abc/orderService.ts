/**
 * ABC order service — the single, shared entry point that BOTH
 * `abc-api-proxy` and `supplier-api/abc-proxy` MUST use to build ABC
 * order payloads. No inline order construction may remain in the
 * handlers after Phase 1B — Slice 3.
 *
 * Responsibilities:
 *   - preflight (missing fields, invalid UOM/qty/contact, positive price)
 *   - deterministic payload construction (identical bytes across handlers)
 *   - deterministic idempotency key + payload hash
 *   - line proofs (line -> approved mapping / approved pricing reference)
 *   - DC contact + address + comment normalization
 *
 * Handlers keep:
 *   - JWT / tenant resolution
 *   - OAuth token refresh
 *   - Product API catalog gate
 *   - Price Items echo
 *   - outbound ABC HTTP call
 *   - audit logging / persistence
 *
 * NEVER call ABC, Supabase, or log secrets from this module.
 */

import { fnv1aHex, stableStringify } from "./orderPayloadBuilder.ts";

// ---------- Public types ----------

export type AbcOrderVariant =
  | "sandbox_test"      // single-item sandbox flow that DOES call ABC
  | "validate_only"     // single-item flow that NEVER calls ABC
  | "legacy_place";     // multi-line place_order / submit_order flow

export interface AbcOrderContactInput {
  name: string;
  email: string;
  phone: string;                     // free-form, digits extracted internally
  phoneType?: "MOBILE" | "WORK";
  ext?: string | null;
}

export interface AbcOrderAddressInput {
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
}

export interface AbcOrderLineInput {
  id: string | number;
  itemNumber: string;
  itemDescription: string;
  uom: string;
  quantity: number;
  unitPrice: number;                 // resolved (Price Items echo or override)
  instructions?: string | null;
  approvedMappingId?: string | null; // sandbox: `sandbox:<itemNumber>`
  approvedPricingRunId?: string | null;
  priceSource?: string | null;       // "price_items" | "override" | ...
  colorLabel?: string | null;
  dimension?: { lengthValue: number; lengthUom: string } | null;
}

export interface BuildOrderInput {
  variant: AbcOrderVariant;
  requestId: string;
  purchaseOrder: string;
  branchNumber: string;
  shipToNumber: string;
  deliveryService?: "CPU" | "OTG" | "OTR";
  deliveryRequestedFor?: string | null;   // YYYY-MM-DD
  currency?: "USD";
  shipToName: string;
  address: AbcOrderAddressInput;
  jobsiteContact: AbcOrderContactInput;
  comments?: Array<{ code?: string; description: string }>;
  lines: AbcOrderLineInput[];
}

export interface OrderPreflightError {
  code: string;
  message: string;
  field?: string;
  lineId?: string | number | null;
}

export interface OrderLineProof {
  lineId: string;
  approvedMappingId: string;
  approvedPricingRunId: string;
  itemNumber: string;
  itemDescription: string;
  uom: string;
  quantity: number;
  unitPrice: number;
  branchNumber: string;
  shipToNumber: string;
  color: string | null;
  priceSource: string | null;
}

export type BuiltOrderResult =
  | {
      valid: true;
      orderRequest: [Record<string, unknown>];
      payloadHash: string;
      idempotencyKey: string;
      lineProofs: OrderLineProof[];
      warnings: string[];
    }
  | {
      valid: false;
      orderRequest: null;
      payloadHash: null;
      idempotencyKey: null;
      lineProofs: [];
      warnings: string[];
      errors: OrderPreflightError[];
    };

// ---------- Constants ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YYYYMMDD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX_COMMENT_LEN = 500;

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
  return YYYYMMDD_RE.test(v);
}
function pushErr(
  errors: OrderPreflightError[],
  code: string,
  message: string,
  field?: string,
  lineId: string | number | null = null,
): void {
  errors.push({ code, message, field, lineId });
}

// ---------- Preflight ----------

export function validateAbcOrderInput(input: BuildOrderInput): {
  valid: boolean;
  errors: OrderPreflightError[];
} {
  const errors: OrderPreflightError[] = [];

  if (!trim(input.requestId)) pushErr(errors, "request_id_missing", "requestId is required", "requestId");
  if (!trim(input.purchaseOrder)) pushErr(errors, "purchase_order_missing", "purchaseOrder is required", "purchaseOrder");
  if (!trim(input.branchNumber)) pushErr(errors, "branch_missing", "branchNumber is required", "branchNumber");
  if (!trim(input.shipToNumber)) pushErr(errors, "ship_to_missing", "shipToNumber is required", "shipToNumber");

  if (input.deliveryRequestedFor && !isValidYyyyMmDd(trim(input.deliveryRequestedFor))) {
    pushErr(errors, "delivery_date_invalid", "deliveryRequestedFor must be YYYY-MM-DD", "deliveryRequestedFor");
  }

  const c = input.jobsiteContact;
  if (!c || !trim(c.name)) pushErr(errors, "contact_name_missing", "jobsiteContact.name is required", "jobsiteContact.name");
  if (!c || !EMAIL_RE.test(trim(c?.email))) {
    pushErr(errors, "contact_email_invalid", "jobsiteContact.email is invalid", "jobsiteContact.email");
  }
  if (!c || digitsOnly(c?.phone).length < 10) {
    pushErr(errors, "contact_phone_invalid", "jobsiteContact.phone must have at least 10 digits", "jobsiteContact.phone");
  }

  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) {
    pushErr(errors, "lines_missing", "no order lines", "lines");
  }
  const seenIds = new Set<string>();
  for (const l of lines) {
    const lid = String(l?.id ?? "").trim();
    if (!lid) {
      pushErr(errors, "line_id_missing", "line.id is required", "id", l?.id ?? null);
    } else if (seenIds.has(lid)) {
      pushErr(errors, "line_duplicate", `duplicate line id: ${lid}`, "id", lid);
    } else {
      seenIds.add(lid);
    }
    if (!trim(l?.itemNumber)) {
      pushErr(errors, "line_item_number_missing", "itemNumber is required", "itemNumber", l?.id ?? null);
    }
    if (!trim(l?.itemDescription)) {
      pushErr(errors, "line_description_missing", "itemDescription is required", "itemDescription", l?.id ?? null);
    }
    if (!trim(l?.uom)) {
      pushErr(errors, "line_uom_missing", "uom is required", "uom", l?.id ?? null);
    }
    if (!(typeof l?.quantity === "number" && Number.isFinite(l.quantity) && l.quantity > 0)) {
      pushErr(errors, "line_quantity_invalid", "quantity must be positive", "quantity", l?.id ?? null);
    }
    if (!(typeof l?.unitPrice === "number" && Number.isFinite(l.unitPrice) && l.unitPrice > 0)) {
      pushErr(errors, "line_price_invalid", "unitPrice must be positive", "unitPrice", l?.id ?? null);
    }
    if (l?.dimension) {
      const d = l.dimension;
      if (
        typeof d.lengthValue !== "number" ||
        !Number.isFinite(d.lengthValue) ||
        d.lengthValue <= 0 ||
        !trim(d.lengthUom)
      ) {
        pushErr(errors, "line_dimension_invalid", "dimension must have positive length + uom", "dimension", l?.id ?? null);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------- Build ----------

export function buildAbcOrderPayload(input: BuildOrderInput): BuiltOrderResult {
  const preflight = validateAbcOrderInput(input);
  const warnings: string[] = [];
  if (!preflight.valid) {
    return {
      valid: false,
      orderRequest: null,
      payloadHash: null,
      idempotencyKey: null,
      lineProofs: [],
      warnings,
      errors: preflight.errors,
    };
  }

  const requestId = trim(input.requestId);
  const purchaseOrder = trim(input.purchaseOrder);
  const branchNumber = trim(input.branchNumber);
  const shipToNumber = trim(input.shipToNumber);
  const deliveryService = input.deliveryService ?? "CPU";
  const currency = input.currency ?? "USD";

  // Address normalization — deterministic default strings so byte-for-byte
  // hashes match across handlers when the caller omits optional fields.
  const a = input.address ?? {};
  const address = {
    line1: trim(a.line1),
    line2: trim(a.line2 ?? ""),
    line3: trim(a.line3 ?? ""),
    city: trim(a.city),
    state: upperTrim(a.state),
    postal: trim(a.postal),
    country: upperTrim(a.country ?? "USA") || "USA",
  };

  // Contact normalization (functionCode "DC").
  const c = input.jobsiteContact;
  const contact = {
    functionCode: "DC" as const,
    name: trim(c.name).slice(0, 60),
    email: trim(c.email).slice(0, 80),
    phones: [{
      number: digitsOnly(c.phone),
      type: c.phoneType ?? "MOBILE",
      ext: trim(c.ext ?? ""),
    }],
  };

  // Comments — filter empties, cap length, default code "H".
  const orderComments: Array<{ code: string; description: string }> = [];
  for (const cmt of input.comments ?? []) {
    const desc = trim(cmt?.description);
    if (!desc) continue;
    let out = desc;
    if (out.length > DEFAULT_MAX_COMMENT_LEN) {
      warnings.push(`comment truncated from ${out.length} to ${DEFAULT_MAX_COMMENT_LEN}`);
      out = out.slice(0, DEFAULT_MAX_COMMENT_LEN);
    }
    orderComments.push({ code: trim(cmt?.code) || "H", description: out });
  }

  // Lines + proofs.
  const lineProofs: OrderLineProof[] = [];
  const lines = input.lines.map((l) => {
    const uom = upperTrim(l.uom);
    const itemNumber = trim(l.itemNumber);
    const itemDescription = trim(l.itemDescription);
    const built: Record<string, unknown> = {
      id: typeof l.id === "number" ? l.id : trim(String(l.id)),
      itemNumber,
      itemDescription,
      orderedQty: { value: l.quantity, uom },
      unitPrice: {
        value: l.unitPrice,
        uom,
        instructions: trim(l.instructions ?? ""),
      },
    };
    if (l.dimension) {
      built.dimensions = {
        length: {
          value: l.dimension.lengthValue,
          uom: upperTrim(l.dimension.lengthUom),
        },
      };
    }
    lineProofs.push({
      lineId: String(built.id),
      approvedMappingId: trim(l.approvedMappingId ?? "") || `sandbox:${itemNumber}`,
      approvedPricingRunId: trim(l.approvedPricingRunId ?? "") || `sandbox:${requestId}`,
      itemNumber,
      itemDescription,
      uom,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      branchNumber,
      shipToNumber,
      color: l.colorLabel ?? null,
      priceSource: l.priceSource ?? null,
    });
    return built;
  });

  // Order object — key order is fixed to guarantee identical bytes.
  const order: Record<string, unknown> = {
    requestId,
    purchaseOrder,
    branchNumber,
    deliveryService,
    typeCode: "SO",
  };
  if (input.deliveryRequestedFor) {
    order.dates = { deliveryRequestedFor: trim(input.deliveryRequestedFor) };
  }
  order.currency = currency;
  order.shipTo = {
    name: trim(input.shipToName).slice(0, 60),
    number: shipToNumber,
    address,
    contacts: [contact],
  };
  if (orderComments.length > 0) {
    order.orderComments = orderComments;
  }
  order.lines = lines;

  const orderRequest: [Record<string, unknown>] = [order];

  // Deterministic hash inputs — semantic subset only, no volatile fields.
  const semanticKey = stableStringify({
    requestId,
    purchaseOrder,
    branchNumber,
    shipToNumber,
    lines: lines.map((l: any) => ({
      id: l.id,
      itemNumber: l.itemNumber,
      quantity: l.orderedQty.value,
      uom: l.orderedQty.uom,
      unitPrice: l.unitPrice.value,
      dimension: (l.dimensions as any)?.length ?? null,
    })),
  });
  const idempotencyKey = fnv1aHex(semanticKey);
  const payloadHash = fnv1aHex(stableStringify(orderRequest));

  return {
    valid: true,
    orderRequest,
    payloadHash,
    idempotencyKey,
    lineProofs,
    warnings,
  };
}
