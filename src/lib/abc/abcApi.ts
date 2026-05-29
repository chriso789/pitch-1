// ABC v2 — typed client-side wrappers over the `abc-api` routed Edge Function.
// All calls go through `edgeApi(...)`, never direct supabase.functions.invoke.
// Stubs (catalog/availability/price/orders) intentionally surface `pending` /
// `price_pending` / 501 errors — UI MUST render those states, never collapse
// them into $0.00 or silent success.

import { edgeApi } from "@/lib/edgeApi";

export type AbcBranch = {
  id: string;
  ship_to_id: string;
  branch_number: string;
  name: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_home_branch: boolean;
  is_default: boolean;
};

export type AbcShipToAccount = {
  id: string;
  ship_to_number: string;
  name: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_default: boolean;
  branches: AbcBranch[];
};

export type AbcCatalogItem = {
  item_number: string;
  description: string;
  family_id: string | null;
  color_name: string | null;
  uoms: unknown;
};

export type AbcAvailabilityRow = {
  item_number: string;
  available: number | null;
  pending: boolean;
  reason?: string;
};

export type AbcPriceRow = {
  item_number: string;
  uom: string | null;
  unit_price: number | null;
  currency: string;
  price_pending: boolean;
  reason?: string;
};

export type AbcPricePurpose = "estimating" | "quoting" | "ordering";

// ---------- accounts ----------

export async function getAbcAccounts() {
  return edgeApi<{ accounts: AbcShipToAccount[]; count: number }>(
    "abc-api",
    "/accounts",
  );
}

// ---------- catalog ----------

export async function searchAbcCatalog(q: string, limit = 25) {
  return edgeApi<{
    items: AbcCatalogItem[];
    total: number;
    query: string;
    limit: number;
    pending?: boolean;
    reason?: string;
  }>("abc-api", `/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export async function getAbcFamily(itemNumber: string) {
  return edgeApi<{
    family: { item_number: string; family_id: string | null } | null;
    members: AbcCatalogItem[];
    pending?: boolean;
    reason?: string;
  }>("abc-api", `/catalog/family/${encodeURIComponent(itemNumber)}`);
}

// ---------- availability ----------

export async function getAbcAvailability(items: Array<{ item_number: string }>) {
  return edgeApi<{ items: AbcAvailabilityRow[] }>(
    "abc-api",
    "/availability",
    { items },
  );
}

// ---------- pricing ----------

export async function getAbcPrice(params: {
  purpose: AbcPricePurpose;
  ship_to_number?: string;
  branch_number?: string;
  items: Array<{ item_number: string; uom?: string }>;
}) {
  return edgeApi<{
    purpose: AbcPricePurpose;
    ship_to_number: string | null;
    branch_number: string | null;
    items: AbcPriceRow[];
  }>("abc-api", "/price", params);
}

// ---------- orders (501 until Step 6) ----------

export async function submitAbcOrder(payload: Record<string, unknown>) {
  return edgeApi<never>("abc-api", "/orders/submit", payload);
}

export async function getAbcOrder(id: string) {
  return edgeApi<never>("abc-api", `/orders/${encodeURIComponent(id)}`);
}
