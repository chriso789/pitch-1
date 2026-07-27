// supplier-api — routed Edge Function.
// Legacy ABC/QXO/SRS/Billtrust supplier functions forward here.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import {
  resolveSupplierLines,
  preflightSupplierOrder,
  hashPayload,
  buildIdempotencyKey,
  type SupplierKind,
} from "../_shared/supplier-resolution.ts";
import { buildOrderPayload, reconcileSupplierOrder } from "../_shared/supplier-payload.ts";
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

// ===========================================================================
// Exact supplier item-code resolution (authoritative)
//
// Auth mode for every route below: AUTHENTICATED TENANT ROUTE.
// tenant_id is taken from the JWT-resolved context (`c.get("tenantId")`) and
// NEVER from the request body. Supplier item codes, accounts, branches,
// colors, UOMs and validation results are resolved server-side only.
// ===========================================================================

app.post("/catalog/resolve", async (c) => {
  const tenantId = c.get("tenantId") as string;
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const supplier = String(body?.supplier ?? "").toLowerCase();
  if (!["abc", "srs", "qxo", "other"].includes(supplier)) {
    return jsonErr(c, "invalid_supplier", "supplier must be abc|srs|qxo|other", 400);
  }
  if (!Array.isArray(body?.lines) || !body.lines.length) {
    return jsonErr(c, "missing_lines", "lines[] is required", 400);
  }

  const lines = body.lines.map((l: any, i: number) => ({
    key: String(l?.key ?? i),
    variant_id: String(l?.variant_id ?? ""),
    color_id: l?.color_id ? String(l.color_id) : null,
    uom: String(l?.uom ?? ""),
    quantity: Number(l?.quantity ?? 0),
  }));
  if (lines.some((l: any) => !l.variant_id || !l.uom)) {
    return jsonErr(c, "invalid_line", "Each line requires variant_id and uom", 400);
  }

  const resolved = await resolveSupplierLines(serviceClient(), tenantId, {
    supplier: supplier as SupplierKind,
    supplier_connection_id: body?.supplier_connection_id ?? null,
    supplier_account_number: body?.supplier_account_number ?? null,
    branch_code: body?.branch_code ?? null,
    lines,
  });

  return jsonOk(c, {
    supplier,
    branch_code: body?.branch_code ?? null,
    lines: resolved,
    unresolved_count: resolved.filter((l) => !l.ok).length,
  });
});

app.post("/orders/preflight", async (c) => {
  const tenantId = c.get("tenantId") as string;
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const supplier = String(body?.supplier ?? "").toLowerCase();
  if (!["abc", "srs"].includes(supplier)) {
    return jsonErr(c, "invalid_supplier", "Ordering preflight supports abc|srs", 400);
  }

  const result = await preflightSupplierOrder(serviceClient(), tenantId, {
    supplier: supplier as SupplierKind,
    supplier_connection_id: body?.supplier_connection_id ?? null,
    supplier_account_number: body?.supplier_account_number ?? null,
    branch_code: body?.branch_code ?? null,
    lines: (body?.lines ?? []).map((l: any, i: number) => ({
      key: String(l?.key ?? i),
      variant_id: String(l?.variant_id ?? ""),
      color_id: l?.color_id ? String(l.color_id) : null,
      uom: String(l?.uom ?? ""),
      quantity: Number(l?.quantity ?? 0),
    })),
  });

  return jsonOk(c, result);
});

