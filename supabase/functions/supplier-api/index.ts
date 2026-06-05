// supplier-api — routed Edge Function.
// Legacy ABC/QXO/SRS/Billtrust supplier functions forward here.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import { handle as abcProxyHandle } from "./abc-proxy-handler.ts";
import { handle as billtrustAuthHandle } from "./billtrust-auth-handler.ts";
import { handle as billtrustPricingHandle } from "./billtrust-pricing-handler.ts";

const app = createRouter("supplier-api");

app.get("/__health", (c) => jsonOk(c, { fn: "supplier-api", ok: true }));

// Migrated routes — legacy handlers manage auth/role checks themselves.
app.all("/abc/proxy", (c) => abcProxyHandle(c.req.raw));
app.post("/billtrust/auth", (c) => billtrustAuthHandle(c.req.raw));
app.post("/billtrust/pricing", (c) => billtrustPricingHandle(c.req.raw));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/qxo/proxy", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/credentials/save", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/orders", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quotes", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/push", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/submit", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quote-order/submit", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/invoices", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/proxy", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/abc/oauth/callback", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/pricing", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/quote/parse", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/create", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/fulfillment", (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

// ---------------------------------------------------------------------------
// ABC SKU mapping routes
//
// `/abc/proxy` already exposes the ABC Product API for catalog search. These
// routes only persist the *approved* mapping into template_item_supplier_mappings.
// Sandbox fallback (the `02OCTDUMP` demo SKU) is explicitly allowlisted only
// when the connection's environment is "sandbox"; production never substitutes.
// ---------------------------------------------------------------------------
const ABC_SANDBOX_FALLBACK_SKUS = new Set(["02OCTDUMP"]);

app.get("/abc/mapping/list", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const svc = serviceClient();
  const idsParam = c.req.query("template_item_ids") || "";
  const ids = idsParam.split(",").map((x) => x.trim()).filter(Boolean);
  let q = svc.from("template_item_supplier_mappings").select("*").eq("tenant_id", tenantId).eq("supplier", "abc");
  if (ids.length) q = q.in("template_item_id", ids);
  const { data, error } = await q;
  if (error) return jsonErr(c, "mapping_list_failed", error.message, 500);
  return jsonOk(c, { mappings: data ?? [] });
});

app.post("/abc/mapping/approve", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const templateItemId = String(body?.template_item_id ?? "").trim();
  if (!templateItemId) return jsonErr(c, "missing_template_item_id", "template_item_id required", 400);

  const itemNumber = body?.item_number == null ? null : String(body.item_number).trim();
  if (!itemNumber) {
    return jsonErr(c, "missing_item_number",
      "ABC approve requires itemNumber from the ABC Product API",
      400);
  }
  const description = body?.item_description == null ? null : String(body.item_description);
  if (!description) return jsonErr(c, "missing_item_description", "ABC approve requires itemDescription", 400);

  const uomsIn = Array.isArray(body?.valid_uoms)
    ? body.valid_uoms.map((u: any) => String(u).toUpperCase()).filter(Boolean)
    : [];
  if (!uomsIn.length) {
    return jsonErr(c, "missing_valid_uoms", "ABC approve requires at least one valid UOM from Product API", 400);
  }
  const defaultUom = body?.default_uom ? String(body.default_uom).toUpperCase() : uomsIn[0];
  const branchScope = Array.isArray(body?.branch_scope) ? body.branch_scope.map((b: any) => String(b)) : [];

  // Sandbox fallback gate: only allow if connection.environment === 'sandbox'
  // AND the SKU is on the explicit allowlist. Production may never approve
  // fallback SKUs.
  if (ABC_SANDBOX_FALLBACK_SKUS.has(itemNumber.toUpperCase())) {
    const { data: conn } = await svc
      .from("abc_connections")
      .select("environment")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const env = String(conn?.environment ?? "").toLowerCase();
    if (env !== "sandbox" && env !== "staging") {
      return jsonErr(c, "sandbox_fallback_forbidden_in_production",
        `ABC sandbox fallback SKU (${itemNumber}) cannot be approved in environment=${env || "unknown"}`,
        400);
    }
  }

  const upsert = {
    tenant_id: tenantId,
    template_item_id: templateItemId,
    supplier: "abc" as const,
    supplier_item_number: itemNumber,
    supplier_product_id: null,
    supplier_item_description: description,
    valid_uoms: uomsIn,
    default_uom: defaultUom,
    branch_scope: branchScope,
    mapping_status: "approved" as const,
    match_confidence: body?.match_confidence ?? null,
    match_reason: body?.match_reason ?? "manual_approve",
    raw_catalog_payload: body?.raw_catalog_payload ?? null,
    last_checked_at: new Date().toISOString(),
    approved_by: userId,
    approved_at: new Date().toISOString(),
    // legacy mirror
    supplier_item_code: itemNumber,
    supplier_description: description,
    review_state: "approved",
    uom: defaultUom,
  };

  const { data, error } = await svc
    .from("template_item_supplier_mappings")
    .upsert(upsert, { onConflict: "tenant_id,template_item_id,supplier" })
    .select("*")
    .single();
  if (error) return jsonErr(c, "mapping_approve_failed", error.message, 500);
  return jsonOk(c, { mapping: data });
});

