import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2.49.4/cors";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { supplierName, effectiveStartDate, effectiveEndDate, listName, sourceFileUrl, sourceFileName, rows, companyId, replaceExisting } = body;

    if (!supplierName || !effectiveStartDate || !listName || !rows?.length || !companyId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Normalize supplier name
    const { data: normResult } = await admin.rpc("normalize_supplier_name", { input: supplierName });
    const normalizedName = normResult || supplierName.toLowerCase().trim();

    // Find or create supplier
    let { data: supplier } = await admin.from("material_suppliers")
      .select("id").eq("company_id", companyId).eq("normalized_name", normalizedName).maybeSingle();

    if (!supplier) {
      const { data: newSupplier, error: createErr } = await admin.from("material_suppliers")
        .insert({ company_id: companyId, supplier_name: supplierName, normalized_name: normalizedName })
        .select("id").single();
      if (createErr) throw createErr;
      supplier = newSupplier;
    }

    // If replaceExisting, close old active price lists
    if (replaceExisting) {
      const dayBefore = new Date(effectiveStartDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      await admin.from("supplier_price_lists")
        .update({ status: "replaced", effective_end_date: dayBefore.toISOString().split("T")[0] })
        .eq("company_id", companyId).eq("supplier_id", supplier.id).eq("status", "active");
    }

    // Create price list
    const { data: priceList, error: plErr } = await admin.from("supplier_price_lists").insert({
      company_id: companyId,
      supplier_id: supplier.id,
      list_name: listName,
      source_file_url: sourceFileUrl || null,
      source_file_name: sourceFileName || null,
      imported_by: user.id,
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate || null,
      status: "active",
      raw_import_json: { rowCount: rows.length },
    }).select("id").single();
    if (plErr) throw plErr;

    // Insert items
    let imported = 0;
    const failures: { row: number; error: string }[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.description || !r.unitOfMeasure || r.agreedUnitPrice == null) {
        failures.push({ row: i, error: "Missing description, UOM, or price" });
        continue;
      }
      const { data: normDesc } = await admin.rpc("normalize_material_description", { input: r.description });

      const { error: insErr } = await admin.from("supplier_price_list_items").insert({
        company_id: companyId,
        supplier_id: supplier.id,
        price_list_id: priceList.id,
        supplier_sku: r.supplierSku || null,
        manufacturer_sku: r.manufacturerSku || null,
        item_description: r.description,
        normalized_description: normDesc || r.description.toLowerCase(),
        category: r.category || null,
        brand: r.brand || null,
        material_type: r.materialType || null,
        unit_of_measure: r.unitOfMeasure,
        agreed_unit_price: r.agreedUnitPrice,
      });
      if (insErr) {
        failures.push({ row: i, error: insErr.message });
      } else {
        imported++;
      }
    }

    // Log event
    await admin.from("material_price_audit_events").insert({
      company_id: companyId,
      supplier_id: supplier.id,
      event_type: "price_list_imported",
      event_message: `Imported ${imported} items for ${supplierName}. ${failures.length} failures.`,
      created_by: user.id,
      metadata: { price_list_id: priceList.id, imported, failures: failures.length },
    });

    return new Response(JSON.stringify({
      success: true, priceListId: priceList.id, supplierId: supplier.id,
      imported, failures, warnings,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
