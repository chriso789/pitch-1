// Typed client for the authoritative supplier item-code resolution routes.
//
// The browser never constructs supplier payloads or item codes. It sends the
// canonical Pitch selection (variant + color + UOM + qty) and renders whatever
// the server resolves — including the blocking failure reasons.

import { edgeApi } from "@/lib/edgeApi";

export type SupplierKind = "abc" | "srs" | "qxo" | "other";

export type ResolutionFailureCode =
  | "no_mapping"
  | "ambiguous"
  | "inactive"
  | "discontinued"
  | "superseded"
  | "not_approved"
  | "uom_mismatch"
  | "branch_mismatch"
  | "connection_mismatch"
  | "color_required"
  | "variant_not_found"
  | "color_not_in_product_line"
  | "stale_validation"
  | "invalid_quantity";

export interface ResolveLineInput {
  key: string;
  variant_id: string;
  color_id?: string | null;
  uom: string;
  quantity: number;
}

export interface ResolvedLine {
  key: string;
  ok: boolean;
  failure_code?: ResolutionFailureCode;
  failure_message?: string;

  variant_id: string;
  color_id: string | null;
  manufacturer_name: string | null;
  product_line_name: string | null;
  variant_name: string | null;
  profile: string | null;
  dimensions: string | null;
  packaging: string | null;
  canonical_uom: string | null;
  color_name: string | null;
  manufacturer_color_code: string | null;
  quantity: number;
  requested_uom: string;

  supplier: SupplierKind;
  branch_code: string | null;
  mapping_id: string | null;
  mapping_revision: number | null;
  supplier_item_number: string | null;
  supplier_catalog_item_id: string | null;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string | null;
  validated_at: string | null;

  candidates?: Array<{
    mapping_id: string;
    supplier_item_number: string;
    supplier_description: string | null;
  }>;
}

export interface SupplierScope {
  supplier: SupplierKind;
  supplier_connection_id?: string | null;
  supplier_account_number?: string | null;
  branch_code?: string | null;
}

export interface PreflightResult {
  ok: boolean;
  lines: ResolvedLine[];
  blocking: Array<{ key: string; failure_code: ResolutionFailureCode; failure_message: string }>;
}

export const FAILURE_LABELS: Record<ResolutionFailureCode, string> = {
  no_mapping: "No supplier item mapped",
  ambiguous: "Multiple candidates — manager review required",
  inactive: "Mapping inactive",
  discontinued: "Supplier item discontinued",
  superseded: "Supplier item replaced",
  not_approved: "Mapping not approved for ordering",
  uom_mismatch: "Supplier item does not support this UOM",
  branch_mismatch: "Mapping validated for a different branch",
  connection_mismatch: "Mapping belongs to a different supplier account",
  color_required: "Color selection required",
  variant_not_found: "Product variant not found",
  color_not_in_product_line: "Color does not belong to this product line",
  stale_validation: "Catalog validation is stale — revalidate",
  invalid_quantity: "Invalid quantity",
};

export async function resolveSupplierItems(scope: SupplierScope, lines: ResolveLineInput[]) {
  return edgeApi<{
    supplier: SupplierKind;
    branch_code: string | null;
    lines: ResolvedLine[];
    unresolved_count: number;
  }>("supplier-api", "/catalog/resolve", { ...scope, lines });
}

export async function preflightSupplierOrder(scope: SupplierScope, lines: ResolveLineInput[]) {
  return edgeApi<PreflightResult>("supplier-api", "/orders/preflight", { ...scope, lines });
}

export interface PrepareOrderInput extends SupplierScope {
  lines: ResolveLineInput[];
  project_id?: string | null;
  estimate_id?: string | null;
  material_order_id?: string | null;
  order_version?: number;
  po_number?: string | null;
  job_number?: string | null;
  customer_name?: string | null;
  ship_to_number?: string | null;
  delivery_address?: Record<string, unknown> | null;
  requested_delivery_date?: string | null;
  notes?: string | null;
}

/** Builds and snapshots the outbound payload server-side. Does NOT transmit it. */
export async function prepareSupplierOrder(input: PrepareOrderInput) {
  return edgeApi<{
    submission_id: string;
    idempotency_key: string;
    payload_hash: string;
    reused: boolean;
    state: string;
    lines: ResolvedLine[];
    payload: Record<string, unknown>;
  }>("supplier-api", "/orders/prepare", input as unknown as Record<string, unknown>);
}

export async function reconcileSupplierOrder(input: {
  submission_id: string;
  returned_lines: Array<{ item_number?: string; product_id?: string; quantity?: number; uom?: string }>;
  returned_branch_code?: string | null;
}) {
  return edgeApi<{
    verified: boolean;
    branch_match: boolean;
    lines: Array<{ key: string; match: boolean; mismatch_reasons: string[] }>;
  }>("supplier-api", "/orders/reconcile", input);
}