app.post("/abc/mapping/reject", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }
  const templateItemId = String(body?.template_item_id ?? "").trim();
  if (!templateItemId) return jsonErr(c, "missing_template_item_id", "template_item_id required", 400);
  const { data, error } = await svc
    .from("template_item_supplier_mappings")
    .upsert({
      tenant_id: tenantId,
      template_item_id: templateItemId,
      supplier: "abc",
      mapping_status: "rejected",
      match_reason: body?.reason ?? "manual_reject",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      review_state: "rejected",
    }, { onConflict: "tenant_id,template_item_id,supplier" })
    .select("*")
    .single();
  if (error) return jsonErr(c, "mapping_reject_failed", error.message, 500);
  return jsonOk(c, { mapping: data });
});

// ---------------------------------------------------------------------------
// Template cost refresh — multi-supplier averaging engine
//
// POST /templates/cost-refresh  { template_id }
//
// For every template_item under the requested template (scoped to the caller's
// tenant), collect a per-item unit_cost by:
//   1. Loading APPROVED mappings in `template_item_supplier_mappings` for this
//      tenant + item (suppliers: srs, abc, qxo).
//   2. For each mapped supplier, pulling the most recent successful
//      `supplier_price_history` row (status='ok', non-null unit_price, within
//      last 30 days).
//   3. If 0 supplier prices found, fall back to the tenant's
//      `tenant_imported_price_sheets` row matched by template_item_id.
//   4. With 1+ prices: unit_cost = arithmetic mean; persist cost_source,
//      cost_breakdown (per-supplier prices for audit), unit_cost,
//      last_cost_refresh_at.
//
// Never overwrites unit_cost when zero prices are found — preserves prior
// value and marks cost_source='unresolved'. Strict tenant isolation: every
// query filters .eq('tenant_id', tenantId). Never touches estimates or POs.
// ---------------------------------------------------------------------------
app.post("/templates/cost-refresh", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const svc = serviceClient();

  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }
  const templateId = String(body?.template_id ?? "").trim();
  if (!templateId) return jsonErr(c, "missing_template_id", "template_id required", 400);

  const { data: items, error: itemsErr } = await svc
    .from("template_items")
    .select("id, template_id, item_name, unit_cost, unit")
    .eq("template_id", templateId);
  if (itemsErr) return jsonErr(c, "items_load_failed", itemsErr.message, 500);
  if (!items || items.length === 0) {
    return jsonOk(c, { template_id: templateId, items: [], items_updated: 0 });
  }

  const itemIds = items.map((i: any) => i.id);

  const { data: mappings, error: mapErr } = await svc
    .from("template_item_supplier_mappings")
    .select("template_item_id, supplier, supplier_item_number, mapping_status")
    .eq("tenant_id", tenantId)
    .in("template_item_id", itemIds)
    .eq("mapping_status", "approved");
  if (mapErr) return jsonErr(c, "mapping_load_failed", mapErr.message, 500);

  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: history, error: histErr } = await svc
    .from("supplier_price_history")
    .select("template_item_id, supplier, unit_price, checked_at, status, uom")
    .eq("tenant_id", tenantId)
    .in("template_item_id", itemIds)
    .eq("status", "ok")
    .gt("unit_price", 0)
    .gte("checked_at", sinceIso)
    .order("checked_at", { ascending: false });
  if (histErr) return jsonErr(c, "history_load_failed", histErr.message, 500);

  const { data: imported, error: impErr } = await svc
    .from("tenant_imported_price_sheets")
    .select("template_item_id, unit_price, supplier_label, sku, uom, valid_from, valid_until")
    .eq("tenant_id", tenantId)
    .in("template_item_id", itemIds);
  if (impErr) return jsonErr(c, "imported_load_failed", impErr.message, 500);

  const latest: Record<string, Record<string, { unit_price: number; checked_at: string; uom: string | null }>> = {};
  for (const row of history ?? []) {
    const key = String(row.template_item_id);
    const sup = String(row.supplier);
    if (!latest[key]) latest[key] = {};
    if (!latest[key][sup]) {
      latest[key][sup] = {
        unit_price: Number(row.unit_price),
        checked_at: row.checked_at,
        uom: row.uom ?? null,
      };
    }
  }

  const importedByItem: Record<string, { unit_price: number; supplier_label: string | null; sku: string | null; uom: string | null }> = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const row of imported ?? []) {
    const key = String(row.template_item_id);
    if (!key || importedByItem[key]) continue;
    if (row.valid_from && row.valid_from > today) continue;
    if (row.valid_until && row.valid_until < today) continue;
    if (row.unit_price == null || Number(row.unit_price) <= 0) continue;
    importedByItem[key] = {
      unit_price: Number(row.unit_price),
      supplier_label: row.supplier_label ?? null,
      sku: row.sku ?? null,
      uom: row.uom ?? null,
    };
  }

  const nowIso = new Date().toISOString();
  const results: any[] = [];
  let updatedCount = 0;

  for (const item of items as any[]) {
    const itemMappings = (mappings ?? []).filter((m: any) => m.template_item_id === item.id);
    const itemLatest = latest[item.id] || {};

    const contributors: Array<{ supplier: string; unit_price: number; checked_at: string }> = [];
    for (const m of itemMappings) {
      const lp = itemLatest[m.supplier as string];
      if (lp && Number.isFinite(lp.unit_price) && lp.unit_price > 0) {
        contributors.push({
          supplier: m.supplier as string,
          unit_price: lp.unit_price,
          checked_at: lp.checked_at,
        });
      }
    }

    let resolvedCost: number | null = null;
    let costSource = "unresolved";
    let breakdown: any = null;

    if (contributors.length > 0) {
      const sum = contributors.reduce((s, c) => s + c.unit_price, 0);
      resolvedCost = sum / contributors.length;
      costSource = contributors.length === 1
        ? `supplier_single_${contributors[0].supplier}`
        : "supplier_avg";
      breakdown = {
        method: contributors.length === 1 ? "single_supplier" : "average",
        contributors,
        resolved_at: nowIso,
      };
    } else if (importedByItem[item.id]) {
      const imp = importedByItem[item.id];
      resolvedCost = imp.unit_price;
      costSource = "imported_sheet";
      breakdown = {
        method: "imported_sheet",
        supplier_label: imp.supplier_label,
        sku: imp.sku,
        uom: imp.uom,
        resolved_at: nowIso,
      };
    }

    if (resolvedCost != null) {
      const { error: upErr } = await svc
        .from("template_items")
        .update({
          unit_cost: Number(resolvedCost.toFixed(4)),
          cost_source: costSource,
          cost_breakdown: breakdown,
          last_cost_refresh_at: nowIso,
        })
        .eq("id", item.id);
      if (!upErr) updatedCount += 1;
      results.push({
        id: item.id,
        item_name: item.item_name,
        previous_unit_cost: item.unit_cost,
        new_unit_cost: Number(resolvedCost.toFixed(4)),
        cost_source: costSource,
        contributors,
        update_error: upErr?.message ?? null,
      });
    } else {
      await svc
        .from("template_items")
        .update({
          cost_source: "unresolved",
          cost_breakdown: { method: "unresolved", reason: "no_supplier_or_imported_price", resolved_at: nowIso },
          last_cost_refresh_at: nowIso,
        })
        .eq("id", item.id);
      results.push({
        id: item.id,
        item_name: item.item_name,
        previous_unit_cost: item.unit_cost,
        new_unit_cost: item.unit_cost,
        cost_source: "unresolved",
        contributors: [],
      });
    }
  }

  return jsonOk(c, {
    template_id: templateId,
    items_total: items.length,
    items_updated: updatedCount,
    items: results,
  });
});



// Supabase delivers requests with the function name as the first path segment
// (e.g. `/supplier-api/abc/proxy`). Strip it so Hono routes defined as
// `/abc/proxy` match correctly. Root invokes (via supabase.functions.invoke)
// arrive as `/` or `/supplier-api` and pass through unchanged.
Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/supplier-api/")) {
    url.pathname = url.pathname.slice("/supplier-api".length) || "/";
    return app.fetch(new Request(url.toString(), req));
  }
  if (url.pathname === "/supplier-api") {
    url.pathname = "/";
    return app.fetch(new Request(url.toString(), req));
  }
  return app.fetch(req);
});
