import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeText(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalMaterialKey(raw: string | null | undefined, uom?: string | null): string {
  const normalized = normalizeText(raw)
    .replace(/\bfeet\b|\bfoot\b|\bft\b/g, "")
    .replace(/\binches\b|\binch\b|\bin\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalized}|${String(uom || "").toLowerCase().trim()}`;
}

function mergeSupplierPriceAttributes(attributes: any, supplierId: string, supplierName: string, item: any) {
  const current = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};
  const supplierPrices = current.supplier_prices && typeof current.supplier_prices === "object" ? current.supplier_prices : {};
  const supplierSkus = new Set([...(Array.isArray(current.supplier_skus) ? current.supplier_skus : []), item.supplier_sku].filter(Boolean));
  const manufacturerSkus = new Set([...(Array.isArray(current.manufacturer_skus) ? current.manufacturer_skus : []), item.manufacturer_sku].filter(Boolean));
  return {
    ...current,
    canonical_material_key: canonicalMaterialKey(item.item_description, item.unit_of_measure),
    supplier_skus: Array.from(supplierSkus),
    manufacturer_skus: Array.from(manufacturerSkus),
    supplier_prices: {
      ...supplierPrices,
      [supplierId]: {
        supplier_id: supplierId,
        supplier_name: supplierName,
        price_list_item_id: item.id,
        supplier_sku: item.supplier_sku || null,
        manufacturer_sku: item.manufacturer_sku || null,
        unit_price: Number(item.agreed_unit_price || 0),
        uom: item.unit_of_measure || "EA",
        item_description: item.item_description || null,
        updated_at: new Date().toISOString(),
      },
    },
  };
}

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

      const { data: insertedItem, error: insErr } = await admin.from("supplier_price_list_items").insert({
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
      }).select("id, item_description, normalized_description, supplier_sku, manufacturer_sku, unit_of_measure, agreed_unit_price").single();
      if (insErr) {
        failures.push({ row: i, error: insErr.message });
      } else {
        const materialKey = canonicalMaterialKey(insertedItem.item_description, insertedItem.unit_of_measure);
        const { data: existingMaterials } = await admin
          .from("materials")
          .select("id, name, attributes, base_cost, supplier_sku")
          .eq("tenant_id", companyId)
          .eq("active", true)
          .limit(5000);
        const existing = (existingMaterials || []).find((m: any) =>
          m?.attributes?.canonical_material_key === materialKey || canonicalMaterialKey(m?.name, insertedItem.unit_of_measure) === materialKey
        );
        const attrs = mergeSupplierPriceAttributes(existing?.attributes, supplier.id, supplierName, insertedItem);
        if (existing?.id) {
          await admin.from("materials").update({
            attributes: attrs,
            base_cost: existing.base_cost ?? insertedItem.agreed_unit_price,
            supplier_sku: existing.supplier_sku || insertedItem.supplier_sku || null,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await admin.from("materials").insert({
            tenant_id: companyId,
            code: `MAT-${insertedItem.id}`,
            name: insertedItem.item_description,
            description: insertedItem.item_description,
            uom: insertedItem.unit_of_measure || "EA",
            base_cost: insertedItem.agreed_unit_price,
            supplier_sku: insertedItem.supplier_sku || null,
            attributes: attrs,
            active: true,
          });
        }
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
