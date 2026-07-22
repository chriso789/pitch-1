// Verify Pricing page — the ABC catalog mapping + live pricing surface
// mandated by the ABC Supply integration team.
//
// Contract enforced here (per PR "ABC Catalog Mapping + Color-Specific SKU + Live Pricing UI Fix"):
//   • Internal material codes are NEVER treated as ABC itemNumbers.
//   • Each row shows a specific state (Needs ABC Match / Needs Color /
//     Needs UOM / Needs Branch Verification / Ready to Price / Priced /
//     Zero Price / Unavailable / WAF Blocked / Error) — never generic "Pending".
//   • The mapping grid is ABC-catalog-first: catalog item + color + UOM + live
//     price on the left, tenant internal material match on the right.
//   • "Refresh catalog prices" only submits real ABC Product API itemNumbers.
//   • Every price call goes through `abc-api-proxy` → `price_items` (the
//     production route), never the `abc-api` stub.
//
// SRS and QXO fall back to the older behavior for now — this PR is ABC only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcSetup } from '@/hooks/useAbcSetup';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { useAbcAccounts } from '@/lib/abc/useAbcConnection';
import {
  abcApproveMapping,
  abcPriceItems,
  abcSearchProducts,
  type AbcCatalogSearchResultChild,
} from '@/lib/abc/proxyClient';
import {
  computeAbcRowState,
  statesForPricingResult,
  type AbcMappingRow,
  type AbcRowStateInfo,
} from '@/lib/abc/mappingState';
import FindAbcMatchDialog from '@/components/supplier-verify/abc/FindAbcMatchDialog';
import AbcSetupWizard from '@/components/supplier-pricing/AbcSetupWizard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertCircle, ArrowLeft, RefreshCcw, Search, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';

type SupplierKind = 'abc' | 'srs' | 'qxo';

const SUPPLIER_META: Record<SupplierKind, { label: string; ordersTable: 'abc_orders' | 'srs_orders' | 'qxo_orders' }> = {
  abc: { label: 'ABC Supply', ordersTable: 'abc_orders' },
  srs: { label: 'SRS Distribution', ordersTable: 'srs_orders' },
  qxo: { label: 'QXO / Beacon', ordersTable: 'qxo_orders' },
};

const DEFAULT_ABC_CATALOG_QUERIES = ['shingle', 'underlayment', 'ridge', 'drip edge', 'nail', 'ice water'];

interface AbcRow {
  templateItemId: string;
  internalCode: string;
  materialName: string;
  requestedColor: string | null;
  mapping: AbcMappingRow | null;
}

interface PricingBadge {
  info: AbcRowStateInfo;
  unitPrice?: number | null;
  returnedUom?: string | null;
  checkedAt?: string | null;
}

interface AbcSyncAccountsResponse {
  success?: boolean;
  ship_to_count?: number;
  branch_count?: number;
  ship_to_total_returned?: number;
  ship_to_skipped_no_branches?: number;
  error?: string;
  error_code?: string;
  stage?: string;
}

interface NormalizedSupplierOrder {
  id: string;
  reference: string;
  po: string | null;
  status: string | null;
  total: number | string | null;
  branch: string | null;
  when: string | null;
}

interface TemplateItemRecord {
  id: string;
  item_name: string | null;
  description: string | null;
}

