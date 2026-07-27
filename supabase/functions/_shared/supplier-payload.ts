// Server-side outbound supplier payload construction.
//
// The browser may NEVER supply a prebuilt supplier payload, nor override the
// supplier item code, supplier account, branch, color identity, UOM, price or
// catalog-validation result. Everything here is derived from `ResolvedLine`s
// produced by `resolveSupplierLines`, which read only from the authoritative
// `supplier_item_mappings` table.

import type { ResolvedLine, SupplierKind } from "./supplier-resolution.ts";

export interface OrderHeaderContext {
  po_number?: string | null;
  job_number?: string | null;
  customer_name?: string | null;
  delivery_address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
  requested_delivery_date?: string | null;
  notes?: string | null;
  ship_to_number?: string | null;
  branch_code?: string | null;
  account_number?: string | null;
}

/** Internal traceability retained alongside every outbound line, even when the supplier drops it. */
export interface LineTrace {
  pitch_variant_id: string;
  manufacturer: string | null;
  product_line: string | null;
  color_id: string | null;
  color_name: string | null;
  manufacturer_color_code: string | null;
  supplier_mapping_id: string | null;
  supplier_mapping_revision: number | null;
  catalog_fingerprint: string | null;
  validated_at: string | null;
}

export function buildLineTrace(line: ResolvedLine): LineTrace {
  return {
    pitch_variant_id: line.variant_id,
    manufacturer: line.manufacturer_name,
    product_line: line.product_line_name,
    color_id: line.color_id,
    color_name: line.color_name,
    manufacturer_color_code: line.manufacturer_color_code,
    supplier_mapping_id: line.mapping_id,
    supplier_mapping_revision: line.mapping_revision,
    catalog_fingerprint: line.catalog_fingerprint,
    validated_at: line.validated_at,
  };
}

function assertAllResolved(lines: ResolvedLine[]) {
  const bad = lines.filter((l) => !l.ok || !l.supplier_item_number);
  if (bad.length) {
    throw new Error(
      `payload_build_blocked: ${bad.length} unresolved line(s): ${bad
        .map((b) => `${b.key}=${b.failure_code ?? "unresolved"}`)
        .join(", ")}`,
    );
  }
}

/**
 * ABC Supply order payload. ABC's authoritative identifier is `itemNumber`.
 */
export function buildAbcOrderPayload(lines: ResolvedLine[], ctx: OrderHeaderContext) {
  assertAllResolved(lines);
  return {
    poNumber: ctx.po_number ?? null,
    shipToNumber: ctx.ship_to_number ?? null,
    branchNumber: ctx.branch_code ?? null,
    requestedDeliveryDate: ctx.requested_delivery_date ?? null,
    jobName: ctx.job_number ?? null,
    customerName: ctx.customer_name ?? null,
    deliveryAddress: ctx.delivery_address ?? null,
    notes: ctx.notes ?? null,
    lines: lines.map((l, idx) => ({
      lineNumber: idx + 1,
      itemNumber: l.supplier_item_number, // ABC authoritative item code
      quantity: l.quantity,
      uom: l.supplier_uom,
      colorName: l.supplier_color_name ?? l.color_name ?? null,
      description: l.supplier_description ?? null,
      _pitch_trace: buildLineTrace(l),
    })),
  };
}

/**
 * SRS Distribution order payload. SRS's authoritative identifier is the
 * catalog `productId`; the color/variant travels on `orderLineItemDetails.option`.
 */
export function buildSrsOrderPayload(lines: ResolvedLine[], ctx: OrderHeaderContext) {
  assertAllResolved(lines);
  return {
    purchaseOrderNumber: ctx.po_number ?? null,
    accountNumber: ctx.account_number ?? null,
    branchId: ctx.branch_code ?? null,
    jobName: ctx.job_number ?? null,
    customerName: ctx.customer_name ?? null,
    requestedDeliveryDate: ctx.requested_delivery_date ?? null,
    shippingAddress: ctx.delivery_address ?? null,
    specialInstructions: ctx.notes ?? null,
    orderLineItems: lines.map((l, idx) => ({
      lineNumber: idx + 1,
      productId: l.supplier_catalog_item_id ?? l.supplier_item_number, // SRS authoritative catalog id
      productNumber: l.supplier_item_number,
      quantity: l.quantity,
      uom: l.supplier_uom,
      orderLineItemDetails: {
        option: l.supplier_color_name ?? l.color_name ?? null,
        color: l.supplier_color_name ?? l.color_name ?? null,
        description: l.supplier_description ?? null,
      },
      _pitch_trace: buildLineTrace(l),
    })),
  };
}

export function buildOrderPayload(
  supplier: SupplierKind,
  lines: ResolvedLine[],
  ctx: OrderHeaderContext,
) {
  if (supplier === "abc") return buildAbcOrderPayload(lines, ctx);
  if (supplier === "srs") return buildSrsOrderPayload(lines, ctx);
  throw new Error(`payload_build_unsupported_supplier: ${supplier}`);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileLineResult {
  key: string;
  submitted_item_number: string | null;
  returned_item_number: string | null;
  submitted_quantity: number;
  returned_quantity: number | null;
  submitted_uom: string | null;
  returned_uom: string | null;
  match: boolean;
  mismatch_reasons: string[];
}

export interface ReconcileResult {
  verified: boolean;
  branch_match: boolean;
  lines: ReconcileLineResult[];
}

/**
 * A 2xx response is NOT proof of acceptance. Compare the supplier's returned
 * order against the immutable submission snapshot before marking `verified`.
 */
export function reconcileSupplierOrder(
  submitted: ResolvedLine[],
  returned: Array<{
    item_number?: string | null;
    product_id?: string | null;
    quantity?: number | null;
    uom?: string | null;
  }>,
  submittedBranch: string | null,
  returnedBranch: string | null,
): ReconcileResult {
  const byItem = new Map<string, typeof returned[number]>();
  for (const r of returned) {
    const key = String(r.item_number ?? r.product_id ?? "").toUpperCase();
    if (key) byItem.set(key, r);
  }

  const lines: ReconcileLineResult[] = submitted.map((s) => {
    const submittedItem = s.supplier_item_number ?? null;
    const hit = submittedItem ? byItem.get(submittedItem.toUpperCase()) : undefined;
    const reasons: string[] = [];

    if (!hit) reasons.push("returned_order_missing_line");
    if (hit && Number(hit.quantity) !== Number(s.quantity)) reasons.push("quantity_mismatch");
    if (hit && hit.uom && String(hit.uom).toUpperCase() !== s.supplier_uom) reasons.push("uom_mismatch");

    return {
      key: s.key,
      submitted_item_number: submittedItem,
      returned_item_number: hit ? String(hit.item_number ?? hit.product_id ?? "") : null,
      submitted_quantity: s.quantity,
      returned_quantity: hit?.quantity ?? null,
      submitted_uom: s.supplier_uom,
      returned_uom: hit?.uom ? String(hit.uom).toUpperCase() : null,
      match: reasons.length === 0,
      mismatch_reasons: reasons,
    };
  });

  const branchMatch =
    (submittedBranch ?? "").trim() === (returnedBranch ?? submittedBranch ?? "").trim();

  return {
    verified: branchMatch && lines.every((l) => l.match) && lines.length > 0,
    branch_match: branchMatch,
    lines,
  };
}
