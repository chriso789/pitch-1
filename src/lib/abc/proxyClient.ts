// Thin typed wrappers around the production `abc-api-proxy` edge function.
// The older `src/lib/abc/abcApi.ts` still points at the typed `abc-api` stub
// (which always returns `price_pending: true`) — never use that for real
// catalog/pricing calls. Everything the Verify Pricing screen and the
// FindAbcMatchDialog need lives here.

import { supabase } from '@/integrations/supabase/client';

export interface AbcCatalogSearchResultChild {
  itemNumber: string;
  description: string | null;
  colorName: string | null;
  colorCode: string | null;
  familyId: string | null;
  familyName: string | null;
  manufacturer: string | null;
  validUoms: string[];
  defaultUom: string | null;
  branchAvailability: Array<{ branchNumber: string; available: boolean }>;
  isActive: boolean;
  raw: any;
}

export interface AbcCatalogSearchResult {
  success: boolean;
  environment: string;
  status: number;
  error_code?: string | null;
  raw: any;
  children: AbcCatalogSearchResultChild[];
  wafBlocked: boolean;
}

function normalizeChild(raw: any): AbcCatalogSearchResultChild {
  const uomList: string[] = [];
  const variations = raw?.variations || raw?.uoms || raw?.unitsOfMeasure || [];
  for (const v of Array.isArray(variations) ? variations : []) {
    const code = v?.unitOfMeasure || v?.uom || v?.code;
    if (code && !uomList.includes(String(code))) uomList.push(String(code));
  }
  const branches: Array<{ branchNumber: string; available: boolean }> = [];
  const rawBranches = raw?.branches || raw?.branchAvailability || [];
  for (const b of Array.isArray(rawBranches) ? rawBranches : []) {
    const num = b?.branchNumber || b?.branch || b?.number;
    if (!num) continue;
    branches.push({
      branchNumber: String(num),
      available: b?.available !== false && b?.status !== 'unavailable',
    });
  }
  return {
    itemNumber: String(raw?.itemNumber || raw?.item_number || raw?.id || '').trim(),
    description: raw?.description ?? raw?.itemDescription ?? null,
    colorName: raw?.colorName ?? raw?.color?.name ?? raw?.color ?? null,
    colorCode: raw?.colorCode ?? raw?.color?.code ?? null,
    familyId: raw?.familyId ?? raw?.family?.id ?? null,
    familyName: raw?.familyName ?? raw?.family?.name ?? null,
    manufacturer: raw?.manufacturer ?? raw?.brand ?? null,
    validUoms: uomList,
    defaultUom: raw?.defaultUnitOfMeasure ?? raw?.defaultUom ?? uomList[0] ?? null,
    branchAvailability: branches,
    isActive: raw?.isActive !== false && raw?.status !== 'inactive',
    raw,
  };
}

export async function abcSearchProducts(params: {
  query?: string;
  itemNumber?: string;
  branchNumber?: string | null;
  itemsPerPage?: number;
}): Promise<AbcCatalogSearchResult> {
  const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
    body: {
      action: 'search_products',
      query: params.query || undefined,
      itemNumber: params.itemNumber || undefined,
      branchNumber: params.branchNumber || undefined,
      itemsPerPage: params.itemsPerPage ?? 25,
    },
  });
  if (error) {
    return {
      success: false,
      environment: 'unknown',
      status: 0,
      error_code: error.message,
      raw: null,
      children: [],
      wafBlocked: /waf/i.test(error.message || ''),
    };
  }
  const d = data as any;
  const items: any[] = d?.normalized?.items ?? d?.body?.items ?? d?.body?.data?.items ?? [];
  const children = items.flatMap((it: any) => {
    const childArr = it?.familyItems || it?.children || it?.variants;
    if (Array.isArray(childArr) && childArr.length > 0) return childArr.map(normalizeChild);
    return [normalizeChild(it)];
  }).filter((c) => !!c.itemNumber);
  const errText = (d?.error_code || d?.body?.error || '').toString();
  return {
    success: !!d?.success,
    environment: d?.environment ?? 'unknown',
    status: d?.status ?? 0,
    error_code: d?.error_code ?? null,
    raw: d?.body ?? null,
    children,
    wafBlocked: /waf/i.test(errText),
  };
}

