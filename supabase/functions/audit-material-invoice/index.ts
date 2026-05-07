import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2.49.4/cors";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { invoiceDocumentId } = await req.json();
    if (!invoiceDocumentId) return new Response(JSON.stringify({ error: "invoiceDocumentId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load invoice
    const { data: invoice, error: invErr } = await supabase.from("material_invoice_documents").select("*").eq("id", invoiceDocumentId).single();
    if (invErr || !invoice) return new Response(JSON.stringify({ error: "Invoice not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const companyId = invoice.company_id;
    const supplierId = invoice.supplier_id;

    if (!supplierId) {
      await supabase.from("material_invoice_documents").update({ audit_status: "needs_review" }).eq("id", invoiceDocumentId);
      return new Response(JSON.stringify({ error: "No supplier linked to invoice. Cannot audit." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get active price list
    const invoiceDate = invoice.invoice_date || new Date().toISOString().split("T")[0];
    const { data: priceListId } = await supabase.rpc("get_active_supplier_price_list", {
      p_company_id: companyId, p_supplier_id: supplierId, p_invoice_date: invoiceDate
    });

    // Load price list items if available
    let priceListItems: any[] = [];
    if (priceListId) {
      const { data } = await supabase.from("supplier_price_list_items")
        .select("*").eq("price_list_id", priceListId).eq("supplier_id", supplierId);
      priceListItems = data || [];
    }

    // Load match rules for this supplier
    const { data: matchRules } = await supabase.from("material_item_match_rules")
      .select("*").eq("company_id", companyId).eq("supplier_id", supplierId);

    // Load invoice lines
    const { data: lines } = await supabase.from("material_invoice_line_items")
      .select("*").eq("invoice_document_id", invoiceDocumentId).order("line_number");

    if (!lines?.length) {
      return new Response(JSON.stringify({ error: "No invoice line items found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Audit each line
    const auditLines: any[] = [];
    let matched = 0, unmatched = 0, overcharged = 0, undercharged = 0;
    let totalExpected = 0, totalActual = 0, totalOvercharge = 0, totalUndercharge = 0;

    // Duplicate detection
    const lineSigs = new Map<string, number>();

    for (const line of lines) {
      const sig = `${line.supplier_sku || ""}|${line.normalized_description}|${line.quantity}|${line.charged_unit_price}`;
      lineSigs.set(sig, (lineSigs.get(sig) || 0) + 1);
    }

    for (const line of lines) {
      let matchedItem: any = null;
      let matchType = "unmatched";
      let matchConfidence = 0;

      // 1. Supplier SKU exact
      if (!matchedItem && line.supplier_sku) {
        matchedItem = priceListItems.find(p => p.supplier_sku && p.supplier_sku === line.supplier_sku);
        if (matchedItem) { matchType = "supplier_sku_exact"; matchConfidence = 1.0; }
      }

      // 2. Manufacturer SKU exact
      if (!matchedItem && line.manufacturer_sku) {
        matchedItem = priceListItems.find(p => p.manufacturer_sku && p.manufacturer_sku === line.manufacturer_sku);
        if (matchedItem) { matchType = "manufacturer_sku_exact"; matchConfidence = 0.98; }
      }

      // 3. Manual match rule
      if (!matchedItem && matchRules?.length) {
        const rule = matchRules.find(r => {
          if (r.supplier_sku && r.supplier_sku === line.supplier_sku) return true;
          if (r.manufacturer_sku && r.manufacturer_sku === line.manufacturer_sku) return true;
          if (r.normalized_invoice_description && r.normalized_invoice_description === line.normalized_description) return true;
          return false;
        });
        if (rule) {
          matchedItem = priceListItems.find(p => p.id === rule.price_list_item_id);
          if (matchedItem) { matchType = "manual_rule"; matchConfidence = rule.confidence || 0.95; }
        }
      }

      // 4. Exact normalized description
      if (!matchedItem) {
        matchedItem = priceListItems.find(p => p.normalized_description === line.normalized_description);
        if (matchedItem) { matchType = "fuzzy_description"; matchConfidence = 0.92; }
      }

      // 5. Fuzzy - simple substring match (>= 0.88 simulated)
      if (!matchedItem && line.normalized_description?.length > 5) {
        const words = line.normalized_description.split(" ").filter((w: string) => w.length > 2);
        let bestMatch: any = null;
        let bestScore = 0;
        for (const p of priceListItems) {
          const pWords = p.normalized_description.split(" ").filter((w: string) => w.length > 2);
          const commonWords = words.filter((w: string) => pWords.includes(w));
          const score = commonWords.length / Math.max(words.length, pWords.length);
          if (score > bestScore && score >= 0.6) { bestScore = score; bestMatch = p; }
        }
        if (bestMatch && bestScore >= 0.6) {
          matchedItem = bestMatch;
          matchType = "fuzzy_description";
          matchConfidence = Math.min(bestScore, 0.95);
        }
      }

      // Calculate prices
      let chargedUnit = line.charged_unit_price;
      let chargedExt = line.charged_extended_price;
      const qty = line.quantity || 0;

      if (chargedExt == null && chargedUnit != null) chargedExt = chargedUnit * qty;
      if (chargedUnit == null && chargedExt != null && qty > 0) chargedUnit = chargedExt / qty;

      let agreedUnit: number | null = matchedItem?.agreed_unit_price ?? null;
      let expectedExt: number | null = agreedUnit != null ? agreedUnit * qty : null;
      let unitDiff: number | null = (chargedUnit != null && agreedUnit != null) ? chargedUnit - agreedUnit : null;
      let totalDiff: number | null = (chargedExt != null && expectedExt != null) ? chargedExt - expectedExt : null;

      // Determine discrepancy
      let discrepancyType = "needs_review";
      const sig = `${line.supplier_sku || ""}|${line.normalized_description}|${line.quantity}|${line.charged_unit_price}`;
      const dupCount = lineSigs.get(sig) || 1;

      if (!matchedItem) {
        discrepancyType = priceListId ? "unmatched_item" : "missing_price_list";
        unmatched++;
      } else if (matchedItem && line.unit_of_measure && matchedItem.unit_of_measure &&
                 line.unit_of_measure.toUpperCase() !== matchedItem.unit_of_measure.toUpperCase()) {
        discrepancyType = "uom_mismatch";
        unmatched++;
      } else if (totalDiff != null && totalDiff > 0.01) {
        discrepancyType = "overcharge";
        overcharged++;
        totalOvercharge += totalDiff;
        matched++;
      } else if (totalDiff != null && totalDiff < -0.01) {
        discrepancyType = "undercharge";
        undercharged++;
        totalUndercharge += Math.abs(totalDiff);
        matched++;
      } else if (totalDiff != null) {
        discrepancyType = "no_issue";
        matched++;
      } else {
        discrepancyType = "needs_review";
        unmatched++;
      }

      if (dupCount > 1) discrepancyType = "duplicate_charge_possible";

      if (chargedExt != null) totalActual += Number(chargedExt);
      if (expectedExt != null) totalExpected += Number(expectedExt);

      auditLines.push({
        company_id: companyId,
        invoice_document_id: invoiceDocumentId,
        invoice_line_item_id: line.id,
        supplier_id: supplierId,
        price_list_id: priceListId || null,
        price_list_item_id: matchedItem?.id || null,
        match_type: matchType,
        match_confidence: matchConfidence || null,
        invoice_description: line.item_description,
        agreed_description: matchedItem?.item_description || null,
        supplier_sku: line.supplier_sku || null,
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
        discrepancy_type: discrepancyType,
      });
    }

    const auditStatus = unmatched > 0 ? (matched > 0 ? "partial_match" : "failed") : "audited";

    // Save audit
    const { data: audit, error: auditErr } = await supabase.from("material_invoice_audits").insert({
      company_id: companyId,
      invoice_document_id: invoiceDocumentId,
      supplier_id: supplierId,
      price_list_id: priceListId || null,
      audit_run_by: user.id,
      invoice_date: invoiceDate,
      audit_status: auditStatus,
      total_invoice_lines: lines.length,
      matched_lines: matched,
      unmatched_lines: unmatched,
      overcharged_lines: overcharged,
      undercharged_lines: undercharged,
      total_expected_amount: totalExpected,
      total_actual_amount: totalActual,
      total_overcharge_amount: totalOvercharge,
      total_undercharge_amount: totalUndercharge,
    }).select("id").single();

    if (auditErr) throw auditErr;

    // Save audit lines
    const linesWithAuditId = auditLines.map(l => ({ ...l, audit_id: audit.id }));
    const { error: linesErr } = await supabase.from("material_invoice_audit_lines").insert(linesWithAuditId);
    if (linesErr) throw linesErr;

    // Update invoice status
    await supabase.from("material_invoice_documents").update({ audit_status: auditStatus }).eq("id", invoiceDocumentId);

    // Log event
    await supabase.from("material_price_audit_events").insert({
      company_id: companyId, supplier_id: supplierId, invoice_document_id: invoiceDocumentId, audit_id: audit.id,
      event_type: "audit_completed",
      event_message: `Audit completed: ${matched} matched, ${unmatched} unmatched, $${totalOvercharge.toFixed(2)} overcharge`,
      created_by: user.id,
    });

    return new Response(JSON.stringify({
      success: true, auditId: audit.id, auditStatus, matched, unmatched, overcharged, undercharged,
      totalOvercharge, totalUndercharge, totalExpected, totalActual,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
