// Verify Pricing page — the ABC catalog mapping + live pricing surface
// mandated by the ABC Supply integration team.
//
// Contract enforced here (per PR "ABC Catalog Mapping + Color-Specific SKU + Live Pricing UI Fix"):
//   • Internal material codes are NEVER treated as ABC itemNumbers.
//   • Each row shows a specific state (Needs ABC Match / Needs Color /
//     Needs UOM / Needs Branch Verification / Ready to Price / Priced /
//     Zero Price / Unavailable / WAF Blocked / Error) — never generic "Pending".
//   • "Get Live Price" is gated behind an approved mapping backed by a real
//     ABC Product API catalog snapshot.
//   • "Refresh All Prices" only submits rows where canPrice === true and
//     returns a summary of what was priced vs skipped and why.
//   • Every price call goes through `abc-api-proxy` → `price_items` (the
//     production route), never the `abc-api` stub.
//
// SRS and QXO fall back to the older behavior for now — this PR is ABC only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcSetup } from '@/hooks/useAbcSetup';
import { abcPriceItems } from '@/lib/abc/proxyClient';
import {
  computeAbcRowState,
  statesForPricingResult,
  type AbcMappingRow,
  type AbcRowStateInfo,
} from '@/lib/abc/mappingState';
import FindAbcMatchDialog from '@/components/supplier-verify/abc/FindAbcMatchDialog';
import AbcCatalogBrowserCard from '@/components/supplier-verify/abc/AbcCatalogBrowserCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ArrowLeft, RefreshCcw, Search, Loader2, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';

type SupplierKind = 'abc' | 'srs' | 'qxo';

const SUPPLIER_META: Record<SupplierKind, { label: string; ordersTable: 'abc_orders' | 'srs_orders' | 'qxo_orders' }> = {
  abc: { label: 'ABC Supply', ordersTable: 'abc_orders' },
  srs: { label: 'SRS Distribution', ordersTable: 'srs_orders' },
  qxo: { label: 'QXO / Beacon', ordersTable: 'qxo_orders' },
};

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