export interface AbcPriceLineResult {
  requestLineId: string;
  itemNumber: string;
  returnedItemNumber: string | null;
  returnedUom: string | null;
  unitPrice: number | null;
  lineStatus: string | null;
  lineStatusMessage: string | null;
}

export interface AbcPriceItemsResult {
  success: boolean;
  status: number;
  environment: string;
  error_code?: string | null;
  errorSummary?: string | null;
  wafBlocked: boolean;
  lines: AbcPriceLineResult[];
  raw: any;
}

export async function abcPriceItems(params: {
  shipToNumber: string;
  branchNumber: string;
  purpose: 'estimating' | 'quoting' | 'ordering';
  lines: Array<{ id?: string; itemNumber: string; quantity: number; uom: string }>;
}): Promise<AbcPriceItemsResult> {
  const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
    body: {
      action: 'price_items',
      purpose: params.purpose,
      shipToNumber: params.shipToNumber,
      branchNumber: params.branchNumber,
      lines: params.lines.map((l) => ({
        id: l.id,
        itemNumber: l.itemNumber,
        quantity: l.quantity,
        unitOfMeasure: l.uom,
      })),
    },
  });
  if (error) {
    return {
      success: false,
      status: 0,
      environment: 'unknown',
      error_code: error.message,
      errorSummary: error.message,
      wafBlocked: /waf/i.test(error.message || ''),
      lines: [],
      raw: null,
    };
  }
  const d = data as any;
  const parsed = d?.parsed || {};
  const lines: AbcPriceLineResult[] = (parsed?.lines || []).map((l: any) => ({
    requestLineId: String(l?.requestLineId ?? l?.id ?? ''),
    itemNumber: String(l?.requestedItemNumber ?? l?.itemNumber ?? ''),
    returnedItemNumber: l?.returnedItemNumber ?? null,
    returnedUom: l?.returnedUom ?? null,
    unitPrice: typeof l?.unitPrice === 'number' ? l.unitPrice : null,
    lineStatus: l?.status ?? l?.lineStatus ?? null,
    lineStatusMessage: l?.lineStatusMessage ?? l?.message ?? null,
  }));
  const err = (d?.error_code || parsed?.errorSummary || '').toString();
  return {
    success: !!d?.success,
    status: d?.status ?? 0,
    environment: d?.environment ?? 'unknown',
    error_code: d?.error_code ?? null,
    errorSummary: parsed?.errorSummary ?? null,
    wafBlocked: /waf/i.test(err),
    lines,
    raw: d?.body ?? null,
  };
}

export async function abcApproveMapping(row: {
  tenantId: string;
  templateItemId: string;
  itemNumber: string;
  itemDescription: string | null;
  familyId: string | null;
  familyName: string | null;
  colorName: string | null;
  colorCode: string | null;
  validUoms: string[];
  selectedUom: string;
  branchNumber: string;
  shipToNumber: string;
  rawCatalogPayload: any;
  approvedBy: string | null;
}) {
  return supabase
    .from('template_item_supplier_mappings')
    .upsert(
      {
        tenant_id: row.tenantId,
        template_item_id: row.templateItemId,
        supplier: 'abc',
        supplier_item_number: row.itemNumber,
        supplier_item_description: row.itemDescription,
        supplier_description: row.itemDescription,
        color_name: row.colorName,
        valid_uoms: row.validUoms,
        default_uom: row.selectedUom,
        uom: row.selectedUom,
        branch_scope: [row.branchNumber],
        ship_to_scope: [row.shipToNumber],
        raw_catalog_payload: row.rawCatalogPayload,
        mapping_status: 'approved',
        review_state: 'approved',
        match_source: 'user_confirmed',
        approved_at: new Date().toISOString(),
        approved_by: row.approvedBy,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: 'template_item_id,supplier' },
    );
}
