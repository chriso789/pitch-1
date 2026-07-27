// ABC catalog ingest → canonical identity → supplier mapping proposals.
//
// Turns raw ABC Product Search items (live sandbox/production responses) into:
//   1. `abc_catalog_items` cache rows (global, keyed by item_number)
//   2. tenant-scoped canonical identity rows (manufacturer / product line /
//      color / variant)
//   3. `supplier_item_mappings` proposals with mapping_source='api' and
//      approval_state='pending' — nothing auto-approves, so the strict
//      resolver still refuses to order from an unreviewed mapping.
//
// Deliberately does NOT fuzzy match: every mapping carries the exact ABC item
// number, UOM and color returned by ABC, plus the raw payload + fingerprint.

export interface AbcIngestOptions {
  tenantId: string;
  supplierConnectionId?: string | null;
  branchCode?: string | null;
  createdBy?: string | null;
  /** sandbox | staging | production — catalog rows are environment scoped. */
  environment?: string | null;
}


export interface AbcIngestSummary {
  items_seen: number;
  catalog_upserted: number;
  manufacturers_created: number;
  product_lines_created: number;
  colors_created: number;
  variants_created: number;
  mappings_created: number;
  mappings_updated: number;
  skipped: Array<{ itemNumber: string; reason: string }>;
}

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** ABC labels arrive as "GAF Timberline HD  -  003232" — keep the human part. */
function cleanLabel(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return s.replace(/\s*-\s*\d{3,}\s*$/, "").replace(/^0*\d+\s*-\s*/, "").trim() || null;
}

function hierarchy(item: Rec) {
  const pg = (item.hierarchy as Rec | undefined)?.productGroup as Rec | undefined;
  const cat = pg?.category as Rec | undefined;
  const pt = cat?.productType as Rec | undefined;
  const mc = pt?.materialComposition as Rec | undefined;
  const wr = mc?.warranty as Rec | undefined;
  const bl = wr?.brandLine as Rec | undefined;
  return {
    group: cleanLabel(pg?.label ?? pg?.name),
    category: cleanLabel(cat?.label ?? cat?.name),
    productType: cleanLabel(pt?.label ?? pt?.name),
    brandLine: cleanLabel(bl?.label ?? bl?.name),
    brandLineCode: str(bl?.code),
  };
}

/** ABC returns uoms[] with description "costing" | "stocking". */
export function abcUoms(item: Rec): { costing: string | null; stocking: string | null; order: string | null } {
  const list = Array.isArray(item.uoms) ? (item.uoms as Rec[]) : [];
  let costing: string | null = null;
  let stocking: string | null = null;
  for (const u of list) {
    const code = str(u.code)?.toUpperCase() ?? null;
    if (!code) continue;
    const desc = (str(u.description) ?? "").toLowerCase();
    if (desc.includes("costing") && !costing) costing = code;
    if (desc.includes("stocking") && !stocking) stocking = code;
  }
  const first = str(list[0]?.code)?.toUpperCase() ?? null;
  return { costing, stocking, order: stocking ?? costing ?? first };
}

export async function fingerprintItem(item: unknown): Promise<string> {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.keys(v as Rec).sort().reduce((acc: Rec, k) => {
        acc[k] = stable((v as Rec)[k]);
        return acc;
      }, {});
    }
    return v;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stable(item)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ABC returns color families as a parent row with `familyItems[]` children.
 * Each child is its own orderable SKU with its own itemNumber — children NEVER
 * inherit the parent's item number. Hierarchy/UOM metadata may legitimately be
 * absent on a child, so we inherit those descriptive fields only.
 */
