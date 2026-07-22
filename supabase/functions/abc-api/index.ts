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
  const { tenantId, userId, svc } = ctx(c);

  const { data: userConnections, error: ucErr } = await svc
    .from("abc_user_connections")
    .select("id, environment, status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false });
  if (ucErr) return jsonErr(c, "user_connections_query_failed", ucErr.message, 500);

  const connected = userConnections ?? [];
  const production = connected.filter((r: any) => r.environment === "production");
  const selectedConnections = production.length > 0 ? production : connected;
  const connectionIds = selectedConnections.map((r: any) => r.id).filter(Boolean);

  if (connectionIds.length === 0) {
    return jsonOk(c, { accounts: [], count: 0 });
  }

  const { data: shipTos, error: stErr } = await svc
    .from("abc_ship_to_accounts")
    .select(
      "id, ship_to_number, name, address_line1, city, state, postal_code, is_default",
    )
    .eq("tenant_id", tenantId)
    .in("connection_id", connectionIds)
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
  // Per Sandy's required ABC setup flow: a Ship-To with no branches[] cannot
  // be used for pricing (no branchNumber to send). Filter here so callers —
  // including the setup wizard, diagnostics, and any future surface — can
  // never accidentally render or select a zero-branch account. Defense in
  // depth: sync_accounts also refuses to persist these.
  const accounts = (shipTos ?? [])
    .map((s) => ({
      ...s,
      branches: byShipTo.get(s.id) ?? [],
    }))
    .filter((s) => Array.isArray(s.branches) && s.branches.length > 0);

  return jsonOk(c, { accounts, count: accounts.length });
});

// ============================================================
// /setup/status — does this tenant have a complete pricing setup?
// Source of truth for the locked-state gate on the pricing panel.
// ============================================================
app.get("/setup/status", async (c) => {
  const { tenantId, svc } = ctx(c);
  const { data, error } = await svc
    .from("abc_connections")
    .select(
      "id, environment, connection_status, selected_ship_to_number, selected_branch_number, selected_ship_to_snapshot, selected_branch_snapshot, setup_completed_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) return jsonErr(c, "setup_status_failed", error.message, 500);
  const rows = data ?? [];
  const connectedRows = rows.filter(
    (r: any) => (r.connection_status || "").toLowerCase() === "connected",
  );
  const preferred =
    connectedRows.find((r: any) => r.environment === "production") ||
    connectedRows[0] ||
    rows[0] ||
    null;
  const ready = !!(
    preferred?.setup_completed_at &&
    preferred?.selected_ship_to_number &&
    preferred?.selected_branch_number
  );
  return jsonOk(c, {
    ready,
    connection: preferred,
    rows,
  });
});

// ============================================================
// /setup/select — persist Ship-To + Branch selection.
// Validates that the branch genuinely belongs to the chosen ship-to
// using the synced accounts/branches tables (populated by abc-oauth-callback).
// ============================================================
app.post("/setup/select", async (c) => {
  const { tenantId, userId, svc } = ctx(c);
  let body: { ship_to_number?: string; branch_number?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const shipToNumber = (body.ship_to_number || "").trim();
  const branchNumber = (body.branch_number || "").trim();
  if (!shipToNumber || !branchNumber) {
    return jsonErr(
      c,
      "invalid_setup_payload",
      "ship_to_number and branch_number are required.",
      400,
    );
  }

  const { data: userConnections, error: ucErr } = await svc
    .from("abc_user_connections")
    .select("id, environment, status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false });
  if (ucErr) return jsonErr(c, "user_connections_query_failed", ucErr.message, 500);
  const connected = userConnections ?? [];
  const production = connected.filter((r: any) => r.environment === "production");
  const selectedConnections = production.length > 0 ? production : connected;
  const selectedEnvironment = selectedConnections[0]?.environment ?? null;
  const connectionIds = selectedConnections.map((r: any) => r.id).filter(Boolean);
  if (connectionIds.length === 0) {
    return jsonErr(c, "abc_not_connected", "ABC is not connected for this user.", 409);
  }

  // 1) Verify the ship-to exists for this tenant and active environment.
  const { data: shipTo, error: stErr } = await svc
    .from("abc_ship_to_accounts")
    .select(
      "id, ship_to_number, name, address_line1, city, state, postal_code",
    )
    .eq("tenant_id", tenantId)
    .in("connection_id", connectionIds)
    .eq("ship_to_number", shipToNumber)
    .maybeSingle();
  if (stErr) return jsonErr(c, "ship_to_lookup_failed", stErr.message, 500);
  if (!shipTo) {
    return jsonErr(
      c,
      "ship_to_not_found",
      "Selected Ship-To is not connected to this tenant.",
      404,
    );
  }

  // 2) Verify the branch belongs to that ship-to. NEVER trust client mapping.
  const { data: branch, error: brErr } = await svc
    .from("abc_account_branches")
    .select(
      "id, branch_number, name, address_line1, city, state, postal_code, is_home_branch",
    )
    .eq("tenant_id", tenantId)
    .eq("ship_to_id", shipTo.id)
    .eq("branch_number", branchNumber)
    .maybeSingle();
  if (brErr) return jsonErr(c, "branch_lookup_failed", brErr.message, 500);
  if (!branch) {
    return jsonErr(
      c,
      "branch_not_in_ship_to",
      "Selected Branch does not belong to the chosen Ship-To.",
      400,
    );
  }

  // 3) Persist on the connection row (prefer connected, else most recent).
  const { data: connRows, error: connErr } = await svc
    .from("abc_connections")
    .select("id, environment, connection_status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("environment", selectedEnvironment)
    .order("updated_at", { ascending: false });
  if (connErr) return jsonErr(c, "connection_lookup_failed", connErr.message, 500);
  const target =
    (connRows ?? []).find(
      (r: any) => (r.connection_status || "").toLowerCase() === "connected",
    ) || (connRows ?? [])[0];
  if (!target) {
    return jsonErr(
      c,
      "abc_not_connected",
      "ABC is not connected for this tenant. Complete OAuth first.",
      409,
    );
  }

  const { error: updErr } = await svc
    .from("abc_connections")
    .update({
      selected_ship_to_number: shipTo.ship_to_number,
      selected_branch_number: branch.branch_number,
      selected_ship_to_snapshot: shipTo,
      selected_branch_snapshot: branch,
      setup_completed_at: new Date().toISOString(),
    })
    .eq("id", target.id)
    .eq("tenant_id", tenantId);
  if (updErr) return jsonErr(c, "setup_update_failed", updErr.message, 500);

  console.log(
    `[abc-api/setup] tenant=${tenantId} user=${userId} shipTo=${shipTo.ship_to_number} branch=${branch.branch_number}`,
  );

  return jsonOk(c, {
    ready: true,
    selected_ship_to_number: shipTo.ship_to_number,
    selected_branch_number: branch.branch_number,
  });
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
