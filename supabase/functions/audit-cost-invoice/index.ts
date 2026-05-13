// Audits material project_cost_invoices against active supplier price lists.
// Operates on the live invoice data (project_cost_invoices + project_cost_invoice_line_items),
// resolves vendor → material_supplier via canonical name, fetches the active
// price list, fuzzy-matches every line, and persists results into
// material_invoice_audits + material_invoice_audit_lines.
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

function tokenScore(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 2));
  const B = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((w) => { if (B.has(w)) common++; });
  return common / Math.max(A.size, B.size);
}

function supplierCompareKey(raw: string | null | undefined): string {
  return normalize(raw)
    .replace(/\b(company|co|inc|llc|ltd|corp|corporation|mfg|manufacturing|products|supply|supplies)\b/g, " ")
    .replace(/\bmetals\b/g, "metal")
    .replace(/\s+/g, " ")
    .trim();
}

type SkippedInvoice = {
  invoiceId: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  documentName: string | null;
  reason: string;
};

function parseNoteLineItems(notes: string | null | undefined): any[] {
  if (!notes) return [];
  return notes.split(/\r?\n/).map((raw, idx) => {
    const line = raw.trim();
    if (!line) return null;
    const totalMatch = line.match(/(?:^|\s)[—–-]\s*\$?([0-9,]+(?:\.\d{2})?)\s*$/);
    const qtyMatch = line.match(/(?:^|\s)[—–-]\s*Qty\s*:\s*([0-9,]+(?:\.\d+)?)/i);
    if (!totalMatch && !qtyMatch) return null;
    const lineTotal = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null;
    const qty = qtyMatch ? Number(qtyMatch[1].replace(/,/g, "")) : 1;
    const description = line
      .replace(/\s*[—–-]\s*Qty\s*:\s*[0-9,]+(?:\.\d+)?/i, "")
      .replace(/\s*[—–-]\s*\$?[0-9,]+(?:\.\d{2})?\s*$/, "")
      .trim();
    if (!description || !Number.isFinite(qty) || qty <= 0) return null;
    const sku = description.match(/^([A-Z0-9][A-Z0-9-]{2,})\b/)?.[1] || null;
    return {
      line_number: idx + 1,
      description,
      normalized_description: normalize(description),
      quantity: qty,
      unit_price: lineTotal != null ? Number((lineTotal / qty).toFixed(4)) : null,
      line_total: lineTotal,
      sku,
      unit_of_measure: null,
      raw_json: { source: "invoice_notes_fallback", raw },
    };
  }).filter(Boolean);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = user?.id ?? null;

    const body = await req.json().catch(() => ({}));
    const { tenantId, invoiceId } = body as { tenantId?: string; invoiceId?: string };
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenantId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull supplier directory + their items once
    const { data: suppliers } = await supabase
      .from("material_suppliers")
      .select("id, supplier_name, aliases")
      .eq("company_id", tenantId);

    const supplierByCanon = new Map<string, any>();
    const supplierList = suppliers || [];
    (suppliers || []).forEach((s) => {
      const { key } = canonVendor(s.supplier_name);
      supplierByCanon.set(key, s);
      (s.aliases || []).forEach((a: string) => supplierByCanon.set(canonVendor(a).key, s));
    });

    async function resolveSupplier(invVendor: string | null | undefined) {
      const canon = canonVendor(invVendor);
      const existing = supplierByCanon.get(canon.key);
      if (existing) return existing;

      const invKey = supplierCompareKey(invVendor);
      const fuzzyExisting = invKey
        ? supplierList.find((s: any) => {
            const names = [s.supplier_name, ...(s.aliases || [])];
            return names.some((name) => {
              const supKey = supplierCompareKey(name);
              return supKey && (supKey.includes(invKey) || invKey.includes(supKey) || tokenScore(invKey, supKey) >= 0.6);
            });
          })
        : null;
      if (fuzzyExisting) {
        supplierByCanon.set(canon.key, fuzzyExisting);
        return fuzzyExisting;
      }

      const { data: created, error } = await supabase
        .from("material_suppliers")
        .upsert({
          company_id: tenantId,
          supplier_name: canon.display,
          normalized_name: canon.key,
          status: "active",
        }, { onConflict: "company_id,normalized_name" })
        .select("id, supplier_name, aliases")
        .single();
      if (error || !created) return null;
      supplierByCanon.set(canon.key, created);
      return created;
    }

    // Cache items per supplier
    const itemsCache = new Map<string, { priceListId: string | null; items: any[]; rules: any[] }>();
    async function loadItems(supplierId: string, invoiceDate: string) {
      if (itemsCache.has(supplierId)) return itemsCache.get(supplierId)!;
      const { data: priceListId } = await supabase.rpc("get_active_supplier_price_list", {
        p_company_id: tenantId, p_supplier_id: supplierId, p_invoice_date: invoiceDate,
      }).then((r) => r).catch(() => ({ data: null }));
      let resolvedListId: string | null = priceListId as any;
      if (!resolvedListId) {
        const { data: lists } = await supabase
          .from("supplier_price_lists")
          .select("id")
          .eq("supplier_id", supplierId)
          .order("effective_start_date", { ascending: false, nullsFirst: false })
          .limit(1);
        resolvedListId = lists?.[0]?.id ?? null;
      }
      let items: any[] = [];
      if (resolvedListId) {
        const { data } = await supabase
          .from("supplier_price_list_items")
          .select("id, supplier_sku, manufacturer_sku, item_description, normalized_description, unit_of_measure, agreed_unit_price")
          .eq("price_list_id", resolvedListId);
        items = data || [];
      }
      // Manual mapping rules saved by users for this supplier
      const { data: rules } = await supabase
        .from("material_item_match_rules")
        .select("supplier_sku, manufacturer_sku, normalized_invoice_description, price_list_item_id")
        .eq("company_id", tenantId)
        .eq("supplier_id", supplierId);
      const entry = { priceListId: resolvedListId, items, rules: rules || [] };
      itemsCache.set(supplierId, entry);
      return entry;
    }

    // Fetch target invoices
    let invQ = supabase
      .from("project_cost_invoices")
      .select("id, vendor_name, invoice_number, invoice_date, invoice_amount, notes, project_id, pipeline_entry_id")
      .eq("tenant_id", tenantId)
      .eq("invoice_type", "material");
    if (invoiceId) invQ = invQ.eq("id", invoiceId);
    const { data: invoices, error: invErr } = await invQ;
    if (invErr) throw invErr;

    let auditedCount = 0;
    let totalOvercharge = 0;
    const skipped: SkippedInvoice[] = [];
    const skipInvoice = (inv: any, reason: string) => skipped.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number || null,
      vendorName: inv.vendor_name || null,
      documentName: inv.document_name || null,
      reason,
    });

    for (const inv of invoices || []) {
      const supplier = await resolveSupplier(inv.vendor_name);
      if (!supplier) {
        skipInvoice(inv, `No supplier match for "${inv.vendor_name}"`);
        continue;
      }

      const invoiceDate = inv.invoice_date || new Date().toISOString().split("T")[0];
      const { priceListId, items, rules } = await loadItems(supplier.id, invoiceDate);
      if (!priceListId || !items.length) {
        skipInvoice(inv, `No price list for supplier "${supplier.supplier_name}"`);
        continue;
      }
      const itemsById = new Map(items.map((i) => [i.id, i]));

      const { data: storedLines } = await supabase
        .from("project_cost_invoice_line_items")
        .select("id, line_number, description, normalized_description, quantity, unit_price, line_total, sku, unit_of_measure")
        .eq("invoice_id", inv.id)
        .order("line_number");

      let lines = storedLines || [];
      if (!lines.length) {
        const parsed = parseNoteLineItems((inv as any).notes);
        if (parsed.length) {
          const rows = parsed.map((line) => ({
            tenant_id: tenantId,
            invoice_id: inv.id,
            project_id: inv.project_id || null,
            pipeline_entry_id: inv.pipeline_entry_id || null,
            vendor_name: inv.vendor_name || null,
            ...line,
          }));
          const { data: inserted, error: insertErr } = await supabase
            .from("project_cost_invoice_line_items")
            .insert(rows)
            .select("id, line_number, description, normalized_description, quantity, unit_price, line_total, sku, unit_of_measure")
            .order("line_number");
          if (insertErr) {
            skipInvoice(inv, `Could not save extracted line items: ${insertErr.message}`);
            continue;
          }
          lines = inserted || [];
        }
      }

      if (!lines?.length) {
        skipInvoice(inv, "No line items extracted from upload or invoice notes");
        continue;
      }

      // Wipe any prior audit for this invoice (idempotent re-run)
      await supabase.from("material_invoice_audits")
        .delete()
        .eq("invoice_document_id", inv.id);

      let matched = 0, unmatched = 0, over = 0, under = 0;
      let totExp = 0, totAct = 0, totOver = 0, totUnder = 0;
      const auditLines: any[] = [];

      for (const line of lines) {
        const qty = Number(line.quantity || 0);
        const chargedUnit = Number(line.unit_price ?? 0);
        const chargedExt = Number(line.line_total ?? chargedUnit * qty);
        const desc = line.normalized_description || normalize(line.description);

        // Match: SKU exact > description fuzzy
        let matchedItem: any = null;
        let matchType = "unmatched";
        let matchConfidence = 0;

        // 1. Manual mapping rule (highest priority)
        const ruleHit = (rules || []).find((r: any) => {
          if (line.sku && (r.supplier_sku === line.sku || r.manufacturer_sku === line.sku)) return true;
          if (r.normalized_invoice_description && r.normalized_invoice_description === desc) return true;
          if (r.normalized_invoice_description && desc && desc.includes(r.normalized_invoice_description)) return true;
          if (r.normalized_invoice_description && desc && tokenScore(desc, r.normalized_invoice_description) >= 0.75) return true;
          return false;
        });
        if (ruleHit?.price_list_item_id && itemsById.has(ruleHit.price_list_item_id)) {
          matchedItem = itemsById.get(ruleHit.price_list_item_id);
          matchType = "manual_rule";
          matchConfidence = 1.0;
        }
        // 2. SKU exact
        if (!matchedItem && line.sku) {
          matchedItem = items.find((p) => p.supplier_sku === line.sku || p.manufacturer_sku === line.sku);
          if (matchedItem) { matchType = "sku_exact"; matchConfidence = 1.0; }
        }
        // 3. Fuzzy description
        if (!matchedItem && desc.length > 4) {
          let best: any = null, bestScore = 0;
          for (const p of items) {
            const pDesc = p.normalized_description || normalize(p.item_description);
            const s = tokenScore(desc, pDesc);
            if (s > bestScore) { bestScore = s; best = p; }
          }
          if (best && bestScore >= 0.4) {
            matchedItem = best;
            matchType = "fuzzy_description";
            matchConfidence = Math.min(bestScore, 0.95);
          }
        }

        const agreedUnit = matchedItem?.agreed_unit_price != null ? Number(matchedItem.agreed_unit_price) : null;
        const expectedExt = agreedUnit != null ? agreedUnit * qty : null;
        const unitDiff = agreedUnit != null ? chargedUnit - agreedUnit : null;
        const totalDiff = expectedExt != null ? chargedExt - expectedExt : null;

        let discrepancy = "needs_review";
        if (!matchedItem) { discrepancy = "unmatched_item"; unmatched++; }
        else if (totalDiff != null && totalDiff > 0.01) { discrepancy = "overcharge"; over++; matched++; totOver += totalDiff; }
        else if (totalDiff != null && totalDiff < -0.01) { discrepancy = "undercharge"; under++; matched++; totUnder += Math.abs(totalDiff); }
        else if (totalDiff != null) { discrepancy = "no_issue"; matched++; }
        else { unmatched++; }

        totAct += chargedExt;
        if (expectedExt != null) totExp += expectedExt;

        auditLines.push({
          company_id: tenantId,
          invoice_document_id: inv.id,
          invoice_line_item_id: line.id,
          supplier_id: supplier.id,
          price_list_id: priceListId,
          price_list_item_id: matchedItem?.id || null,
          match_type: matchType,
          match_confidence: matchConfidence || null,
          invoice_description: line.description,
          agreed_description: matchedItem?.item_description || null,
          supplier_sku: line.sku || null,
          agreed_supplier_sku: matchedItem?.supplier_sku || null,
          invoice_uom: line.unit_of_measure || null,
          agreed_uom: matchedItem?.unit_of_measure || null,
          quantity: qty,
          charged_unit_price: chargedUnit,
          agreed_unit_price: agreedUnit,
          charged_extended_price: chargedExt,
          expected_extended_price: expectedExt,
          price_difference_per_unit: unitDiff,
          total_difference: totalDiff,
          discrepancy_type: discrepancy,
          discrepancy_status: discrepancy === "no_issue" ? "resolved" : "open",
        });
      }

      const auditStatus = unmatched === 0 ? "audited" : matched > 0 ? "partial_match" : "needs_review";
      const { data: auditRow, error: aErr } = await supabase
        .from("material_invoice_audits")
        .insert({
          company_id: tenantId,
          invoice_document_id: inv.id,
          supplier_id: supplier.id,
          price_list_id: priceListId,
          audit_run_by: userId,
          invoice_date: invoiceDate,
          audit_status: auditStatus,
          total_invoice_lines: lines.length,
          matched_lines: matched,
          unmatched_lines: unmatched,
          overcharged_lines: over,
          undercharged_lines: under,
          total_expected_amount: totExp,
          total_actual_amount: totAct,
          total_overcharge_amount: totOver,
          total_undercharge_amount: totUnder,
        })
        .select("id")
        .single();
      if (aErr) { skipInvoice(inv, aErr.message); continue; }

      const withId = auditLines.map((l) => ({ ...l, audit_id: auditRow.id }));
      // Insert in chunks
      for (let i = 0; i < withId.length; i += 200) {
        await supabase.from("material_invoice_audit_lines").insert(withId.slice(i, i + 200));
      }

      auditedCount++;
      totalOvercharge += totOver;
    }

    return new Response(JSON.stringify({
      success: true,
      audited: auditedCount,
      total_overcharge: Number(totalOvercharge.toFixed(2)),
      skipped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
