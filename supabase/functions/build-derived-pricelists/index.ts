// Aggregates the lowest unit price ever observed for each line item across all
// invoices, grouped by canonical supplier name. Used as a fallback "shadow"
// price list so the audit engine can flag suppliers that charged more than the
// cheapest price seen for the same item — even when the supplier has no
// official uploaded pricelist.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function canonVendor(raw: string | null | undefined): { key: string; display: string } {
  const v = (raw || "").trim();
  if (!v) return { key: "__unknown__", display: "Unknown vendor" };
  if (/^abc\b|abc supply/i.test(v)) return { key: "abc-supply", display: "ABC Supply" };
  if (/^srs\b|srs building|suncoast roofers/i.test(v)) return { key: "srs", display: "SRS" };
  if (/standing metal/i.test(v)) return { key: "standing-metals", display: "Standing Metals" };
  if (/dynamic metal/i.test(v)) return { key: "dynamic-metals", display: "Dynamic Metals" };
  if (/premier metal/i.test(v)) return { key: "premier-metal", display: "Premier Metal Roof Mfg" };
  if (/\bqxo\b/i.test(v)) return { key: "qxo", display: "QXO" };
  if (/beacon/i.test(v)) return { key: "beacon", display: "Beacon" };
  if (/home depot/i.test(v)) return { key: "home-depot", display: "Home Depot" };
  return { key: v.toLowerCase(), display: v };
}

function normalize(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { tenantId } = await req.json().catch(() => ({}));
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenantId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map supplier_name → supplier_id (best effort, by canon key)
    const { data: suppliers } = await supabase
      .from("material_suppliers")
      .select("id, supplier_name, aliases")
      .eq("company_id", tenantId);
    const supplierByCanon = new Map<string, string>();
    (suppliers || []).forEach((s: any) => {
      supplierByCanon.set(canonVendor(s.supplier_name).key, s.id);
      (s.aliases || []).forEach((a: string) => supplierByCanon.set(canonVendor(a).key, s.id));
    });

    // Pull all line items for this tenant (paged)
    type Row = {
      key: string;
      display: string;
      sku: string | null;
      norm: string;
      desc: string;
      uom: string | null;
      prices: number[];
      invoiceIds: Set<string>;
      lowestInvoiceId: string;
      lastSeen: string | null;
    };
    const buckets = new Map<string, Row>();

    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("project_cost_invoice_line_items")
        .select("invoice_id, vendor_name, description, normalized_description, sku, unit_of_measure, unit_price, quantity, line_total, created_at")
        .eq("tenant_id", tenantId)
        .range(from, from + 999);
      if (error) throw error;
      const batch = data || [];
      if (!batch.length) break;

      for (const r of batch as any[]) {
        const vendor = r.vendor_name;
        if (!vendor) continue;
        const qty = Number(r.quantity || 0);
        let unit = Number(r.unit_price || 0);
        if (!unit && qty > 0 && r.line_total) unit = Number(r.line_total) / qty;
        if (!Number.isFinite(unit) || unit <= 0) continue;
        const desc = (r.description || "").trim();
        const norm = r.normalized_description || normalize(desc);
        if (!norm || norm.length < 3) continue;

        const { key, display } = canonVendor(vendor);
        const sku = (r.sku || "").trim() || null;
        const bucketKey = `${key}::${sku || ""}::${norm}`;
        let bucket = buckets.get(bucketKey);
        if (!bucket) {
          bucket = {
            key, display, sku, norm, desc, uom: r.unit_of_measure || null,
            prices: [], invoiceIds: new Set(), lowestInvoiceId: r.invoice_id,
            lastSeen: r.created_at,
          };
          buckets.set(bucketKey, bucket);
        }
        bucket.prices.push(unit);
        if (r.invoice_id) bucket.invoiceIds.add(r.invoice_id);
        if (unit <= Math.min(...bucket.prices)) bucket.lowestInvoiceId = r.invoice_id;
        if (r.created_at && (!bucket.lastSeen || r.created_at > bucket.lastSeen)) bucket.lastSeen = r.created_at;
      }
      if (batch.length < 1000) break;
    }

    // Wipe + upsert per tenant
    await supabase.from("derived_supplier_price_items").delete().eq("tenant_id", tenantId);

    const rows = Array.from(buckets.values()).map((b) => {
      const lo = Math.min(...b.prices);
      const hi = Math.max(...b.prices);
      const avg = b.prices.reduce((a, c) => a + c, 0) / b.prices.length;
      return {
        tenant_id: tenantId,
        supplier_id: supplierByCanon.get(b.key) || null,
        supplier_name_canonical: b.key,
        supplier_name_display: b.display,
        sku: b.sku,
        normalized_description: b.norm,
        item_description: b.desc || b.norm,
        unit_of_measure: b.uom,
        lowest_unit_price: Number(lo.toFixed(4)),
        highest_unit_price: Number(hi.toFixed(4)),
        avg_unit_price: Number(avg.toFixed(4)),
        sample_count: b.prices.length,
        source_invoice_count: b.invoiceIds.size,
        lowest_source_invoice_id: b.lowestInvoiceId || null,
        last_seen_invoice_date: b.lastSeen ? b.lastSeen.split("T")[0] : null,
      };
    });

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("derived_supplier_price_items").insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }

    // Per-supplier summary
    const bySupplier = new Map<string, { display: string; items: number; avg_low: number }>();
    rows.forEach((r) => {
      const cur = bySupplier.get(r.supplier_name_canonical) || { display: r.supplier_name_display, items: 0, avg_low: 0 };
      cur.items += 1;
      cur.avg_low += r.lowest_unit_price;
      bySupplier.set(r.supplier_name_canonical, cur);
    });
    const summary = Array.from(bySupplier.entries()).map(([k, v]) => ({
      supplier_key: k,
      supplier: v.display,
      items: v.items,
      avg_lowest_price: Number((v.avg_low / Math.max(v.items, 1)).toFixed(2)),
    })).sort((a, b) => b.items - a.items);

    return new Response(JSON.stringify({
      success: true,
      tenant_id: tenantId,
      suppliers: summary.length,
      items: inserted,
      summary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