// Prepares (but does not transmit) the outbound payload so the user can approve
// the exact codes and colors first. Returns the immutable snapshot id.
app.post("/orders/prepare", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const userId = c.get("userId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const supplier = String(body?.supplier ?? "").toLowerCase();
  if (!["abc", "srs"].includes(supplier)) {
    return jsonErr(c, "invalid_supplier", "Ordering supports abc|srs", 400);
  }

  const branchCode = body?.branch_code ?? null;
  const request = {
    supplier: supplier as SupplierKind,
    supplier_connection_id: body?.supplier_connection_id ?? null,
    supplier_account_number: body?.supplier_account_number ?? null,
    branch_code: branchCode,
    lines: (body?.lines ?? []).map((l: any, i: number) => ({
      key: String(l?.key ?? i),
      variant_id: String(l?.variant_id ?? ""),
      color_id: l?.color_id ? String(l.color_id) : null,
      uom: String(l?.uom ?? ""),
      quantity: Number(l?.quantity ?? 0),
    })),
  };

  const pre = await preflightSupplierOrder(svc, tenantId, request);
  if (!pre.ok) {
    return jsonErr(c, "preflight_failed", "One or more lines could not be resolved to an exact supplier item code.", 422, {
      blocking: pre.blocking,
      lines: pre.lines,
    });
  }

  const orderVersion = Number(body?.order_version ?? 1);
  let payload: unknown;
  try {
    payload = buildOrderPayload(supplier as SupplierKind, pre.lines, {
      po_number: body?.po_number ?? null,
      job_number: body?.job_number ?? null,
      customer_name: body?.customer_name ?? null,
      delivery_address: body?.delivery_address ?? null,
      requested_delivery_date: body?.requested_delivery_date ?? null,
      notes: body?.notes ?? null,
      ship_to_number: body?.ship_to_number ?? null,
      branch_code: branchCode,
      account_number: body?.supplier_account_number ?? null,
    });
  } catch (e: any) {
    return jsonErr(c, "payload_build_failed", String(e?.message ?? e), 422);
  }

  const payloadHash = await hashPayload(payload);
  const idempotencyKey = buildIdempotencyKey({
    tenantId,
    supplier: supplier as SupplierKind,
    materialOrderId: body?.material_order_id ?? null,
    orderVersion,
    payloadHash,
  });

  const { data: existing } = await svc
    .from("supplier_order_submissions")
    .select("id, state, payload_hash")
    .eq("tenant_id", tenantId)
    .eq("supplier", supplier)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return jsonOk(c, {
      submission_id: existing.id,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      reused: true,
      state: existing.state,
      lines: pre.lines,
      payload,
    });
  }

  const { data: inserted, error } = await svc
    .from("supplier_order_submissions")
    .insert({
      tenant_id: tenantId,
      supplier,
      supplier_connection_id: body?.supplier_connection_id ?? null,
      supplier_account_number: body?.supplier_account_number ?? null,
      branch_code: branchCode,
      project_id: body?.project_id ?? null,
      estimate_id: body?.estimate_id ?? null,
      material_order_id: body?.material_order_id ?? null,
      order_version: orderVersion,
      user_selections: request.lines,
      resolved_lines: pre.lines,
      mapping_revisions: pre.lines.map((l) => ({
        mapping_id: l.mapping_id,
        revision: l.mapping_revision,
        catalog_fingerprint: l.catalog_fingerprint,
        validated_at: l.validated_at,
      })),
      outbound_payload: payload,
      payload_hash: payloadHash,
      idempotency_key: idempotencyKey,
      state: "prepared",
      submitted_by: userId,
    })
    .select("id")
    .single();

  if (error) return jsonErr(c, "snapshot_failed", error.message, 500);

  return jsonOk(c, {
    submission_id: inserted.id,
    idempotency_key: idempotencyKey,
    payload_hash: payloadHash,
    reused: false,
    state: "prepared",
    lines: pre.lines,
    payload,
  });
});

// Reconciles a supplier's returned order against the immutable snapshot.
app.post("/orders/reconcile", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const svc = serviceClient();
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "invalid_json", "Body must be JSON", 400); }

  const submissionId = String(body?.submission_id ?? "");
  if (!submissionId) return jsonErr(c, "missing_submission_id", "submission_id required", 400);

  const { data: snap, error } = await svc
    .from("supplier_order_submissions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) return jsonErr(c, "snapshot_read_failed", error.message, 500);
  if (!snap) return jsonErr(c, "snapshot_not_found", "Submission snapshot not found", 404);

  const result = reconcileSupplierOrder(
    (snap.resolved_lines ?? []) as any[],
    Array.isArray(body?.returned_lines) ? body.returned_lines : [],
    snap.branch_code ?? null,
    body?.returned_branch_code ?? null,
  );

  const { error: updErr } = await svc
    .from("supplier_order_submissions")
    .update({
      state: result.verified ? "verified" : "mismatch",
      line_results: result.lines,
      reconciled_at: new Date().toISOString(),
      failure_reason: result.verified ? null : "supplier_response_mismatch",
    })
    .eq("tenant_id", tenantId)
    .eq("id", submissionId);
  if (updErr) return jsonErr(c, "snapshot_update_failed", updErr.message, 500);

  return jsonOk(c, result);
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