function normalizeOrder(supplier: SupplierKind, row: any) {
  if (supplier === 'abc') {
    return {
      id: row.id,
      reference: row.order_number ?? row.confirmation_number ?? '—',
      po: row.purchase_order ?? null,
      status: row.order_status ?? null,
      total: row.total_amount ?? null,
      branch: row.branch_number ?? null,
      when: row.ordered_on ?? row.created_at ?? null,
    };
  }
  if (supplier === 'srs') {
    return {
      id: row.id,
      reference: row.srs_order_id ?? row.order_number ?? '—',
      po: row.order_number ?? null,
      status: row.status ?? null,
      total: row.total_amount ?? null,
      branch: row.branch_id ?? row.branch_number ?? null,
      when: row.submitted_at ?? row.created_at ?? null,
    };
  }
  return {
    id: row.id,
    reference: row.beacon_order_id ?? row.job_number ?? '—',
    po: row.po_number ?? null,
    status: row.status_value ?? row.status_code ?? null,
    total: row.total ?? null,
    branch: row.branch_id ?? null,
    when: row.order_placed_date ?? row.created_at ?? null,
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

  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [rows, setRows] = useState<AbcRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, PricingBadge>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [findFor, setFindFor] = useState<AbcRow | null>(null);

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
    setOrders((data || []).map((r: any) => normalizeOrder(supplierKey, r)));
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
      .from('template_items' as any)
      .select('id, item_name, description, item_type, templates!inner(tenant_id)')
      .eq('templates.tenant_id', tenantId)
      .order('item_name');
    if (itemsErr) toast.error(`Couldn't load template items: ${itemsErr.message}`);
    const items = rawItems || [];

    const ids = items.map((r: any) => r.id);
    let mappings: any[] = [];
    if (ids.length > 0) {
      const { data: mrows } = await supabase
        .from('template_item_supplier_mappings' as any)
        .select('template_item_id, id, supplier, supplier_item_number, supplier_item_description, color_name, default_uom, valid_uoms, branch_scope, ship_to_scope, mapping_status, review_state, approved_at, last_checked_at, raw_catalog_payload')
        .eq('tenant_id', tenantId)
        .eq('supplier', 'abc')
        .in('template_item_id', ids);
      mappings = mrows || [];
    }
    const byItem = new Map(mappings.map((m) => [m.template_item_id, m as AbcMappingRow]));
    const built: AbcRow[] = items.map((it: any) => ({
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

  const filteredRows = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) =>
      r.materialName.toLowerCase().includes(q) ||
      r.internalCode.toLowerCase().includes(q) ||
      (r.mapping?.supplier_item_number || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const computeState = useCallback((r: AbcRow): AbcRowStateInfo => {
    return computeAbcRowState({
      mapping: r.mapping,
      selectedBranchNumber: abcSetup.branchNumber,
      familyLikelyHasColors: /shingle|siding|paint|trim/i.test(r.materialName),
    });
  }, [abcSetup.branchNumber]);

  const priceOne = async (r: AbcRow) => {
    const state = computeState(r);
    if (!state.canPrice) {
      toast.error(`Cannot price: ${state.reason}`);
      return;
    }
    if (!abcSetup.shipToNumber || !abcSetup.branchNumber || !r.mapping) return;
    setRowBusy((b) => ({ ...b, [r.templateItemId]: true }));
    setPrices((p) => ({ ...p, [r.templateItemId]: { info: { ...state, state: 'pricing', label: 'Pricing…', tone: 'muted', canPrice: true, reason: 'Contacting ABC' } } }));
    try {
      const res = await abcPriceItems({
        shipToNumber: abcSetup.shipToNumber,
        branchNumber: abcSetup.branchNumber,
        purpose: 'estimating',
        lines: [{
          id: r.templateItemId,
          itemNumber: r.mapping.supplier_item_number as string,
          quantity: 1,
          uom: r.mapping.default_uom as string,
        }],
      });
      const line = res.lines[0] || null;
      const info = res.wafBlocked
        ? statesForPricingResult({ errorCode: 'waf_blocked' })
        : statesForPricingResult({
          errorSummary: res.errorSummary || undefined,
          unitPrice: line?.unitPrice ?? null,
          lineStatus: line?.lineStatus,
          lineStatusMessage: line?.lineStatusMessage,
        });
      setPrices((p) => ({ ...p, [r.templateItemId]: {
        info,
        unitPrice: line?.unitPrice ?? null,
        returnedUom: line?.returnedUom ?? null,
        checkedAt: new Date().toISOString(),
      } }));
    } catch (e: any) {
      setPrices((p) => ({ ...p, [r.templateItemId]: {
        info: { state: 'error', label: 'Error', reason: e?.message || 'Lookup failed', tone: 'danger', canPrice: false },
      } }));
    } finally {
      setRowBusy((b) => ({ ...b, [r.templateItemId]: false }));
    }
  };

  const refreshAll = async () => {
    setBulkBusy(true);
    const summary = { requested: 0, priced: 0, skipped: 0, failed: 0, skippedReasons: {} as Record<string, number> };
    try {
      const priceable: AbcRow[] = [];
      for (const r of filteredRows) {
        const s = computeState(r);
        summary.requested += 1;
        if (s.canPrice) priceable.push(r);
        else {
          summary.skipped += 1;
          summary.skippedReasons[s.label] = (summary.skippedReasons[s.label] || 0) + 1;
        }
      }
      const queue = [...priceable];
      const worker = async () => {
        while (queue.length) {
          const next = queue.shift()!;
          await priceOne(next);
          const info = prices[next.templateItemId]?.info;
          if (info?.state === 'priced') summary.priced += 1; else summary.failed += 1;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const bits = [
        `${summary.requested} total`,
        `${summary.priced} priced`,
        `${summary.skipped} skipped`,
        ...Object.entries(summary.skippedReasons).map(([k, v]) => `${v} ${k.toLowerCase()}`),
      ];
      toast.success(bits.join(' · '));
    } finally {
      setBulkBusy(false);
    }
  };

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
          <Button variant="outline" size="sm" onClick={() => { loadOrders(); loadRows(); }}>
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

      {supplierKey === 'abc' && (
        <AbcCatalogBrowserCard shipToNumber={abcSetup.shipToNumber} branchNumber={abcSetup.branchNumber} />
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">ABC Catalog Mapping</CardTitle>
              <CardDescription>
                Each material must be matched to an exact ABC itemNumber (color-specific), verified at branch {abcSetup.branchNumber || '—'}, and assigned a Product API UOM before pricing.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search materials…" className="pl-9 w-64 h-9" />
              </div>
              <Button size="sm" onClick={refreshAll} disabled={bulkBusy || filteredRows.length === 0}>
                {bulkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
                Refresh all prices
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">ABC Item</TableHead>
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
                {rowsLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading materials…</TableCell></TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No template items in this tenant.</TableCell></TableRow>
                ) : filteredRows.map((r) => {
                  const state = computeState(r);
                  const priced = prices[r.templateItemId];
                  const busy = !!rowBusy[r.templateItemId];
                  const canPrice = (priced?.info.canPrice ?? state.canPrice) && !!abcSetup.shipToNumber && !!abcSetup.branchNumber;
                  const isMapped = !!r.mapping?.supplier_item_number;
                  return (
                    <TableRow key={r.templateItemId}>
                      <TableCell className="font-mono text-xs">
                        {isMapped ? r.mapping!.supplier_item_number : <span className="text-muted-foreground italic">Not mapped</span>}
                      </TableCell>
                      <TableCell className="text-xs">{r.mapping?.color_name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs">{r.mapping?.default_uom || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {priced?.info.state === 'priced' && typeof priced.unitPrice === 'number' ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-emerald-700">{formatCurrency(priced.unitPrice)}</span>
                            <span className="text-[10px] text-muted-foreground">{priced.returnedUom || r.mapping?.default_uom} · {priced.checkedAt ? formatDistanceToNow(new Date(priced.checkedAt), { addSuffix: true }) : ''}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {state.canPrice ? 'Not fetched' : 'Unavailable until mapped'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">→</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.materialName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.internalCode}</div>
                      </TableCell>
                      <TableCell><StateBadge info={priced?.info || state} /></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="outline" onClick={() => setFindFor(r)}>
                          {isMapped ? 'Change Match' : 'Find ABC Match'}
                        </Button>
                        <Button size="sm" onClick={() => priceOne(r)} disabled={busy || !canPrice}>
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Get Live Price'}
                        </Button>
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