type AbcMappingRecord = AbcMappingRow & { template_item_id: string };

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function numberOrStringValue(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeOrder(supplier: SupplierKind, row: UnknownRecord): NormalizedSupplierOrder {
  if (supplier === 'abc') {
    return {
      id: stringValue(row.id) || `${supplier}-${stringValue(row.order_number) || stringValue(row.confirmation_number) || 'order'}`,
      reference: stringValue(row.order_number ?? row.confirmation_number) || '—',
      po: stringValue(row.purchase_order),
      status: stringValue(row.order_status),
      total: numberOrStringValue(row.total_amount),
      branch: stringValue(row.branch_number),
      when: stringValue(row.ordered_on ?? row.created_at),
    };
  }
  if (supplier === 'srs') {
    return {
      id: stringValue(row.id) || `${supplier}-${stringValue(row.srs_order_id) || stringValue(row.order_number) || 'order'}`,
      reference: stringValue(row.srs_order_id ?? row.order_number) || '—',
      po: stringValue(row.order_number),
      status: stringValue(row.status),
      total: numberOrStringValue(row.total_amount),
      branch: stringValue(row.branch_id ?? row.branch_number),
      when: stringValue(row.submitted_at ?? row.created_at),
    };
  }
  return {
    id: stringValue(row.id) || `${supplier}-${stringValue(row.beacon_order_id) || stringValue(row.job_number) || 'order'}`,
    reference: stringValue(row.beacon_order_id ?? row.job_number) || '—',
    po: stringValue(row.po_number),
    status: stringValue(row.status_value ?? row.status_code),
    total: numberOrStringValue(row.total),
    branch: stringValue(row.branch_id),
    when: stringValue(row.order_placed_date ?? row.created_at),
  };
}

function orderStatusVariant(status: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  const s = status.toLowerCase();
  if (['delivered', 'accepted', 'confirmed', 'complete', 'invoiced'].some(k => s.includes(k))) return 'default';
  if (['cancel', 'reject', 'fail', 'error'].some(k => s.includes(k))) return 'destructive';
  if (['queue', 'pending', 'submit', 'process'].some(k => s.includes(k))) return 'secondary';
  return 'outline';
}

function StateBadge({ info }: { info: AbcRowStateInfo }) {
  const cls =
    info.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
    : info.tone === 'warn' ? 'bg-amber-500/10 text-amber-700 border-amber-500/30'
    : info.tone === 'danger' ? 'bg-destructive/10 text-destructive border-destructive/30'
    : 'bg-muted text-muted-foreground border-muted-foreground/20';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`} title={info.reason}>{info.label}</span>;
}

export default function SupplierVerifyPricingPage() {
  const navigate = useNavigate();
  const { supplier } = useParams<{ supplier: string }>();
  const tenantId = useEffectiveTenantId();

  const supplierKey = (['abc', 'srs', 'qxo'].includes(supplier ?? '') ? supplier : 'abc') as SupplierKind;
  const meta = SUPPLIER_META[supplierKey];
  const abcSetup = useAbcSetup();
  const abcStatus = useAbcConnectionStatus();
  const abcAccounts = useAbcAccounts();

  const [orders, setOrders] = useState<NormalizedSupplierOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [rows, setRows] = useState<AbcRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [findFor, setFindFor] = useState<AbcRow | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('shingle');
  const [catalogRows, setCatalogRows] = useState<AbcCatalogSearchResultChild[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPrices, setCatalogPrices] = useState<Record<string, PricingBadge>>({});
  const [catalogPriceBusy, setCatalogPriceBusy] = useState(false);
  const [selectedInternalByCatalog, setSelectedInternalByCatalog] = useState<Record<string, string>>({});
  const [mappingBusy, setMappingBusy] = useState<Record<string, boolean>>({});
  const [setupOpen, setSetupOpen] = useState(false);
  const [syncingAccounts, setSyncingAccounts] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;
    setOrdersLoading(true);
    const { data, error } = await supabase
      .from(meta.ordersTable)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) toast.error(`Couldn't load orders: ${error.message}`);
    setOrders(((data || []) as UnknownRecord[]).map((r) => normalizeOrder(supplierKey, r)));
    setOrdersLoading(false);
  }, [tenantId, meta.ordersTable, supplierKey]);

  const loadRows = useCallback(async () => {
    if (!tenantId) return;
    setRowsLoading(true);
    // Load all tenant template items + any existing ABC mapping. We don't
    // filter to "mapped" only, because unmapped rows are exactly what the
    // integration team wants to see so they can be matched.
    // template_items are tenant-scoped via templates.tenant_id
    const { data: rawItems, error: itemsErr } = await supabase
      .from('template_items' as never)
      .select('id, item_name, description, item_type, templates!inner(tenant_id)')
      .eq('templates.tenant_id', tenantId)
      .order('item_name');
    if (itemsErr) toast.error(`Couldn't load template items: ${itemsErr.message}`);
    const items = rawItems || [];

    const ids = (items as TemplateItemRecord[]).map((r) => r.id);
    let mappings: AbcMappingRecord[] = [];
    if (ids.length > 0) {
      const { data: mrows } = await supabase
        .from('template_item_supplier_mappings' as never)
        .select('template_item_id, id, supplier, supplier_item_number, supplier_item_description, color_name, default_uom, valid_uoms, branch_scope, ship_to_scope, mapping_status, review_state, approved_at, last_checked_at, raw_catalog_payload')
        .eq('tenant_id', tenantId)
        .eq('supplier', 'abc')
        .in('template_item_id', ids);
      mappings = ((mrows || []) as unknown) as AbcMappingRecord[];
    }
    const byItem = new Map(mappings.map((m) => [m.template_item_id, m]));
    const built: AbcRow[] = (items as TemplateItemRecord[]).map((it) => ({
      templateItemId: it.id,
      internalCode: it.id.slice(0, 8),
      materialName: it.item_name || it.description || '(unnamed)',
      requestedColor: null,
      mapping: (byItem.get(it.id) ?? null) as AbcMappingRow | null,
    }));
    setRows(built);
    setRowsLoading(false);
  }, [tenantId]);

  useEffect(() => { loadOrders(); loadRows(); }, [loadOrders, loadRows]);

  const mappedRowsByAbcNumber = useMemo(() => {
    const map = new Map<string, AbcRow[]>();
    for (const row of rows) {
      const itemNumber = row.mapping?.supplier_item_number?.trim();
      if (!itemNumber) continue;
      const list = map.get(itemNumber) || [];
      list.push(row);
      map.set(itemNumber, list);
    }
    return map;
  }, [rows]);

  const computeState = useCallback((r: AbcRow): AbcRowStateInfo => {
    return computeAbcRowState({
      mapping: r.mapping,
      selectedBranchNumber: abcSetup.branchNumber,
      familyLikelyHasColors: /shingle|siding|paint|trim/i.test(r.materialName),
    });
  }, [abcSetup.branchNumber]);

  const priceCatalogItems = useCallback(async (items: AbcCatalogSearchResultChild[]) => {
    if (!abcSetup.shipToNumber || !abcSetup.branchNumber) return;
    const priceable = items
      .map((item) => ({ item, uom: item.defaultUom || item.validUoms[0] }))
      .filter((entry): entry is { item: AbcCatalogSearchResultChild; uom: string } => !!entry.uom)
      .slice(0, 75);

    if (priceable.length === 0) return;
    setCatalogPriceBusy(true);
    setCatalogPrices((prev) => {
      const next = { ...prev };
      for (const { item } of priceable) {
        next[item.itemNumber] = {
          info: { state: 'pricing', label: 'Pricing…', tone: 'muted', canPrice: true, reason: 'Contacting ABC' },
        };
      }
      return next;
    });

    try {
      const res = await abcPriceItems({
        shipToNumber: abcSetup.shipToNumber,
        branchNumber: abcSetup.branchNumber,
        purpose: 'estimating',
        lines: priceable.map(({ item, uom }) => ({
          id: item.itemNumber,
          itemNumber: item.itemNumber,
          quantity: 1,
          uom,
        })),
      });

      setCatalogPrices((prev) => {
        const next = { ...prev };
        for (const { item, uom } of priceable) {
          const line = res.lines.find((l) => l.itemNumber === item.itemNumber || l.returnedItemNumber === item.itemNumber) || null;
          const info = res.wafBlocked
            ? statesForPricingResult({ errorCode: 'waf_blocked' })
            : statesForPricingResult({
              errorSummary: res.errorSummary || undefined,
              unitPrice: line?.unitPrice ?? null,
              lineStatus: line?.lineStatus,
              lineStatusMessage: line?.lineStatusMessage,
            });
          next[item.itemNumber] = {
            info,
            unitPrice: line?.unitPrice ?? null,
            returnedUom: line?.returnedUom ?? uom,
            checkedAt: new Date().toISOString(),
          };
        }
        return next;
      });
    } catch (e: unknown) {
      setCatalogPrices((prev) => {
        const next = { ...prev };
        for (const { item } of priceable) {
          next[item.itemNumber] = {
            info: { state: 'error', label: 'Error', reason: getErrorMessage(e, 'Lookup failed'), tone: 'danger', canPrice: false },
          };
        }
        return next;
      });
      toast.error(getErrorMessage(e, 'ABC catalog pricing failed'));
    } finally {
      setCatalogPriceBusy(false);
    }
  }, [abcSetup.branchNumber, abcSetup.shipToNumber]);

  const loadCatalog = useCallback(async (searchTerm?: string, toastOnEmpty = true) => {
    if (supplierKey !== 'abc') return;
    if (!abcSetup.branchNumber) {
      toast.error('Select an ABC Ship-To and Branch before loading branch catalog pricing.');
      return;
    }
    const term = (searchTerm ?? catalogQuery).trim();
    if (!term) return;
    setCatalogLoading(true);
    try {
      const res = await abcSearchProducts({ query: term, branchNumber: abcSetup.branchNumber, itemsPerPage: 75 });
      setCatalogRows(res.children);
      setCatalogQuery(term);
      if (res.wafBlocked) {
        toast.error('ABC blocked the catalog request at the WAF layer.');
      } else if (!res.success) {
        toast.error(res.error_code || 'ABC catalog search failed');
      } else if (res.children.length === 0 && toastOnEmpty) {
        toast.warning(`No ABC catalog items returned for "${term}" at branch ${abcSetup.branchNumber || '—'}.`);
      } else if (res.children.length > 0) {
        await priceCatalogItems(res.children);
      }
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'ABC catalog search failed'));
    } finally {
      setCatalogLoading(false);
    }
  }, [abcSetup.branchNumber, catalogQuery, priceCatalogItems, supplierKey]);

  const syncAbcAccounts = useCallback(async () => {
    if (!tenantId) return;
    setSyncingAccounts(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'sync_accounts',
          tenant_id: tenantId,
        },
      });
      if (error) throw error;
      const result = (data || {}) as AbcSyncAccountsResponse;
      if (result.success === false) {
        throw new Error(result.error_code || result.error || result.stage || 'ABC account sync failed');
      }
      await Promise.all([
        abcAccounts.refetch(),
        abcSetup.refetch(),
        abcStatus.refresh(),
      ]);
      const shipToCount = result.ship_to_count ?? 0;
      const branchCount = result.branch_count ?? 0;
      if (shipToCount > 0 && branchCount > 0) {
        toast.success(`ABC accounts synced: ${shipToCount} Ship-To account${shipToCount === 1 ? '' : 's'}, ${branchCount} branch${branchCount === 1 ? '' : 'es'}.`);
        setSetupOpen(true);
      } else {
        toast.warning('ABC login is connected, but ABC did not return any Ship-To accounts with branches for pricing.');
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'ABC account sync failed'));
    } finally {
      setSyncingAccounts(false);
    }
  }, [abcAccounts, abcSetup, abcStatus, tenantId]);

  useEffect(() => {
    if (supplierKey !== 'abc' || !abcSetup.branchNumber) return;
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        for (const term of DEFAULT_ABC_CATALOG_QUERIES) {
          if (cancelled) return;
          const res = await abcSearchProducts({ query: term, branchNumber: abcSetup.branchNumber, itemsPerPage: 75 });
          if (res.children.length > 0) {
            if (cancelled) return;
            setCatalogRows(res.children);
            setCatalogQuery(term);
            await priceCatalogItems(res.children);
            return;
          }
        }
        if (!cancelled) setCatalogRows([]);
      } catch (e: unknown) {
        if (!cancelled) toast.error(getErrorMessage(e, 'ABC catalog search failed'));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [abcSetup.branchNumber, priceCatalogItems, supplierKey]);

  const matchCatalogItem = async (catalogItem: AbcCatalogSearchResultChild) => {
    const templateItemId = selectedInternalByCatalog[catalogItem.itemNumber];
    const selectedInternal = rows.find((r) => r.templateItemId === templateItemId);
    const selectedUom = catalogItem.defaultUom || catalogItem.validUoms[0];
    if (!tenantId || !abcSetup.shipToNumber || !abcSetup.branchNumber) {
      toast.error('Complete the ABC ship-to and branch setup first.');
      return;
    }
    if (!selectedInternal) {
      toast.error('Choose an internal material to match this ABC catalog item.');
      return;
    }
    if (!selectedUom) {
      toast.error('ABC did not return a Product API UOM for this item.');
      return;
    }

    setMappingBusy((prev) => ({ ...prev, [catalogItem.itemNumber]: true }));
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await abcApproveMapping({
        tenantId,
        templateItemId,
        itemNumber: catalogItem.itemNumber,
        itemDescription: catalogItem.description,
        familyId: catalogItem.familyId,
        familyName: catalogItem.familyName,
        colorName: catalogItem.colorName,
        colorCode: catalogItem.colorCode,
        validUoms: catalogItem.validUoms,
        selectedUom,
        branchNumber: abcSetup.branchNumber,
        shipToNumber: abcSetup.shipToNumber,
        rawCatalogPayload: catalogItem.raw,
        approvedBy: userRes?.user?.id ?? null,
      });
      if (error) throw error;
      toast.success(`Matched ABC ${catalogItem.itemNumber} to ${selectedInternal.materialName}`);
      await loadRows();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to save ABC mapping'));
    } finally {
      setMappingBusy((prev) => ({ ...prev, [catalogItem.itemNumber]: false }));
    }
  };

  const abcPricingReady = supplierKey !== 'abc' || abcSetup.ready;
  const abcConnectedButNotReady = supplierKey === 'abc' && abcStatus.isConnected && !abcSetup.ready;
  const abcAccountCount = abcAccounts.data?.length ?? 0;

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings?tab=integrations')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{meta.label} — Verify Pricing</h1>
            <p className="text-sm text-muted-foreground">
              Map each material to the exact ABC Product API item (color-specific), verify at branch, then pull live Price Items pricing.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadOrders(); loadRows(); if (supplierKey === 'abc') loadCatalog(undefined, false); }}>
            <RefreshCcw className="h-4 w-4 mr-1" /> Reload
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/supplier-orders')}>
            <ExternalLink className="h-4 w-4 mr-1" /> All supplier orders
          </Button>
        </div>
      </div>

      {supplierKey === 'abc' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active ABC account</CardTitle>
            <CardDescription>Pricing is pulled against the selected ship-to + branch.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-muted-foreground text-xs">Ship-To</div><div className="font-mono">{abcSetup.shipToNumber || '—'}</div></div>
            <div><div className="text-muted-foreground text-xs">Branch</div><div className="font-mono">{abcSetup.branchNumber || '—'}</div></div>
            <div><div className="text-muted-foreground text-xs">Setup</div><div>{abcSetup.connection?.setup_completed_at ? formatDistanceToNow(new Date(abcSetup.connection.setup_completed_at), { addSuffix: true }) : 'Not completed'}</div></div>
            <div><div className="text-muted-foreground text-xs">Status</div><div>{abcSetup.connection?.connection_status || 'unknown'}</div></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent orders to {meta.label}</CardTitle>
          <CardDescription>Last 100 orders submitted from this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading orders…</TableCell></TableRow>
                ) : orders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No orders sent yet.</TableCell></TableRow>
                ) : orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                    <TableCell className="font-mono text-xs">{o.po ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{o.branch ?? '—'}</TableCell>
                    <TableCell><Badge variant={orderStatusVariant(o.status)}>{o.status ?? 'unknown'}</Badge></TableCell>
                    <TableCell className="text-right">{o.total != null ? formatCurrency(Number(o.total)) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.when ? formatDistanceToNow(new Date(o.when), { addSuffix: true }) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">ABC Catalog Mapping</CardTitle>
              <CardDescription>
                Live ABC Product API catalog items for branch {abcSetup.branchNumber || '—'} are listed on the left. Match each catalog item to an internal material on the right.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadCatalog(); }}
                  placeholder="Search ABC catalog…"
                  className="pl-9 w-72 h-9"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => loadCatalog()} disabled={catalogLoading || !catalogQuery.trim()}>
                {catalogLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                Search ABC
              </Button>
              <Button size="sm" onClick={() => priceCatalogItems(catalogRows)} disabled={catalogPriceBusy || catalogRows.length === 0 || !abcSetup.shipToNumber || !abcSetup.branchNumber}>
                {catalogPriceBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
                Refresh catalog prices
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[260px]">ABC Item</TableHead>
                  <TableHead className="w-[120px]">Color</TableHead>
                  <TableHead className="w-[70px]">UOM</TableHead>
                  <TableHead className="w-[140px]">Live Price</TableHead>
                  <TableHead className="w-[12px] text-center text-muted-foreground">→</TableHead>
                  <TableHead>Matched Internal Material</TableHead>
                  <TableHead className="w-[160px]">Status</TableHead>
                  <TableHead className="w-[220px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogLoading || rowsLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading ABC catalog for this branch…</TableCell></TableRow>
                ) : catalogRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No ABC catalog items returned for branch {abcSetup.branchNumber || '—'}.</TableCell></TableRow>
                ) : catalogRows.map((catalogItem) => {
                  const matchedRows = mappedRowsByAbcNumber.get(catalogItem.itemNumber) || [];
                  const matchedRow = matchedRows[0] || null;
                  const state = matchedRow ? computeState(matchedRow) : null;
                  const priced = catalogPrices[catalogItem.itemNumber];
                  const selectedUom = catalogItem.defaultUom || catalogItem.validUoms[0] || null;
                  const branchRow = abcSetup.branchNumber
                    ? catalogItem.branchAvailability.find((b) => b.branchNumber === abcSetup.branchNumber)
                    : null;
                  const isBusy = !!mappingBusy[catalogItem.itemNumber];
                  return (
                    <TableRow key={catalogItem.itemNumber}>
                      <TableCell className="font-mono text-xs">
                        <div>{catalogItem.itemNumber}</div>
                        <div className="mt-1 font-sans text-xs font-medium text-foreground">{catalogItem.description || 'No ABC description returned'}</div>
                        {catalogItem.familyName && <div className="mt-1 font-sans text-[10px] text-muted-foreground">{catalogItem.familyName}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{catalogItem.colorName || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs">{selectedUom || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {priced?.info.state === 'priced' && typeof priced.unitPrice === 'number' ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-emerald-700">{formatCurrency(priced.unitPrice)}</span>
                            <span className="text-[10px] text-muted-foreground">{priced.returnedUom || selectedUom} · {priced.checkedAt ? formatDistanceToNow(new Date(priced.checkedAt), { addSuffix: true }) : ''}</span>
                          </div>
                        ) : priced?.info ? (
                          <span className={priced.info.tone === 'danger' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{priced.info.label}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not fetched</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">→</TableCell>
                      <TableCell>
                        {matchedRow ? (
                          <div>
                            <div className="font-medium">{matchedRow.materialName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{matchedRow.internalCode}{matchedRows.length > 1 ? ` · +${matchedRows.length - 1} more` : ''}</div>
                          </div>
                        ) : (
                          <Select
                            value={selectedInternalByCatalog[catalogItem.itemNumber]}
                            onValueChange={(value) => setSelectedInternalByCatalog((prev) => ({ ...prev, [catalogItem.itemNumber]: value }))}
                          >
                            <SelectTrigger className="h-9 min-w-[240px]">
                              <SelectValue placeholder="Choose internal material" />
                            </SelectTrigger>
                            <SelectContent>
                              {rows.map((r) => (
                                <SelectItem key={r.templateItemId} value={r.templateItemId}>{r.materialName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {matchedRow && state ? <StateBadge info={priced?.info || state} /> : <Badge variant="outline">Not matched</Badge>}
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {branchRow ? (branchRow.available ? 'Available at branch' : 'Not at branch') : abcSetup.branchNumber ? `Filtered to ${abcSetup.branchNumber}` : 'No branch selected'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {matchedRow ? (
                          <Button size="sm" variant="outline" onClick={() => setFindFor(matchedRow)}>
                            Change Match
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => matchCatalogItem(catalogItem)} disabled={isBusy || !selectedInternalByCatalog[catalogItem.itemNumber] || !selectedUom}>
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                            Save Match
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {findFor && tenantId && (
        <FindAbcMatchDialog
          open={!!findFor}
          onOpenChange={(o) => { if (!o) setFindFor(null); }}
          tenantId={tenantId}
          templateItemId={findFor.templateItemId}
          materialName={findFor.materialName}
          requestedColor={findFor.requestedColor}
          shipToNumber={abcSetup.shipToNumber}
          branchNumber={abcSetup.branchNumber}
          onApproved={() => { setFindFor(null); loadRows(); }}
        />
      )}
    </div>
  );
}