export function flattenAbcFamilyItems(rawItems: unknown[]): Rec[] {
  const out: Rec[] = [];
  const seen = new Set<string>();

  const push = (item: Rec, extra: Rec) => {
    const num = str(item.itemNumber) ?? str(item.item_number);
    if (!num) return;
    const key = `${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, ...extra });
  };

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Rec;
    const children = Array.isArray(item.familyItems)
      ? (item.familyItems as unknown[])
      : Array.isArray(item.family_items)
        ? (item.family_items as unknown[])
        : [];

    push(item, { __isFamilyParent: children.length > 0 });

    for (const c of children) {
      if (!c || typeof c !== "object") continue;
      const child = c as Rec;
      push(
        {
          // descriptive inheritance only — identity fields stay the child's own
          hierarchy: child.hierarchy ?? item.hierarchy,
          supplierName: child.supplierName ?? item.supplierName,
          uoms: child.uoms ?? item.uoms,
          familyId: child.familyId ?? item.familyId,
          familyName: child.familyName ?? item.familyName,
          ...child,
        },
        {
          __isFamilyParent: false,
          __parentItemNumber: str(item.itemNumber) ?? str(item.item_number),
        },
      );
    }
  }
  return out;
}

/** Field shingle vs hip-and-ridge vs accessory — never conflate the two. */
export function classifyAbcProduct(
  productType: string | null,
  description: string | null,
): { isHipAndRidge: boolean; isFieldShingle: boolean; isAccessory: boolean } {
  const hay = `${productType ?? ""} ${description ?? ""}`.toLowerCase();
  const isHipAndRidge = /(hip\s*(&|and|\/)?\s*ridge|ridge\s*cap|seal-?a-?ridge|timbertex|z\s*ridge)/.test(hay);
  const isFieldShingle = !isHipAndRidge && /shingle/.test(hay);
  const isAccessory = !isHipAndRidge && !isFieldShingle;
  return { isHipAndRidge, isFieldShingle, isAccessory };
}

function branchNumbersOf(item: Rec): string[] {
  const list = Array.isArray(item.branches) ? (item.branches as Rec[]) : [];
  const nums = list
    .map((b) => str(b.branchNumber) ?? str(b.branch_number) ?? str(b.number))
    .filter((v): v is string => !!v);
  return [...new Set(nums)];
}


export async function ingestAbcCatalogItems(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rawItems: unknown[],
  opts: AbcIngestOptions,
): Promise<AbcIngestSummary> {
  const summary: AbcIngestSummary = {
    items_seen: 0,
    catalog_upserted: 0,
    manufacturers_created: 0,
    product_lines_created: 0,
    colors_created: 0,
    variants_created: 0,
    mappings_created: 0,
    mappings_updated: 0,
    skipped: [],
  };

  const mfrCache = new Map<string, string>();
  const lineCache = new Map<string, string>();
  const colorCache = new Map<string, string>();
  const variantCache = new Map<string, string>();

  // Select-then-insert: several identity tables are guarded by expression
  // unique indexes (COALESCE(...)), which PostgREST upsert cannot target.
  const upsertOne = async (
    table: string,
    row: Rec,
    _onConflict: string,
    matcher: Rec,
  ): Promise<string | null> => {
    const lookup = async () => {
      let q = supabase.from(table).select("id").limit(1);
      for (const [k, v] of Object.entries(matcher)) q = v === null ? q.is(k, null) : q.eq(k, v);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`${table} lookup: ${error.message}`);
      return data?.id ?? null;
    };
    const found = await lookup();
    if (found) return found;
    const { data, error } = await supabase.from(table).insert(row).select("id").maybeSingle();
    if (!error && data?.id) return data.id;
    if (error && !/duplicate key|unique constraint/i.test(error.message ?? "")) {
      throw new Error(`${table}: ${error.message}`);
    }
    return await lookup();
  };


  const environment = (str(opts.environment) ?? "sandbox").toLowerCase();
  const branchNumber = str(opts.branchCode);
  const catalogRows: Rec[] = [];
  const items = flattenAbcFamilyItems(rawItems);

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Rec;
    const itemNumber = str(item.itemNumber) ?? str(item.item_number);
    if (!itemNumber) continue;
    summary.items_seen++;

    const isFamilyParent = item.__isFamilyParent === true;
    const parentItemNumber = str(item.__parentItemNumber);
    if (parentItemNumber) summary.family_children_expanded++;

    const h = hierarchy(item);
    const color = (item.color as Rec | undefined) ?? {};
    const colorName = str(color.name);
    const colorCode = str(color.code);
    const uoms = abcUoms(item);
    const description = str(item.itemDescription) ?? str(item.description) ?? str(item.familyName) ?? itemNumber;
    const cls = classifyAbcProduct(h.productType, description);
    const branchNums = branchNumbersOf(item);
    const branchValidated = branchNumber ? branchNums.includes(branchNumber) : branchNums.length > 0;
    const fingerprint = await fingerprintItem(item);
    const nowIso = new Date().toISOString();

    catalogRows.push({
      tenant_id: opts.tenantId,
      connection_id: opts.supplierConnectionId ?? null,
      environment,
      branch_number: branchNumber,
      branch_numbers: branchNums,
      branch_validated: branchValidated,
      branch_validation_note: branchValidated
        ? null
        : branchNumber
          ? `ABC response did not list branch ${branchNumber} for this item`
          : "no branch selected at ingest time",
      item_number: itemNumber,
      item_description: description,
      family_id: str(item.familyId),
      family_name: str(item.familyName),
      parent_item_number: parentItemNumber,
      is_family_parent: isFamilyParent,
      orderable: !isFamilyParent,
      manufacturer: str(item.supplierName) ?? (h.brandLine ? h.brandLine.split(" ")[0] : null),
      product_line: h.brandLine ?? str(item.familyName),
      product_line_code: h.brandLineCode,
      product_type: h.productType,
      product_category: h.category,
      product_group: h.group,
      is_hip_and_ridge: cls.isHipAndRidge,
      is_field_shingle: cls.isFieldShingle,
      is_accessory: cls.isAccessory,
      color_name: colorName,
      color_code: colorCode,
      uoms: item.uoms ?? null,
      stocking_uom: uoms.stocking,
      costing_uom: uoms.costing,
      dimensions: item.dimensions ?? null,
      specifications: item.specifications ?? null,
      is_active: (str(item.status) ?? "Active").toLowerCase() === "active",
      is_dimensional: item.isDimensional === true,
      catalog_source: "abc_product_search",
      raw_fingerprint: fingerprint,
      synced_at: nowIso,
      raw: item,
      updated_at: nowIso,
    });

    // A family parent is a grouping row, never an orderable SKU: no mapping.
    if (isFamilyParent) {
      summary.skipped.push({ itemNumber, reason: "family_parent_not_orderable" });
      continue;
    }

    const manufacturerName = str(item.supplierName) ?? (h.brandLine ? h.brandLine.split(" ")[0] : null);
    const productLineName = h.brandLine ?? str(item.familyName);
    const variantName = str(item.familyName) ?? description;
    const canonicalUom = uoms.order;



    if (!manufacturerName || !productLineName || !variantName || !canonicalUom) {
      summary.skipped.push({ itemNumber, reason: "missing_canonical_identity_fields" });
      continue;
    }

    // --- manufacturer -------------------------------------------------
    const mKey = manufacturerName.toLowerCase();
    let manufacturerId = mfrCache.get(mKey) ?? null;
    if (!manufacturerId) {
      const before = manufacturerId;
      manufacturerId = await upsertOne(
        "mfr_manufacturers",
        { tenant_id: opts.tenantId, name: manufacturerName, is_active: true },
        "tenant_id,name",
        { tenant_id: opts.tenantId, name: manufacturerName },
      );
      if (!manufacturerId) { summary.skipped.push({ itemNumber, reason: "manufacturer_upsert_failed" }); continue; }
      if (!before) summary.manufacturers_created++;
      mfrCache.set(mKey, manufacturerId);
    }

    // --- product line ---------------------------------------------------
    const lKey = `${manufacturerId}::${productLineName.toLowerCase()}`;
    let productLineId = lineCache.get(lKey) ?? null;
    if (!productLineId) {
      productLineId = await upsertOne(
        "mfr_product_lines",
        {
          tenant_id: opts.tenantId,
          manufacturer_id: manufacturerId,
          name: productLineName,
          code: h.brandLineCode,
          category: h.category,
          is_active: true,
        },
        "tenant_id,manufacturer_id,name",
        { tenant_id: opts.tenantId, manufacturer_id: manufacturerId, name: productLineName },
      );
      if (!productLineId) { summary.skipped.push({ itemNumber, reason: "product_line_upsert_failed" }); continue; }
      summary.product_lines_created++;
      lineCache.set(lKey, productLineId);
    }

    // --- color (optional) -------------------------------------------------
    let colorId: string | null = null;
    if (colorName) {
      const cKey = `${productLineId}::${colorName.toLowerCase()}`;
      colorId = colorCache.get(cKey) ?? null;
      if (!colorId) {
        colorId = await upsertOne(
          "mfr_colors",
          {
            tenant_id: opts.tenantId,
            manufacturer_id: manufacturerId,
            product_line_id: productLineId,
            canonical_name: colorName,
            manufacturer_color_code: colorCode,
            is_active: true,
          },
          "tenant_id,product_line_id,canonical_name",
          { tenant_id: opts.tenantId, product_line_id: productLineId, canonical_name: colorName },
        );
        if (colorId) { summary.colors_created++; colorCache.set(cKey, colorId); }
      }
    }

    // --- variant ----------------------------------------------------------
    const vKey = `${productLineId}::${variantName.toLowerCase()}::${canonicalUom}`;
    let variantId = variantCache.get(vKey) ?? null;
    if (!variantId) {
      variantId = await upsertOne(
        "mfr_product_variants",
        {
          tenant_id: opts.tenantId,
          manufacturer_id: manufacturerId,
          product_line_id: productLineId,
          variant_name: variantName,
          canonical_uom: canonicalUom,
          requires_color: !!colorName,
          is_accessory: false,
          is_active: true,
          attributes: {
            abc_product_type: h.productType,
            abc_category: h.category,
            abc_group: h.group,
            abc_family_id: str(item.familyId),
          },
        },
        "tenant_id,product_line_id,variant_name,canonical_uom",
        {
          tenant_id: opts.tenantId,
          product_line_id: productLineId,
          variant_name: variantName,
          canonical_uom: canonicalUom,
        },
      );
      if (!variantId) { summary.skipped.push({ itemNumber, reason: "variant_upsert_failed" }); continue; }
      summary.variants_created++;
      variantCache.set(vKey, variantId);
    }

    // --- supplier mapping proposal ---------------------------------------
    const fingerprint = await fingerprintItem(item);
    const nowIso = new Date().toISOString();

    let existingQ = supabase
      .from("supplier_item_mappings")
      .select("id, catalog_fingerprint, approval_state")
      .eq("tenant_id", opts.tenantId)
      .eq("supplier", "abc")
      .eq("variant_id", variantId)
      .eq("supplier_uom", canonicalUom)
      .limit(1);
    existingQ = colorId ? existingQ.eq("color_id", colorId) : existingQ.is("color_id", null);
    existingQ = opts.branchCode ? existingQ.eq("branch_code", opts.branchCode) : existingQ.is("branch_code", null);
    const { data: existing } = await existingQ.maybeSingle();

    const base: Rec = {
      supplier_item_number: itemNumber,
      supplier_catalog_item_id: str(item.familyId),
      supplier_description: description,
      supplier_color_name: colorName,
      catalog_fingerprint: fingerprint,
      catalog_payload: item,
      validated_at: nowIso,
      mapping_source: "api",
      status: "active",
      updated_at: nowIso,
    };

    if (existing?.id) {
      if (existing.catalog_fingerprint === fingerprint) continue;
      // Catalog drift: refresh the proof and force re-approval.
      const { error } = await supabase
        .from("supplier_item_mappings")
        .update({ ...base, approval_state: "pending", approved_by: null, approved_at: null })
        .eq("id", existing.id);
      if (error) { summary.skipped.push({ itemNumber, reason: `mapping_update_failed:${error.message}` }); continue; }
      summary.mappings_updated++;
    } else {
      const { error } = await supabase.from("supplier_item_mappings").insert({
        ...base,
        tenant_id: opts.tenantId,
        supplier: "abc",
        supplier_connection_id: opts.supplierConnectionId ?? null,
        branch_code: opts.branchCode ?? null,
        variant_id: variantId,
        color_id: colorId,
        approval_state: "pending",
        effective_from: nowIso,
        created_by: opts.createdBy ?? null,
      });
      if (error) { summary.skipped.push({ itemNumber, reason: `mapping_insert_failed:${error.message}` }); continue; }
      summary.mappings_created++;
    }
  }

  // Catalog cache upsert in chunks (global table, keyed by item_number).
  for (let i = 0; i < catalogRows.length; i += 200) {
    const chunk = catalogRows.slice(i, i + 200);
    const { error } = await supabase.from("abc_catalog_items").upsert(chunk, { onConflict: "item_number" });
    if (!error) summary.catalog_upserted += chunk.length;
  }

  return summary;
}
