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
