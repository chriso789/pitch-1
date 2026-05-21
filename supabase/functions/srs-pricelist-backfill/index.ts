// SRS Pricelist Backfill
// ----------------------
// Identifies supplier_price_list_items whose `agreed_unit_price` equals a
// `charged_unit_price` from `material_invoice_audit_lines` for the same item
// (i.e. the pricelist was seeded FROM the suspect invoice instead of from
// the SRS catalog). For each item with a usable `supplier_sku`, fetches the
// real SRS catalog price via the srs-api-proxy `get_pricing` action.
//
// Actions:
//   - `preview` → returns suspect items with proposed SRS price + delta. No writes.
//   - `apply`   → updates `agreed_unit_price` and writes a
//                 `material_price_audit_events` row for every changed item.
//
// Auth: requires a logged-in user with role
// master | owner | corporate | office_admin | regional_manager | sales_manager.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_ROLES = [
  "master", "owner", "corporate", "office_admin",
  "regional_manager", "sales_manager",
];

const BATCH_SIZE = 25;

type SuspectItem = {
  price_list_item_id: string;
  supplier_id: string;
  supplier_sku: string;
  item_description: string | null;
  unit_of_measure: string | null;
  current_agreed_price: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "missing bearer token" });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: "invalid token" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "preview");
    const tenantId = String(body.tenant_id || "").trim();
    const limit = Math.min(Math.max(Number(body.limit ?? 200), 1), 1000);
    const dryRun = action !== "apply";

    if (!tenantId) return json(400, { error: "tenant_id required" });
    if (!["preview", "apply"].includes(action)) {
      return json(400, { error: "action must be preview|apply" });
    }

    // Authorize: at least one allowed role.
    let allowed = false;
    for (const role of ALLOWED_ROLES) {
      const { data: ok } = await admin.rpc("has_role", { _user_id: user.id, _role: role });
      if (ok === true) { allowed = true; break; }
    }
    if (!allowed) return json(403, { error: "insufficient role" });

    // Load SRS connection for tenant (need default branch + JAN).
    const { data: conn, error: connErr } = await admin
      .from("srs_connections")
      .select("id, default_branch_code, job_account_number, customer_code")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (connErr) return json(500, { error: connErr.message });
    if (!conn) return json(412, { error: "SRS connection not configured for this tenant" });

    const branchCode = String(conn.default_branch_code || "").trim();
    if (!branchCode) return json(412, { error: "default_branch_code missing on srs_connections" });

    // ----- Build suspect set ----------------------------------------------
    // Pull all audit lines + price list items for the tenant and compute the
    // intersection in JS (works within RLS service-role context, avoids
    // 1000-row PostgREST limits).
    const audit: { price_list_item_id: string; charged_unit_price: number }[] = [];
    {
      const STEP = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from("material_invoice_audit_lines")
          .select("price_list_item_id, charged_unit_price")
          .eq("company_id", tenantId)
          .not("price_list_item_id", "is", null)
          .not("charged_unit_price", "is", null)
          .range(from, from + STEP - 1);
        if (error) return json(500, { error: error.message });
        if (!data || data.length === 0) break;
        for (const r of data) {
          if (r.price_list_item_id != null && r.charged_unit_price != null) {
            audit.push({
              price_list_item_id: r.price_list_item_id as string,
              charged_unit_price: Number(r.charged_unit_price),
            });
          }
        }
        if (data.length < STEP) break;
        from += STEP;
      }
    }
    const chargedByItem = new Map<string, Set<string>>();
    for (const a of audit) {
      const key = a.charged_unit_price.toFixed(4);
      if (!chargedByItem.has(a.price_list_item_id)) {
        chargedByItem.set(a.price_list_item_id, new Set());
      }
      chargedByItem.get(a.price_list_item_id)!.add(key);
    }

    const ids = [...chargedByItem.keys()];
    if (ids.length === 0) {
      return json(200, {
        action, dry_run: dryRun, tenant_id: tenantId,
        suspect_count: 0, updates: [], skipped: [], applied: 0,
      });
    }

    // Fetch matching pricelist items (chunked IN).
    const items: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data, error } = await admin
        .from("supplier_price_list_items")
        .select("id, company_id, supplier_id, supplier_sku, manufacturer_sku, item_description, unit_of_measure, agreed_unit_price")
        .eq("company_id", tenantId)
        .in("id", slice);
      if (error) return json(500, { error: error.message });
      if (data) items.push(...data);
    }

    const suspect: SuspectItem[] = [];
    const skippedNoSku: any[] = [];
    for (const it of items) {
      const charged = chargedByItem.get(it.id);
      if (!charged) continue;
      const matches = charged.has(Number(it.agreed_unit_price).toFixed(4));
      if (!matches) continue;
      const sku = String(it.supplier_sku || "").trim();
      if (!sku) {
        skippedNoSku.push({
          price_list_item_id: it.id,
          item_description: it.item_description,
          reason: "no_supplier_sku",
        });
        continue;
      }
      suspect.push({
        price_list_item_id: it.id,
        supplier_id: it.supplier_id,
        supplier_sku: sku,
        item_description: it.item_description,
        unit_of_measure: it.unit_of_measure,
        current_agreed_price: Number(it.agreed_unit_price),
      });
    }

    // Cap per call so the function always finishes in <30s.
    const work = suspect.slice(0, limit);

    // ----- Fetch SRS pricing via srs-api-proxy in batches -----------------
    const priceBySku = new Map<string, number>();
    const fetchErrors: { skus: string[]; error: string }[] = [];

    for (let i = 0; i < work.length; i += BATCH_SIZE) {
      const batch = work.slice(i, i + BATCH_SIZE);
      const productList = batch.map((b) => ({
        productNumber: b.supplier_sku,
        quantity: 1,
        uom: (b.unit_of_measure || "EA").toUpperCase(),
      }));

      const proxyResp = await fetch(`${SUPABASE_URL}/functions/v1/srs-api-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader, // pass caller's JWT for audit attribution
          "apikey": ANON_KEY,
        },
        body: JSON.stringify({
          action: "get_pricing",
          tenant_id: tenantId,
          branch_code: branchCode,
          job_account_number: conn.job_account_number,
          product_list: productList,
        }),
      });

      if (!proxyResp.ok) {
        const txt = await proxyResp.text();
        fetchErrors.push({ skus: batch.map((b) => b.supplier_sku), error: `proxy ${proxyResp.status}: ${txt.slice(0, 300)}` });
        continue;
      }

      const payload = await proxyResp.json().catch(() => null) as any;
      const lines = payload?.pricing?.productList
        ?? payload?.pricing?.products
        ?? payload?.pricing?.lineItems
        ?? payload?.pricing?.data
        ?? [];
      if (!Array.isArray(lines)) continue;

      for (const ln of lines) {
        const sku = String(
          ln.productNumber ?? ln.productSku ?? ln.sku ?? ln.product_number ?? "",
        ).trim();
        const price = Number(
          ln.netPrice ?? ln.contractPrice ?? ln.price ?? ln.unitPrice ?? ln.customerPrice ?? NaN,
        );
        if (sku && Number.isFinite(price) && price > 0) {
          priceBySku.set(sku, price);
        }
      }
    }

    // ----- Build update plan ----------------------------------------------
    const updates: any[] = [];
    const skippedNoMatch: any[] = [];
    for (const s of work) {
      const srsPrice = priceBySku.get(s.supplier_sku);
      if (srsPrice == null) {
        skippedNoMatch.push({
          price_list_item_id: s.price_list_item_id,
          supplier_sku: s.supplier_sku,
          item_description: s.item_description,
          reason: "no_srs_price_returned",
        });
        continue;
      }
      const delta = +(srsPrice - s.current_agreed_price).toFixed(4);
      const deltaPct = s.current_agreed_price > 0
        ? +((delta / s.current_agreed_price) * 100).toFixed(2)
        : null;
      updates.push({
        price_list_item_id: s.price_list_item_id,
        supplier_id: s.supplier_id,
        supplier_sku: s.supplier_sku,
        item_description: s.item_description,
        unit_of_measure: s.unit_of_measure,
        current_agreed_price: s.current_agreed_price,
        proposed_srs_price: srsPrice,
        delta,
        delta_pct: deltaPct,
        changes: Math.abs(delta) >= 0.005,
      });
    }

    const changed = updates.filter((u) => u.changes);

    // ----- Apply if requested --------------------------------------------
    let applied = 0;
    if (!dryRun) {
      for (const u of changed) {
        const { error: upErr } = await admin
          .from("supplier_price_list_items")
          .update({
            agreed_unit_price: u.proposed_srs_price,
            updated_at: new Date().toISOString(),
            metadata: { last_backfill: { source: "srs_api", at: new Date().toISOString(), previous: u.current_agreed_price } } as any,
          })
          .eq("id", u.price_list_item_id)
          .eq("company_id", tenantId);
        if (upErr) {
          u.error = upErr.message;
          continue;
        }
        await admin.from("material_price_audit_events").insert({
          company_id: tenantId,
          supplier_id: u.supplier_id,
          event_type: "srs_backfill_apply",
          event_message: `Repriced ${u.supplier_sku} from $${u.current_agreed_price} → $${u.proposed_srs_price} (SRS catalog)`,
          metadata: {
            price_list_item_id: u.price_list_item_id,
            supplier_sku: u.supplier_sku,
            previous: u.current_agreed_price,
            new: u.proposed_srs_price,
            delta: u.delta,
            delta_pct: u.delta_pct,
            branch_code: branchCode,
            source: "srs-pricelist-backfill",
          },
          created_by: user.id,
        });
        applied += 1;
      }
    }

    return json(200, {
      action,
      dry_run: dryRun,
      tenant_id: tenantId,
      branch_code: branchCode,
      suspect_count: suspect.length,
      considered: work.length,
      changed_count: changed.length,
      applied,
      updates,
      skipped: [...skippedNoSku, ...skippedNoMatch],
      fetch_errors: fetchErrors,
    });
  } catch (e) {
    console.error("srs-pricelist-backfill error:", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
