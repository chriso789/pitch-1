// abc-api — routed Edge Function for the ABC Supply v2 surface.
//
// Architecture: see plan in .lovable/plan.md and docs/EDGE_FUNCTION_RULES.md.
// OAuth (authorize start + token-exchange callback) is intentionally NOT here —
// it stays in `abc-oauth-callback` (provider redirect URI, approved exception)
// and in `abc-api-proxy` (`start_oauth`). This function exposes the post-auth
// REST surface the frontend talks to.
//
// Hard rule honored: stubs never invent prices or order acceptance. Pricing
// returns `price_pending: true` and orders return HTTP 501 until Steps 4 & 6
// land. UI must render these explicitly, never silently as $0.00 or "placed".

import {
  createRouter,
  jsonOk,
  jsonErr,
  requireAuth,
  requireTenant,
  serveRouter,
  serviceClient,
  type RouterEnv,
} from "../_shared/router.ts";
import type { Context } from "jsr:@hono/hono";

const app = createRouter("abc-api");

// ---------- public health ----------
app.get("/__health", (c) => jsonOk(c, { fn: "abc-api", ok: true }));

// ---------- auth gate for everything below ----------
app.use("/*", requireAuth);
app.use("/*", requireTenant);

// ---------- helpers ----------
function ctx(c: Context<RouterEnv>) {
  return {
    tenantId: c.get("tenantId")!,
    userId: c.get("userId")!,
    svc: serviceClient(),
  };
}

// ============================================================
// /accounts — list discovered ship-tos + branches for this tenant
// ============================================================
app.get("/accounts", async (c) => {
  const { tenantId, svc } = ctx(c);

  const { data: shipTos, error: stErr } = await svc
    .from("abc_ship_to_accounts")
    .select(
      "id, ship_to_number, name, address_line1, city, state, postal_code, is_default",
    )
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });
  if (stErr) return jsonErr(c, "accounts_query_failed", stErr.message, 500);

  const { data: branches, error: brErr } = await svc
    .from("abc_account_branches")
    .select(
      "id, ship_to_id, branch_number, name, address_line1, city, state, postal_code, is_home_branch, is_default",
    )
    .eq("tenant_id", tenantId)
    .order("is_home_branch", { ascending: false });
  if (brErr) return jsonErr(c, "branches_query_failed", brErr.message, 500);

  const byShipTo = new Map<string, typeof branches>();
  for (const b of branches ?? []) {
    if (!byShipTo.has(b.ship_to_id)) byShipTo.set(b.ship_to_id, [] as any);
    byShipTo.get(b.ship_to_id)!.push(b);
  }
  const accounts = (shipTos ?? []).map((s) => ({
    ...s,
    branches: byShipTo.get(s.id) ?? [],
  }));

  return jsonOk(c, { accounts, count: accounts.length });
});

// ============================================================
// /catalog/search — typed stub (catalog sync ships in Step 3)
// ============================================================
app.get("/catalog/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Number(c.req.query("limit") ?? 25), 100);
  // Real impl will use `abc_catalog_items.search_tsv` with websearch_to_tsquery.
  return jsonOk(c, {
    items: [] as Array<{
      item_number: string;
      description: string;
      family_id: string | null;
      color_name: string | null;
      uoms: unknown;
    }>,
    total: 0,
    query: q,
    limit,
    pending: true,
    reason: "catalog_not_synced",
  });
});

// ============================================================
// /catalog/family/:itemNumber — typed stub
// ============================================================
app.get("/catalog/family/:itemNumber", (c) =>
  jsonOk(c, {
    family: null,
    members: [] as unknown[],
    pending: true,
    reason: "catalog_not_synced",
  }),
);

// ============================================================
// /availability — typed stub, never invents stock
// ============================================================
app.post("/availability", async (c) => {
  let body: { items?: Array<{ item_number: string }> } = {};
  try {
    body = await c.req.json();
  } catch { /* tolerate empty */ }
  const items = (body.items ?? []).map((it) => ({
    item_number: it.item_number,
    available: null as number | null,
    pending: true,
    reason: "availability_not_wired" as const,
  }));
  return jsonOk(c, { items });
});

// ============================================================
// /price — typed stub. NEVER returns $0.00; always price_pending.
// ============================================================
app.post("/price", async (c) => {
  let body: {
    purpose?: "estimating" | "quoting" | "ordering";
    ship_to_number?: string;
    branch_number?: string;
    items?: Array<{ item_number: string; uom?: string }>;
  } = {};
  try {
    body = await c.req.json();
  } catch { /* tolerate */ }

  const items = (body.items ?? []).map((it) => ({
    item_number: it.item_number,
    uom: it.uom ?? null,
    unit_price: null as number | null,
    currency: "USD",
    price_pending: true,
    reason: "catalog_not_synced" as const,
  }));
  return jsonOk(c, {
    purpose: body.purpose ?? "estimating",
    ship_to_number: body.ship_to_number ?? null,
    branch_number: body.branch_number ?? null,
    items,
  });
});

// ============================================================
// /orders/submit — explicit 501. UI must show "Coming soon",
// never silently succeed. Real impl in Step 6.
// ============================================================
app.post("/orders/submit", (c) =>
  jsonErr(
    c,
    "abc_orders_not_enabled",
    "ABC order submission is not yet enabled on this tenant. Step 6 of the v2 rollout will wire this route.",
    501,
  ),
);

app.get("/orders/:id", (c) =>
  jsonErr(
    c,
    "abc_orders_not_enabled",
    "ABC order detail fetch is not yet enabled on this tenant.",
    501,
  ),
);

// ============================================================
// Dispatch via x-route / __route so `edgeApi("abc-api", "/accounts")` works.
// ============================================================
serveRouter(app);
