// Shared TypeScript contracts for the ABC integration.
//
// Only the shapes that must be identical between `abc-api-proxy` and
// `supplier-api/abc/proxy` live here. Handler-specific request extras
// (e.g. `price_items_record_history` in the v2 handler) stay in the
// per-handler files until Phase 1B unifies the action union.

export interface TokenLookup {
  token?: string;
  refresh_token?: string;
  expires_at?: string;
  scope?: string;
  integration_id?: string;
  error?: string;
}

/** Actions accepted by BOTH handlers today. Superset actions per-handler
 *  are declared in the handler file until Phase 1B. */
export type CommonAbcAction =
  | "test_connection"
  | "get_status"
  | "sandbox_test_login_status"
  | "start_oauth"
  | "sync_accounts"
  | "price_items"
  | "get_branches"
  | "get_branch"
  | "search_products"
  | "get_item"
  | "place_order"
  | "submit_order"
  | "submit_test_order"
  | "validate_payload_only"
  | "get_order_status";

export interface AbcPriceLineInput {
  itemNumber: string;
  quantity: number;
  unitOfMeasure?: string;
}

export interface AbcOrderLineInput {
  item_name: string;
  description?: string;
  quantity: number;
  unit?: string;
  unit_cost?: number;
  abc_item_code?: string | null;
  srs_item_code?: string | null;
  color_specs?: string | null;
}

export interface AbcJobsiteContact {
  name?: string;
  email?: string;
  phone?: string;
}

export interface AbcPriceOverride {
  value: number;
  reason: string;
}

/**
 * The union of fields both handlers currently accept on the request body.
 * Handler-specific extras (`source_context`, `source_id`,
 * `register_webhook`, `return_path`, ...) are declared alongside their
 * handler, not here.
 */
export interface CommonProxyRequest {
  action: CommonAbcAction;
  environment?: "staging" | "sandbox" | "production";
  tenant_id?: string;
  // pricing
  requestId?: string;
  shipToNumber?: string;
  branchNumber?: string;
  purpose?: string;
  lines?: AbcPriceLineInput[];
  // products
  query?: string;
  itemNumber?: string;
  // branches
  branchCode?: string;
  // orders
  confirmationNumber?: string;
  orderNumber?: string;
  order?: unknown; // pre-shaped ABC order object
  // legacy submit_order fields (kept for back-compat)
  project_id?: string;
  estimate_id?: string;
  job_number?: string;
  customer_name?: string;
  branch_code?: string;
  delivery_method?: "roof_load" | "ground_drop" | "pickup";
  delivery_date?: string;
  delivery_address?: string;
  notes?: string;
  items?: AbcOrderLineInput[];
  // submit_test_order extended inputs (Sandy contract)
  uom?: string;
  quantity?: number;
  itemDescription?: string;
  jobsiteContact?: AbcJobsiteContact;
  priceOverride?: AbcPriceOverride;
  sandboxDemo?: boolean;
}

// ---------- Product normalization contracts ----------
//
// Consumed by supabase/functions/_shared/abc/productNormalizer.ts.
// Additive to Phase 1A — no handler currently imports these.

/**
 * Loose shape of a raw ABC catalog item as it appears in wire responses.
 * ABC returns variants across endpoints (uoms vs unitOfMeasure, color as
 * object vs string, etc.) — every field is optional and unknown-typed so
 * the normalizer stays the single source of truth.
 */
export interface RawAbcCatalogItem {
  [key: string]: unknown;
}

/** Loose shape of a raw ABC search response (varies by endpoint). */
export type RawAbcSearchResponse = Record<string, unknown> | unknown[];

export interface NormalizeOptions {
  /** Mark the resulting item as a family child (color SKU under a parent). */
  isFamilyChild?: boolean;
  /** Explicit parent item number to stamp onto family children. */
  parentItemNumber?: string;
  /** If provided, item is flagged branchVerificationRequired unless the branch is present. */
  selectedBranchNumber?: string;
}

export interface NormalizedAbcUom {
  code: string;
  description?: string;
  isDefault?: boolean;
}

export interface NormalizedAbcBranchRef {
  branchNumber: string;
  name?: string;
  available?: number | null;
}

export interface NormalizedAbcCatalogItem {
  itemNumber: string;
  itemDescription: string | null;
  familyId: string | null;
  familyName: string | null;
  parentItemNumber: string | null;
  isFamilyItem: boolean;
  isFamilyChild: boolean;
  colorName: string | null;
  colorCode: string | null;
  uoms: NormalizedAbcUom[];
  branches: NormalizedAbcBranchRef[];
  status: string | null;
  isActive: boolean | null;
  isDimensional: boolean | null;
  lengths: string[];
  /** True when caller MUST re-verify branch availability before ordering. */
  branchVerificationRequired: boolean;
  /** Untouched raw payload — normalizer never discards evidence. */
  raw: RawAbcCatalogItem;
}

export interface NormalizedAbcSearchResponse {
  items: NormalizedAbcCatalogItem[];
  pagination: Record<string, unknown> | null;
  raw: RawAbcSearchResponse;
}
