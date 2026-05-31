// template-supplier-pricing
// Live SRS / ABC / QXO pricing per estimate_calc_template_items row,
// persisted to template_supplier_prices and scoped to the caller's tenant.
//
// Auth mode: authenticated tenant route.
// Tenant resolution: from JWT → profiles.tenant_id (never trusted from body).
// Supplier credentials are read server-side from per-tenant connection rows
// and never returned to the browser. Only normalized price rows are returned.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Supplier = "srs" | "abc" | "qxo";

interface PriceRow {
  template_item_id: string;
  supplier: Supplier;
  supplier_sku: string | null;
  supplier_item_name: string | null;
  color: string | null;
  branch: string | null;
  account_number: string | null;
  unit_price: number | null;
  uom: string | null;
  availability: string | null;
  status: "ok" | "pending" | "error" | "not_mapped" | "not_connected";
  reason: string | null;
  raw_response: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // Caller-scoped client (verifies JWT, used for tenant lookup under RLS).
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    // Service client for writes (manually tenant-filtered).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Resolve tenant SERVER-SIDE — never from the body.
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = profile?.tenant_id;
    if (!tenantId) return json({ error: "No active tenant for user" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list");
    const templateId = String(body?.template_id || "");
    if (!templateId) return json({ error: "template_id required" }, 400);

    // Verify template ownership.
    const { data: tpl } = await admin
      .from("estimate_calculation_templates")
      .select("id, tenant_id, name")
      .eq("id", templateId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!tpl) return json({ error: "Template not found for tenant" }, 404);

    if (action === "list") {
      const { data: rows } = await admin
        .from("template_supplier_prices")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("template_id", templateId);
      return json({ ok: true, rows: rows || [] });
    }

    if (action !== "refresh") return json({ error: "unknown action" }, 400);

    // Load template items (materials only — labor lines don't have supplier pricing).
    const { data: items } = await admin
      .from("estimate_calc_template_items")
      .select("id, item_name, item_type, unit, sku_pattern, srs_sku, abc_sku, qxo_sku")
      .eq("tenant_id", tenantId)
      .eq("calc_template_id", templateId);
    const materialItems = (items || []).filter((it: any) => it.item_type === "material");

    // Helpers: derive supplier SKUs from explicit columns or sku_pattern prefix.
    const stripPrefix = (s: string | null, prefix: string) =>
      s && s.startsWith(prefix) ? s.slice(prefix.length) : null;
    const skuFor = (it: any, supplier: Supplier): string | null => {
      if (supplier === "srs") {
        return (
          it.srs_sku || stripPrefix(it.sku_pattern, "SRS:") ||
          (it.sku_pattern && !/^(ABC:|QXO:|LABOR-|RENTAL-|DUMPSTER)/.test(it.sku_pattern)
            ? it.sku_pattern
            : null)
        );
      }
      if (supplier === "abc") return it.abc_sku || stripPrefix(it.sku_pattern, "ABC:");
      if (supplier === "qxo") return it.qxo_sku || stripPrefix(it.sku_pattern, "QXO:");
      return null;
    };

    // Load tenant connections.
    const { data: srsConn } = await admin
      .from("srs_connections")
      .select("default_branch_code, job_account_number, customer_code, connection_status, environment")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const { data: abcConns } = await admin
      .from("abc_connections")
      .select("environment, connection_status, account_number, default_branch_code")
      .eq("tenant_id", tenantId);
    const abcConn =
      (abcConns || []).find((r: any) => (r.connection_status || "").toLowerCase() === "connected") ||
      null;
    const { data: abcShipTo } = await admin
      .from("abc_ship_to_accounts")
      .select("ship_to_number, is_default")
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .limit(1);
    const { data: abcBranches } = await admin
      .from("abc_account_branches")
      .select("branch_number, is_default")
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .limit(1);

    const results: PriceRow[] = [];

    // ---------------- SRS ----------------
    const srsItems = materialItems
      .map((it: any) => ({ it, sku: skuFor(it, "srs") }))
      .filter((x: any) => !!x.sku);

    if (!srsConn || (srsConn.connection_status || "").toLowerCase() !== "connected") {
      for (const x of srsItems) {
        results.push(emptyRow(x.it.id, "srs", x.sku, "not_connected", "SRS connection not configured for this tenant"));
      }
    } else if (!srsConn.default_branch_code || !srsConn.job_account_number) {
      for (const x of srsItems) {
        results.push(emptyRow(x.it.id, "srs", x.sku, "pending", "SRS branch / jobAccountNumber not set — run Validate Connection"));
      }
    } else if (srsItems.length) {
      try {
        const productList = srsItems.map((x: any) => ({
          productNumber: x.sku,
          quantity: 1,
          uom: (x.it.unit || "EA").toUpperCase(),
        }));
        const { data: srsRes, error: srsErr } = await admin.functions.invoke("srs-api-proxy", {
          body: {
            action: "get_pricing",
            tenant_id: tenantId,
            branch_code: srsConn.default_branch_code,
            product_list: productList,
            job_account_number: srsConn.job_account_number,
          },
          headers: { Authorization: authHeader },
        });
        if (srsErr) throw srsErr;
        const lines = extractSrsLines(srsRes);
        for (const x of srsItems) {
          const match = lines.find((p: any) =>
            String(p.productNumber || p.product_number || p.sku || "").trim() ===
            String(x.sku).trim()
          );
          if (match) {
            results.push({
              template_item_id: x.it.id,
              supplier: "srs",
              supplier_sku: x.sku,
              supplier_item_name: match.productName || match.product_name || match.description || null,
              color: match.color || match.colorName || null,
              branch: srsConn.default_branch_code,
              account_number: srsConn.customer_code || null,
              unit_price: toNum(match.unitPrice ?? match.price ?? match.unit_price),
              uom: match.uom || x.it.unit || null,
              availability: match.availability || null,
              status: toNum(match.unitPrice ?? match.price ?? match.unit_price) != null ? "ok" : "pending",
              reason: match.message || null,
              raw_response: match,
            });
          } else {
            results.push(emptyRow(x.it.id, "srs", x.sku, "not_mapped", "SRS did not return a line for this SKU"));
          }
        }
      } catch (e: any) {
        for (const x of srsItems) {
          results.push(emptyRow(x.it.id, "srs", x.sku, "error", e?.message || "SRS pricing call failed"));
        }
      }
    }

    // ---------------- ABC ----------------
    const abcItems = materialItems
      .map((it: any) => ({ it, sku: skuFor(it, "abc") }))
      .filter((x: any) => !!x.sku);

    if (!abcConn) {
      for (const x of abcItems) {
        results.push(emptyRow(x.it.id, "abc", x.sku, "not_connected", "ABC Supply connection not configured"));
      }
    } else {
      const shipTo = abcShipTo?.[0]?.ship_to_number || abcConn.account_number || null;
      const branchNumber = abcBranches?.[0]?.branch_number || abcConn.default_branch_code || null;
      if (!shipTo || !branchNumber) {
        for (const x of abcItems) {
          results.push(emptyRow(x.it.id, "abc", x.sku, "pending", "ABC ship-to / branch not synced — open ABC settings"));
        }
      } else if (abcItems.length) {
        try {
          const lines = abcItems.map((x: any, i: number) => ({
            itemNumber: x.sku,
            quantity: 1,
            unitOfMeasure: (x.it.unit || "EA").toUpperCase(),
          }));
          const { data: abcRes, error: abcErr } = await admin.functions.invoke("abc-api-proxy", {
            body: {
              action: "price_items",
              tenant_id: tenantId,
              shipToNumber: shipTo,
              branchNumber,
              purpose: "estimating",
              lines,
            },
            headers: { Authorization: authHeader },
          });
          if (abcErr) throw abcErr;
          const abcLines = extractAbcLines(abcRes);
          for (const x of abcItems) {
            const m = abcLines.find((p: any) =>
              String(p.itemNumber || p.item_number || "").trim() === String(x.sku).trim()
            );
            if (m) {
              results.push({
                template_item_id: x.it.id,
                supplier: "abc",
                supplier_sku: x.sku,
                supplier_item_name: m.itemDescription || m.description || null,
                color: m.color || null,
                branch: branchNumber,
                account_number: shipTo,
                unit_price: toNum(m.unitPrice ?? m.price ?? m.netPrice),
                uom: m.uom || m.unitOfMeasure || x.it.unit || null,
                availability: m.availability || null,
                status: toNum(m.unitPrice ?? m.price ?? m.netPrice) != null ? "ok" : "pending",
                reason: m.message || null,
                raw_response: m,
              });
            } else {
              results.push(emptyRow(x.it.id, "abc", x.sku, "not_mapped", "ABC did not return a line for this SKU"));
            }
          }
        } catch (e: any) {
          for (const x of abcItems) {
            results.push(emptyRow(x.it.id, "abc", x.sku, "error", e?.message || "ABC pricing call failed"));
          }
        }
      }
    }

    // ---------------- QXO ----------------
    const qxoItems = materialItems
      .map((it: any) => ({ it, sku: skuFor(it, "qxo") }))
      .filter((x: any) => !!x.sku);

    const qxoApiKey = Deno.env.get("QXO_API_KEY");
    if (!qxoApiKey) {
      for (const x of qxoItems) {
        results.push(emptyRow(x.it.id, "qxo", x.sku, "not_connected", "QXO API key not configured"));
      }
    } else if (qxoItems.length) {
      try {
        const { data: qxoRes, error: qxoErr } = await admin.functions.invoke("qxo-pricing", {
          body: { skus: qxoItems.map((x: any) => x.sku), refresh: true },
          headers: { Authorization: authHeader },
        });
        if (qxoErr) throw qxoErr;
        const list = (qxoRes?.results || qxoRes?.pricing || []) as any[];
        for (const x of qxoItems) {
          const m = list.find((p: any) => String(p.sku || "").trim() === String(x.sku).trim());
          if (m) {
            results.push({
              template_item_id: x.it.id,
              supplier: "qxo",
              supplier_sku: x.sku,
              supplier_item_name: m.name || m.description || null,
              color: m.color || null,
              branch: m.branch || null,
              account_number: null,
              unit_price: toNum(m.price),
              uom: m.uom || x.it.unit || null,
              availability: typeof m.availability === "boolean" ? (m.availability ? "available" : "out_of_stock") : (m.availability || null),
              status: toNum(m.price) != null ? "ok" : "pending",
              reason: m.message || null,
              raw_response: m,
            });
          } else {
            results.push(emptyRow(x.it.id, "qxo", x.sku, "not_mapped", "QXO did not return a line for this SKU"));
          }
        }
      } catch (e: any) {
        for (const x of qxoItems) {
          results.push(emptyRow(x.it.id, "qxo", x.sku, "error", e?.message || "QXO pricing call failed"));
        }
      }
    }

    // Mark items with no SKU for a given supplier as not_mapped (one row per supplier per item).
    for (const it of materialItems) {
      for (const supplier of ["srs", "abc", "qxo"] as Supplier[]) {
        if (skuFor(it, supplier)) continue;
        if (results.find((r) => r.template_item_id === it.id && r.supplier === supplier)) continue;
        results.push(emptyRow(it.id, supplier, null, "not_mapped", "No SKU mapped for this supplier"));
      }
    }

    // Upsert all results.
    if (results.length) {
      const checkedAt = new Date().toISOString();
      const rows = results.map((r) => ({
        ...r,
        tenant_id: tenantId,
        template_id: templateId,
        checked_at: checkedAt,
      }));
      const { error: upErr } = await admin
        .from("template_supplier_prices")
        .upsert(rows, { onConflict: "tenant_id,template_item_id,supplier" });
      if (upErr) console.error("[template-supplier-pricing] upsert failed", upErr);
    }

    const { data: finalRows } = await admin
      .from("template_supplier_prices")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("template_id", templateId);

    return json({
      ok: true,
      rows: finalRows || [],
      counts: {
        items: materialItems.length,
        srs_priced: results.filter((r) => r.supplier === "srs" && r.status === "ok").length,
        abc_priced: results.filter((r) => r.supplier === "abc" && r.status === "ok").length,
        qxo_priced: results.filter((r) => r.supplier === "qxo" && r.status === "ok").length,
      },
    });
  } catch (e: any) {
    console.error("[template-supplier-pricing]", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
});

function emptyRow(
  template_item_id: string,
  supplier: Supplier,
  supplier_sku: string | null,
  status: PriceRow["status"],
  reason: string,
): PriceRow {
  return {
    template_item_id,
    supplier,
    supplier_sku,
    supplier_item_name: null,
    color: null,
    branch: null,
    account_number: null,
    unit_price: null,
    uom: null,
    availability: null,
    status,
    reason,
    raw_response: null,
  };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractSrsLines(res: any): any[] {
  if (!res) return [];
  const p = res.pricing ?? res;
  if (Array.isArray(p)) return p;
  return p?.productList || p?.products || p?.lines || p?.priceList || [];
}

function extractAbcLines(res: any): any[] {
  if (!res) return [];
  const b = res.body ?? res;
  if (Array.isArray(b)) return b;
  return b?.lines || b?.items || b?.prices || [];
}
