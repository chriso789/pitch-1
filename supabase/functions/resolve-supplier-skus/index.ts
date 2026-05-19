// Resolves a vendor SKU for each line item against the multi-supplier
// vendor_products map. Used by Push-to-Supplier and the SKU mapping UI.
//
// Input:
//   {
//     tenant_id: uuid,
//     supplier_key: 'srs' | 'abc' | 'qxo',
//     items: [{ key?: string, product_id?: uuid, name: string, description?: string }]
//   }
//
// Output:
//   {
//     vendor_id: uuid | null,
//     items: [{
//       key, name,
//       vendor_sku: string | null,
//       product_id: uuid | null,
//       matched_via: 'product_id' | 'vendor_sku_exact' | 'product_name' | 'invoice_rule' | 'none',
//       confidence: number
//     }]
//   }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SupplierKey = "srs" | "abc" | "qxo";

interface InItem {
  key?: string;
  product_id?: string | null;
  name: string;
  description?: string | null;
}

function normalize(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  return inter / (A.size + B.size - inter);
}

async function findVendorId(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  supplierKey: SupplierKey,
): Promise<string | null> {
  const patterns: Record<SupplierKey, string[]> = {
    srs: ["srs", "srs distribution"],
    abc: ["abc", "abc supply"],
    qxo: ["qxo", "beacon", "qxo / beacon"],
  };
  const candidates = patterns[supplierKey];
  const { data } = await client
    .from("vendors")
    .select("id, name")
    .eq("tenant_id", tenantId);
  if (!data?.length) return null;
  for (const v of data) {
    const n = (v.name || "").toLowerCase();
    if (candidates.some((c) => n.includes(c))) return v.id;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tenant_id, supplier_key, items } = await req.json();
    if (!tenant_id || !supplier_key || !Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: "tenant_id, supplier_key and items[] are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const vendorId = await findVendorId(client, tenant_id, supplier_key as SupplierKey);

    if (!vendorId) {
      return new Response(
        JSON.stringify({
          vendor_id: null,
          items: (items as InItem[]).map((it) => ({
            key: it.key ?? it.name,
            name: it.name,
            vendor_sku: null,
            product_id: it.product_id ?? null,
            matched_via: "none",
            confidence: 0,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pre-load all vendor_products + products for this tenant/vendor (cheap, tenant-scoped).
    const [vpRes, prodRes] = await Promise.all([
      client
        .from("vendor_products")
        .select("product_id, vendor_sku, vendor_product_name, confidence, auto_matched")
        .eq("tenant_id", tenant_id)
        .eq("vendor_id", vendorId)
        .eq("is_active", true),
      client
        .from("products")
        .select("id, name, description")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true),
    ]);

    const vpByProduct = new Map<string, { vendor_sku: string | null; confidence: number | null }>();
    (vpRes.data || []).forEach((r) => {
      if (r.product_id) vpByProduct.set(r.product_id, { vendor_sku: r.vendor_sku, confidence: r.confidence });
    });

    const products = (prodRes.data || []).map((p) => ({
      id: p.id,
      name: p.name || "",
      normalized: normalize(`${p.name || ""} ${p.description || ""}`),
    }));

    const resolved = (items as InItem[]).map((it) => {
      const norm = normalize(`${it.name} ${it.description || ""}`);

      // 1. Direct product_id hit
      if (it.product_id && vpByProduct.has(it.product_id)) {
        const hit = vpByProduct.get(it.product_id)!;
        if (hit.vendor_sku) {
          return {
            key: it.key ?? it.name,
            name: it.name,
            vendor_sku: hit.vendor_sku,
            product_id: it.product_id,
            matched_via: "product_id",
            confidence: hit.confidence ?? 1,
          };
        }
      }

      // 2. Fuzzy product name match → look up vendor_products
      let bestProduct: { id: string; score: number } | null = null;
      for (const p of products) {
        const s = jaccard(norm, p.normalized);
        if (s > (bestProduct?.score ?? 0)) bestProduct = { id: p.id, score: s };
      }
      if (bestProduct && bestProduct.score >= 0.5) {
        const hit = vpByProduct.get(bestProduct.id);
        if (hit?.vendor_sku) {
          return {
            key: it.key ?? it.name,
            name: it.name,
            vendor_sku: hit.vendor_sku,
            product_id: bestProduct.id,
            matched_via: "product_name",
            confidence: Math.min(0.95, bestProduct.score),
          };
        }
      }

      return {
        key: it.key ?? it.name,
        name: it.name,
        vendor_sku: null,
        product_id: bestProduct?.id ?? it.product_id ?? null,
        matched_via: "none",
        confidence: 0,
      };
    });

    return new Response(
      JSON.stringify({ vendor_id: vendorId, items: resolved }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
